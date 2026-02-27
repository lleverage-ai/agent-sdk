import { TypedEmitter } from "../emitter.js";
import type { ClientMessage, ReplayEndMessage } from "../protocol.js";
import { decodeServerMessage, encodeMessage, PROTOCOL_VERSION } from "../protocol.js";
import type { Logger, StoredEvent } from "../types.js";
import type { IWebSocket, WebSocketConstructor } from "../ws-types.js";
import { WS_READY_STATE } from "../ws-types.js";

/**
 * Client state machine states.
 *
 * @category Client
 */
export type WsClientState = "disconnected" | "connecting" | "connected" | "reconnecting" | "closed";

/**
 * Options for creating a WsClient.
 *
 * @category Client
 */
export interface WsClientOptions {
  url: string;
  /** WebSocket constructor — defaults to `globalThis.WebSocket`. */
  WebSocket?: WebSocketConstructor;
  /** Optional logger for routing diagnostics through the host application. */
  logger?: Logger;
  /** Enable automatic reconnection. Default: true */
  reconnect?: boolean;
  /** Maximum reconnection attempts. Default: Infinity */
  maxReconnectAttempts?: number;
  /** Base delay between reconnection attempts in ms. Default: 1000 */
  baseReconnectDelayMs?: number;
  /** Maximum delay between reconnection attempts in ms. Default: 30000 */
  maxReconnectDelayMs?: number;
  /** Time to wait for a server ping before triggering reconnect. Default: 45000 */
  heartbeatTimeoutMs?: number;
}

/**
 * Options for subscribing to a stream.
 *
 * @category Client
 */
export interface SubscribeOptions {
  afterSeq?: number;
  signal?: AbortSignal;
}

/**
 * Marker event yielded when replay finishes and the subscription
 * transitions to live mode.
 *
 * @category Client
 */
export interface PromotionEvent {
  type: "replay-end";
  streamId: string;
  lastReplaySeq: number;
}

/**
 * Union of events yielded by `subscribe()`.
 *
 * @category Client
 */
export type SubscriptionEvent<TEvent> = StoredEvent<TEvent> | PromotionEvent;

/**
 * Events emitted by WsClient.
 *
 * Must be a `type` alias (not `interface`) so TypeScript provides the
 * implicit index signature required by `TypedEmitter<Record<string, ...>>`.
 *
 * @category Client
 */
export type WsClientEvents = {
  stateChange: (state: WsClientState) => void;
  error: (error: unknown) => void;
};

interface ActiveSubscription {
  streamId: string;
  lastConfirmedSeq: number;
  /** Whether replay has completed for this subscription */
  live: boolean;
  /** Highest seq from replay, used for dedup during promotion */
  lastReplaySeq: number;
  push: (item: SubscriptionEvent<unknown>) => void;
  end: () => void;
  /** Tracked AbortSignal handler for cleanup on unsubscribe */
  abortHandler: { signal: AbortSignal; handler: () => void } | null;
}

/**
 * WebSocket client for subscribing to event streams.
 *
 * Returns `AsyncIterable` from `subscribe()` for consuming events.
 * Supports automatic reconnection with exponential backoff.
 *
 * @category Client
 */
export class WsClient extends TypedEmitter<WsClientEvents> {
  private url: string;
  private WsCtor: WebSocketConstructor;
  private reconnectEnabled: boolean;
  private maxReconnectAttempts: number;
  private baseReconnectDelayMs: number;
  private maxReconnectDelayMs: number;
  private heartbeatTimeoutMs: number;

  private ws: IWebSocket | null = null;
  private _state: WsClientState = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions = new Map<string, ActiveSubscription>();
  private handshakeComplete = false;

  constructor(options: WsClientOptions) {
    super(options.logger);
    this.url = options.url;
    const wsCtor =
      options.WebSocket ?? (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
    if (typeof wsCtor !== "function") {
      throw new Error(
        "WebSocket constructor is not available. Provide options.WebSocket in this runtime.",
      );
    }
    this.WsCtor = wsCtor;
    this.reconnectEnabled = options.reconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;
    this.baseReconnectDelayMs = options.baseReconnectDelayMs ?? 1_000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 45_000;
  }

  get state(): WsClientState {
    return this._state;
  }

  /**
   * Initiate a WebSocket connection.
   */
  connect(): void {
    if (this._state === "closed") {
      throw new Error("Cannot connect after close(). Create a new WsClient instance instead.");
    }
    if (
      this._state === "connecting" ||
      this._state === "reconnecting" ||
      this._state === "connected"
    ) {
      return;
    }
    this.doConnect();
  }

  /**
   * Subscribe to a stream. Returns an AsyncIterable that yields events.
   *
   * On reconnect, the subscription is automatically resumed from the
   * last confirmed sequence number.
   */
  subscribe<TEvent>(
    streamId: string,
    options?: SubscribeOptions,
  ): AsyncIterable<SubscriptionEvent<TEvent>> {
    const afterSeq = options?.afterSeq ?? 0;
    const signal = options?.signal;

    // Push/pull queue for the async iterable
    const queue: Array<SubscriptionEvent<unknown>> = [];
    let resolve: ((value: IteratorResult<SubscriptionEvent<unknown>>) => void) | null = null;
    let done = false;

    const push = (item: SubscriptionEvent<unknown>) => {
      if (done) return;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: item, done: false });
      } else {
        queue.push(item);
      }
    };

    const end = () => {
      done = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined as unknown, done: true });
      }
    };

    if (this.subscriptions.has(streamId)) {
      throw new Error(`Already subscribed to stream "${streamId}". Call unsubscribe() first.`);
    }

    const sub: ActiveSubscription = {
      streamId,
      lastConfirmedSeq: afterSeq,
      live: false,
      lastReplaySeq: 0,
      push,
      end,
      abortHandler: null,
    };

    this.subscriptions.set(streamId, sub);

    // Handle AbortSignal
    if (signal) {
      const onAbort = () => {
        this.unsubscribe(streamId);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      sub.abortHandler = { signal, handler: onAbort };
    }

    // If already aborted, close immediately without sending subscribe/unsubscribe wire messages.
    if (signal?.aborted) {
      this.cleanupSubscription(sub);
      this.subscriptions.delete(streamId);
    } else if (this.handshakeComplete) {
      // If already connected, send subscribe immediately.
      this.sendSubscribe(streamId, afterSeq);
    }

    const self = this;

    const iterable: AsyncIterable<SubscriptionEvent<TEvent>> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<SubscriptionEvent<TEvent>>> {
            if (queue.length > 0) {
              return Promise.resolve({
                value: queue.shift()! as SubscriptionEvent<TEvent>,
                done: false,
              });
            }
            if (done) {
              return Promise.resolve({
                value: undefined as unknown as SubscriptionEvent<TEvent>,
                done: true,
              });
            }
            return new Promise<IteratorResult<SubscriptionEvent<TEvent>>>((r) => {
              resolve = r as (value: IteratorResult<SubscriptionEvent<unknown>>) => void;
            });
          },
          return(): Promise<IteratorResult<SubscriptionEvent<TEvent>>> {
            self.unsubscribe(streamId);
            return Promise.resolve({
              value: undefined as unknown as SubscriptionEvent<TEvent>,
              done: true,
            });
          },
        };
      },
    };

    return iterable;
  }

  /**
   * Unsubscribe from a stream and close its async iterator.
   */
  unsubscribe(streamId: string): void {
    const sub = this.subscriptions.get(streamId);
    if (!sub) return;
    this.cleanupSubscription(sub);
    this.subscriptions.delete(streamId);
    if (this.handshakeComplete) {
      this.sendMessage({ type: "unsubscribe", streamId });
    }
  }

  /**
   * Permanently close the client. Stops reconnection and ends all subscriptions.
   */
  close(): void {
    this.setState("closed");
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();

    for (const sub of this.subscriptions.values()) {
      this.cleanupSubscription(sub);
    }
    this.subscriptions.clear();

    if (this.ws) {
      this.ws.close(1000, "Client closed");
      this.ws = null;
    }
  }

  private doConnect(): void {
    this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    this.handshakeComplete = false;

    let ws: IWebSocket;
    try {
      ws = new this.WsCtor(this.url);
    } catch (error) {
      this.setState("disconnected");
      this.emit("error", error);
      this.failAllSubscriptions("WebSocket constructor failed");
      return;
    }
    this.ws = ws;

    const onOpen = () => {
      this.sendMessage({ type: "hello", version: PROTOCOL_VERSION });
    };

    const onMessage = (event: unknown) => {
      const data =
        typeof event === "object" && event !== null && "data" in event
          ? (event as { data: string }).data
          : String(event);
      this.handleMessage(data);
    };

    const onClose = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("close", onClose);
      ws.removeEventListener("error", onError);
      this.ws = null;
      this.handshakeComplete = false;
      this.clearHeartbeatTimer();

      if (this._state !== "closed") {
        this.attemptReconnect();
      }
    };

    const onError = (err: unknown) => {
      this.emit("error", err);
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", onError);
  }

  private handleMessage(data: string): void {
    const msg = decodeServerMessage(data);
    if (!msg) {
      this.emit("error", new Error("Received invalid server message"));
      return;
    }

    switch (msg.type) {
      case "server-hello":
        this.handshakeComplete = true;
        this.reconnectAttempt = 0;
        this.setState("connected");
        this.resetHeartbeatTimer();
        this.resubscribeAll();
        break;

      case "event":
        this.handleEvent(msg.streamId, msg.event);
        this.resetHeartbeatTimer();
        break;

      case "replay-end":
        this.handleReplayEnd(msg);
        this.resetHeartbeatTimer();
        break;

      case "ping":
        this.sendMessage({ type: "pong" });
        this.resetHeartbeatTimer();
        break;

      case "error":
        this.emit("error", msg);
        break;
    }
  }

  private handleEvent(streamId: string, event: StoredEvent<unknown>): void {
    const sub = this.subscriptions.get(streamId);
    if (!sub) return;

    // Dedup during promotion window
    if (sub.live && event.seq <= sub.lastReplaySeq) {
      return;
    }

    // Dedup against already-confirmed events
    if (event.seq <= sub.lastConfirmedSeq && sub.live) {
      return;
    }

    sub.lastConfirmedSeq = event.seq;
    sub.push(event);
  }

  private handleReplayEnd(msg: ReplayEndMessage): void {
    const sub = this.subscriptions.get(msg.streamId);
    if (!sub) return;

    sub.live = true;
    sub.lastReplaySeq = msg.lastReplaySeq;
    sub.lastConfirmedSeq = Math.max(sub.lastConfirmedSeq, msg.lastReplaySeq);

    sub.push({
      type: "replay-end",
      streamId: msg.streamId,
      lastReplaySeq: msg.lastReplaySeq,
    });
  }

  private resubscribeAll(): void {
    for (const sub of this.subscriptions.values()) {
      sub.live = false;
      sub.lastReplaySeq = 0;
      this.sendSubscribe(sub.streamId, sub.lastConfirmedSeq);
    }
  }

  private sendSubscribe(streamId: string, afterSeq: number): void {
    const msg: ClientMessage = { type: "subscribe", streamId, afterSeq };
    this.sendMessage(msg);
  }

  private attemptReconnect(): void {
    if (!this.reconnectEnabled || this._state === "closed") {
      this.setState("disconnected");
      this.failAllSubscriptions("Disconnected and reconnection is disabled");
      return;
    }

    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.setState("disconnected");
      this.failAllSubscriptions("Max reconnection attempts reached");
      return;
    }

    this.setState("reconnecting");

    const delay = Math.min(
      this.baseReconnectDelayMs * 2 ** this.reconnectAttempt,
      this.maxReconnectDelayMs,
    );
    // Add 0-25% jitter
    const jitter = delay * Math.random() * 0.25;
    const totalDelay = delay + jitter;

    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this._state !== "closed") {
        this.doConnect();
      }
    }, totalDelay);
  }

  private resetHeartbeatTimer(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setTimeout(() => {
      // No ping received from server within timeout — reconnect
      if (this.ws) {
        this.ws.close(1001, "Heartbeat timeout");
      }
    }, this.heartbeatTimeoutMs);
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private failAllSubscriptions(reason: string): void {
    if (this.subscriptions.size === 0) return;
    this.emit("error", new Error(reason));
    for (const sub of this.subscriptions.values()) {
      this.cleanupSubscription(sub);
    }
    this.subscriptions.clear();
  }

  private cleanupSubscription(sub: ActiveSubscription): void {
    if (sub.abortHandler) {
      sub.abortHandler.signal.removeEventListener("abort", sub.abortHandler.handler);
      sub.abortHandler = null;
    }
    sub.end();
  }

  private setState(state: WsClientState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit("stateChange", state);
  }

  private sendMessage(msg: ClientMessage): void {
    if (!this.ws) {
      this.emit("error", new Error(`Cannot send "${msg.type}" while socket is not initialized`));
      return;
    }
    if (this.ws.readyState !== WS_READY_STATE.OPEN) {
      this.emit(
        "error",
        new Error(
          `Cannot send "${msg.type}" while socket is not open (readyState=${this.ws.readyState})`,
        ),
      );
      return;
    }
    try {
      this.ws.send(encodeMessage(msg));
    } catch (error) {
      this.emit("error", error);
    }
  }
}
