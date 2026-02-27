import type { IWebSocket, WebSocketConstructor } from "../../src/ws-types.js";
import { WS_READY_STATE } from "../../src/ws-types.js";

type WsListener = (event: unknown) => void;

/**
 * Mock WebSocket implementing IWebSocket for testing.
 */
export class MockWebSocket implements IWebSocket {
  readyState: number = WS_READY_STATE.CONNECTING;
  sentMessages: string[] = [];
  peer: MockWebSocket | null = null;

  private eventListeners = new Map<string, Set<WsListener>>();

  send(data: string): void {
    if (this.readyState !== WS_READY_STATE.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.sentMessages.push(data);
    // Deliver to peer synchronously
    if (this.peer) {
      this.peer.simulateMessage(data);
    }
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === WS_READY_STATE.CLOSED || this.readyState === WS_READY_STATE.CLOSING) {
      return;
    }
    this.readyState = WS_READY_STATE.CLOSING;
    this.readyState = WS_READY_STATE.CLOSED;
    this.dispatch("close", { code: code ?? 1000, reason: reason ?? "" });
    // Close peer too
    if (this.peer && this.peer.readyState === WS_READY_STATE.OPEN) {
      this.peer.simulateClose(code, reason);
    }
  }

  addEventListener(type: string, listener: WsListener): void {
    let set = this.eventListeners.get(type);
    if (!set) {
      set = new Set();
      this.eventListeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: WsListener): void {
    this.eventListeners.get(type)?.delete(listener);
  }

  // ── Test helpers ──

  simulateOpen(): void {
    this.readyState = WS_READY_STATE.OPEN;
    this.dispatch("open", {});
  }

  simulateMessage(data: string): void {
    this.dispatch("message", { data });
  }

  simulateClose(code?: number, reason?: string): void {
    this.readyState = WS_READY_STATE.CLOSED;
    this.dispatch("close", { code: code ?? 1000, reason: reason ?? "" });
  }

  simulateError(message?: string): void {
    this.dispatch("error", { message: message ?? "mock error" });
  }

  private dispatch(type: string, event: unknown): void {
    const set = this.eventListeners.get(type);
    if (!set) return;
    for (const listener of set) {
      listener(event);
    }
  }
}

/**
 * Create a linked pair of MockWebSocket instances.
 * `client.send()` delivers to `server`'s message listeners and vice versa.
 * Both start in OPEN state.
 */
export function createMockWebSocketPair(): {
  client: MockWebSocket;
  server: MockWebSocket;
} {
  const client = new MockWebSocket();
  const server = new MockWebSocket();
  client.peer = server;
  server.peer = client;
  client.readyState = WS_READY_STATE.OPEN;
  server.readyState = WS_READY_STATE.OPEN;
  return { client, server };
}

/**
 * Create a mock WebSocketConstructor that tracks created instances.
 * Instances start in CONNECTING state — call `simulateOpen()` to open them.
 */
export function createMockWebSocketConstructor(): {
  Constructor: WebSocketConstructor;
  instances: MockWebSocket[];
} {
  const instances: MockWebSocket[] = [];

  const Constructor = class extends MockWebSocket {
    constructor(_url: string, _protocols?: string | string[]) {
      super();
      instances.push(this);
    }
  } as unknown as WebSocketConstructor;

  return { Constructor, instances };
}
