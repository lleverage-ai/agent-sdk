import type { EventMessage, ProtocolError, ServerMessage } from "../protocol.js";
import {
  decodeClientMessage,
  encodeMessage,
  PROTOCOL_ERRORS,
  PROTOCOL_VERSION,
} from "../protocol.js";
import type { IEventStore, Logger, StoredEvent } from "../types.js";
import { defaultLogger } from "../types.js";
import type { IWebSocket } from "../ws-types.js";
import { WS_READY_STATE } from "../ws-types.js";

/**
 * Options for creating a WsServer.
 *
 * @category Server
 */
export interface WsServerOptions {
  store: IEventStore<unknown>;
  /** Optional logger for routing diagnostics through the host application. */
  logger?: Logger;
  /** Interval between heartbeat pings in ms. Default: 30000 */
  heartbeatIntervalMs?: number;
  /** Max time to wait for pong before disconnecting. Default: 10000 */
  heartbeatTimeoutMs?: number;
  /** Max buffered events per client before disconnect. Default: 1000 */
  maxBufferSize?: number;
}

interface Subscription {
  streamId: string;
  /** Whether replay has completed and we're in live mode */
  live: boolean;
  /** Events buffered during replay, flushed after replay-end */
  buffer: StoredEvent<unknown>[];
  /** Highest seq sent during replay, for dedup on flush */
  lastReplaySeq: number;
}

interface ClientState {
  ws: IWebSocket;
  handshakeComplete: boolean;
  subscriptions: Map<string, Subscription>;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  heartbeatTimeout: ReturnType<typeof setTimeout> | null;
  messageListener: (event: unknown) => void;
  closeListener: (event: unknown) => void;
  errorListener: (event: unknown) => void;
}

/**
 * WebSocket server for streaming events from an IEventStore to connected clients.
 *
 * The server does not create WebSocket connections itself — call `handleConnection()`
 * with a WebSocket instance provided by your HTTP server.
 *
 * @category Server
 */
export class WsServer {
  private store: IEventStore<unknown>;
  private logger: Logger;
  private heartbeatIntervalMs: number;
  private heartbeatTimeoutMs: number;
  private maxBufferSize: number;
  private clients = new Set<ClientState>();
  private closed = false;

  constructor(options: WsServerOptions) {
    this.store = options.store;
    this.logger = options.logger ?? defaultLogger;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 10_000;
    this.maxBufferSize = options.maxBufferSize ?? 1000;
  }

  /**
   * Register a new WebSocket connection.
   * The server will manage the protocol handshake, subscriptions, and heartbeat.
   */
  handleConnection(ws: IWebSocket): void {
    if (this.closed) {
      ws.close(1001, "Server closed");
      return;
    }

    const client: ClientState = {
      ws,
      handshakeComplete: false,
      subscriptions: new Map(),
      heartbeatTimer: null,
      heartbeatTimeout: null,
      messageListener: () => {},
      closeListener: () => {},
      errorListener: () => {},
    };

    client.messageListener = (event: unknown) => {
      const data =
        typeof event === "object" && event !== null && "data" in event
          ? (event as { data: string }).data
          : String(event);
      this.handleMessage(client, data);
    };

    client.closeListener = () => {
      this.removeClient(client);
    };

    client.errorListener = (event: unknown) => {
      this.logger.error("[WsServer] WebSocket error", { event });
      this.removeClient(client);
    };

    ws.addEventListener("message", client.messageListener);
    ws.addEventListener("close", client.closeListener);
    ws.addEventListener("error", client.errorListener);
    this.clients.add(client);
  }

  /**
   * Broadcast new events to all clients subscribed to the given stream.
   * Call this after appending events to the store.
   */
  broadcast(streamId: string, events: StoredEvent<unknown>[]): void {
    for (const client of this.clients) {
      const sub = client.subscriptions.get(streamId);
      if (!sub) continue;

      if (sub.live) {
        // Live mode — send directly
        for (const event of events) {
          this.sendEvent(client, streamId, event);
        }
      } else {
        // Still replaying — buffer for later
        let overflow = false;
        for (const event of events) {
          sub.buffer.push(event);
          if (sub.buffer.length > this.maxBufferSize) {
            this.sendError(client, PROTOCOL_ERRORS.BUFFER_OVERFLOW, "Buffer overflow");
            client.ws.close(1008, "Buffer overflow");
            this.removeClient(client);
            overflow = true;
            break;
          }
        }
        if (overflow) continue;
      }
    }
  }

  /**
   * Gracefully close the server: disconnect all clients and stop heartbeats.
   */
  close(): void {
    this.closed = true;
    for (const client of this.clients) {
      this.cleanupClient(client);
      client.ws.close(1001, "Server shutting down");
    }
    this.clients.clear();
  }

  private handleMessage(client: ClientState, data: string): void {
    const clientMsg = decodeClientMessage(data);
    if (!clientMsg) {
      this.sendError(client, PROTOCOL_ERRORS.INVALID_MESSAGE, "Invalid message format");
      return;
    }

    switch (clientMsg.type) {
      case "hello":
        this.handleHello(client, clientMsg.version);
        break;
      case "subscribe":
        if (!client.handshakeComplete) return;
        this.handleSubscribe(client, clientMsg.streamId, clientMsg.afterSeq);
        break;
      case "unsubscribe":
        if (!client.handshakeComplete) return;
        client.subscriptions.delete(clientMsg.streamId);
        break;
      case "pong":
        this.handlePong(client);
        break;
    }
  }

  private handleHello(client: ClientState, version: number): void {
    if (version !== PROTOCOL_VERSION) {
      this.sendError(
        client,
        PROTOCOL_ERRORS.VERSION_MISMATCH,
        `Expected protocol version ${PROTOCOL_VERSION}, got ${version}`,
      );
      client.ws.close(1002, "Version mismatch");
      this.removeClient(client);
      return;
    }

    client.handshakeComplete = true;
    this.sendMessage(client, {
      type: "server-hello",
      version: PROTOCOL_VERSION,
    });
    this.startHeartbeat(client);
  }

  private handleSubscribe(client: ClientState, streamId: string, afterSeq?: number): void {
    const sub: Subscription = {
      streamId,
      live: false,
      buffer: [],
      lastReplaySeq: 0,
    };
    client.subscriptions.set(streamId, sub);

    // Replay from store, then promote to live
    this.replayAndPromote(client, sub, afterSeq ?? 0);
  }

  private async replayAndPromote(
    client: ClientState,
    sub: Subscription,
    afterSeq: number,
  ): Promise<void> {
    try {
      const events = await this.store.replay(sub.streamId, { afterSeq });

      // Client may have disconnected during async replay
      if (!this.clients.has(client)) return;

      let lastReplaySeq = afterSeq;
      for (const event of events) {
        this.sendEvent(client, sub.streamId, event);
        lastReplaySeq = event.seq;
      }

      sub.lastReplaySeq = lastReplaySeq;

      // Send replay-end marker
      this.sendMessage(client, {
        type: "replay-end",
        streamId: sub.streamId,
        lastReplaySeq,
      });

      // Promote to live: flush buffered events (dedup by seq)
      sub.live = true;
      const buffered = sub.buffer;
      sub.buffer = [];

      for (const event of buffered) {
        if (event.seq > sub.lastReplaySeq) {
          this.sendEvent(client, sub.streamId, event);
        }
      }
    } catch (error) {
      // Store error — notify client
      if (this.clients.has(client)) {
        this.logger.error("[WsServer] replayAndPromote failed", {
          streamId: sub.streamId,
          error,
        });
        this.sendError(
          client,
          PROTOCOL_ERRORS.REPLAY_FAILED,
          `Failed to replay stream ${sub.streamId}`,
        );
      }
    }
  }

  private handlePong(client: ClientState): void {
    if (client.heartbeatTimeout) {
      clearTimeout(client.heartbeatTimeout);
      client.heartbeatTimeout = null;
    }
  }

  private startHeartbeat(client: ClientState): void {
    client.heartbeatTimer = setInterval(() => {
      if (client.ws.readyState !== WS_READY_STATE.OPEN) {
        this.removeClient(client);
        return;
      }

      this.sendMessage(client, { type: "ping" });

      client.heartbeatTimeout = setTimeout(() => {
        // No pong received — disconnect
        client.ws.close(1001, "Heartbeat timeout");
        this.removeClient(client);
      }, this.heartbeatTimeoutMs);
    }, this.heartbeatIntervalMs);
  }

  private sendEvent(client: ClientState, streamId: string, event: StoredEvent<unknown>): void {
    const msg: EventMessage = { type: "event", streamId, event };
    this.sendMessage(client, msg);
  }

  private sendError(client: ClientState, code: ProtocolError, message: string): void {
    this.sendMessage(client, {
      type: "error",
      code,
      message,
    });
  }

  private sendMessage(client: ClientState, msg: ServerMessage): void {
    if (client.ws.readyState !== WS_READY_STATE.OPEN) {
      this.logger.warn("[WsServer] dropping message for non-open socket", {
        type: msg.type,
        readyState: client.ws.readyState,
      });
      return;
    }

    try {
      client.ws.send(encodeMessage(msg));
    } catch (error) {
      this.logger.error("[WsServer] failed to send message", {
        type: msg.type,
        error,
      });
      this.removeClient(client);
    }
  }

  private removeClient(client: ClientState): void {
    if (!this.clients.has(client)) return;
    this.cleanupClient(client);
    this.clients.delete(client);
  }

  private cleanupClient(client: ClientState): void {
    if (client.heartbeatTimer) {
      clearInterval(client.heartbeatTimer);
      client.heartbeatTimer = null;
    }
    if (client.heartbeatTimeout) {
      clearTimeout(client.heartbeatTimeout);
      client.heartbeatTimeout = null;
    }
    client.ws.removeEventListener("message", client.messageListener);
    client.ws.removeEventListener("close", client.closeListener);
    client.ws.removeEventListener("error", client.errorListener);
    client.subscriptions.clear();
  }
}
