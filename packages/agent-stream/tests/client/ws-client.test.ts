import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WsClientState } from "../../src/client/ws-client.js";
import { WsClient } from "../../src/client/ws-client.js";
import type { ClientMessage, ServerMessage } from "../../src/protocol.js";
import { encodeMessage, PROTOCOL_VERSION } from "../../src/protocol.js";
import type { StoredEvent } from "../../src/types.js";
import type { MockWebSocket } from "../helpers/mock-ws.js";
import { createMockWebSocketConstructor } from "../helpers/mock-ws.js";

function sendServer(ws: MockWebSocket, msg: ServerMessage): void {
  ws.simulateMessage(encodeMessage(msg));
}

function parseSent(ws: MockWebSocket): ClientMessage[] {
  return ws.sentMessages.map((m) => JSON.parse(m) as ClientMessage);
}

function completeHandshake(ws: MockWebSocket): void {
  ws.simulateOpen();
  // Client should have sent hello
  sendServer(ws, { type: "server-hello", version: PROTOCOL_VERSION });
}

async function collectN<T>(iter: AsyncIterable<T>, n: number): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iter) {
    items.push(item);
    if (items.length >= n) break;
  }
  return items;
}

describe("WsClient", () => {
  let Constructor: ReturnType<typeof createMockWebSocketConstructor>["Constructor"];
  let instances: MockWebSocket[];

  beforeEach(() => {
    vi.useFakeTimers();
    const mock = createMockWebSocketConstructor();
    Constructor = mock.Constructor;
    instances = mock.instances;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws a descriptive error when WebSocket constructor is unavailable", () => {
    const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = undefined;
    try {
      expect(() => new WsClient({ url: "ws://localhost" })).toThrow(
        "WebSocket constructor is not available",
      );
    } finally {
      (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
    }
  });

  it("transitions from disconnected → connecting → connected", () => {
    const states: WsClientState[] = [];
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
    });
    client.on("stateChange", (s) => states.push(s));

    client.connect();
    expect(states).toContain("connecting");

    const ws = instances[0]!;
    completeHandshake(ws);
    expect(states).toContain("connected");
    expect(client.state).toBe("connected");
    client.close();
  });

  it("sends hello on open", () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
    });
    client.connect();

    const ws = instances[0]!;
    ws.simulateOpen();

    const messages = parseSent(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "hello", version: PROTOCOL_VERSION });
    client.close();
  });

  it("subscribe sends subscribe message after handshake", () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
    });
    client.connect();
    const ws = instances[0]!;

    // Subscribe before handshake
    client.subscribe("s1", { afterSeq: 5 });

    completeHandshake(ws);

    const messages = parseSent(ws);
    const subMsg = messages.find((m) => m.type === "subscribe");
    expect(subMsg).toEqual({ type: "subscribe", streamId: "s1", afterSeq: 5 });
    client.close();
  });

  it("subscribe yields events as AsyncIterable", async () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
    });
    client.connect();
    const ws = instances[0]!;

    const iter = client.subscribe<{ kind: string }>("s1");

    completeHandshake(ws);

    // Send events from "server"
    const event1: StoredEvent<{ kind: string }> = {
      seq: 1,
      timestamp: "2025-01-01T00:00:00Z",
      streamId: "s1",
      event: { kind: "a" },
    };
    const event2: StoredEvent<{ kind: string }> = {
      seq: 2,
      timestamp: "2025-01-01T00:00:01Z",
      streamId: "s1",
      event: { kind: "b" },
    };

    sendServer(ws, { type: "event", streamId: "s1", event: event1 });
    sendServer(ws, { type: "event", streamId: "s1", event: event2 });
    sendServer(ws, {
      type: "replay-end",
      streamId: "s1",
      lastReplaySeq: 2,
    });

    const items = await collectN(iter, 3);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual(event1);
    expect(items[1]).toEqual(event2);
    expect(items[2]).toEqual({
      type: "replay-end",
      streamId: "s1",
      lastReplaySeq: 2,
    });
    client.close();
  });

  it("responds to ping with pong", () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
    });
    client.connect();
    const ws = instances[0]!;
    completeHandshake(ws);
    ws.sentMessages.length = 0;

    sendServer(ws, { type: "ping" });

    const messages = parseSent(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "pong" });
    client.close();
  });

  it("triggers reconnect on heartbeat timeout", () => {
    const states: WsClientState[] = [];
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
      heartbeatTimeoutMs: 5_000,
      baseReconnectDelayMs: 100,
    });
    client.on("stateChange", (s) => states.push(s));
    client.connect();
    const ws = instances[0]!;
    completeHandshake(ws);

    // Advance past heartbeat timeout
    vi.advanceTimersByTime(5_000);

    // WebSocket should be closed → triggers reconnect
    expect(ws.readyState).toBe(3); // CLOSED
    expect(states).toContain("reconnecting");
    client.close();
  });

  it("reconnects with exponential backoff", () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
      baseReconnectDelayMs: 1_000,
      maxReconnectDelayMs: 30_000,
    });
    client.connect();
    const ws1 = instances[0]!;
    completeHandshake(ws1);

    // Disconnect
    ws1.simulateClose();
    expect(instances).toHaveLength(1); // Not yet reconnected

    // Wait for first reconnect (base delay ~1000ms + jitter)
    vi.advanceTimersByTime(1_250);
    expect(instances).toHaveLength(2);

    // Second disconnect
    instances[1]!.simulateOpen();
    instances[1]!.simulateClose();

    // Wait for second reconnect (base delay ~2000ms + jitter)
    vi.advanceTimersByTime(2_500);
    expect(instances).toHaveLength(3);

    client.close();
  });

  it("re-subscribes after reconnect with correct afterSeq", () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
      baseReconnectDelayMs: 100,
    });
    client.connect();
    const ws1 = instances[0]!;
    completeHandshake(ws1);

    client.subscribe("s1", { afterSeq: 0 });

    // Receive some events
    const event: StoredEvent<unknown> = {
      seq: 5,
      timestamp: "t",
      streamId: "s1",
      event: {},
    };
    sendServer(ws1, { type: "replay-end", streamId: "s1", lastReplaySeq: 0 });
    sendServer(ws1, { type: "event", streamId: "s1", event });

    // Disconnect and reconnect
    ws1.simulateClose();
    vi.advanceTimersByTime(125);

    const ws2 = instances[1]!;
    expect(ws2).toBeDefined();
    completeHandshake(ws2);

    // Check that subscribe was sent with afterSeq: 5
    const messages = parseSent(ws2);
    const subMsg = messages.find((m) => m.type === "subscribe");
    expect(subMsg).toEqual({ type: "subscribe", streamId: "s1", afterSeq: 5 });
    client.close();
  });

  it("deduplicates events during promotion window", async () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
    });
    client.connect();
    const ws = instances[0]!;
    const iter = client.subscribe<{ v: number }>("s1");
    completeHandshake(ws);

    // Send replay events
    sendServer(ws, {
      type: "event",
      streamId: "s1",
      event: { seq: 1, timestamp: "t", streamId: "s1", event: { v: 1 } },
    });
    sendServer(ws, {
      type: "event",
      streamId: "s1",
      event: { seq: 2, timestamp: "t", streamId: "s1", event: { v: 2 } },
    });
    sendServer(ws, {
      type: "replay-end",
      streamId: "s1",
      lastReplaySeq: 2,
    });

    // Now send live events including duplicates
    sendServer(ws, {
      type: "event",
      streamId: "s1",
      event: { seq: 2, timestamp: "t", streamId: "s1", event: { v: 2 } },
    }); // dup — should be dropped
    sendServer(ws, {
      type: "event",
      streamId: "s1",
      event: { seq: 3, timestamp: "t", streamId: "s1", event: { v: 3 } },
    }); // new

    // Collect: event1, event2, replay-end, event3 (dup dropped)
    const items = await collectN(iter, 4);
    expect(items).toHaveLength(4);

    const seqs = items.filter((i): i is StoredEvent<{ v: number }> => "seq" in i).map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3]); // no duplicate seq 2
    client.close();
  });

  it("close stops reconnection", () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
      baseReconnectDelayMs: 100,
    });
    client.connect();
    const ws = instances[0]!;
    completeHandshake(ws);

    // Disconnect
    ws.simulateClose();
    // Close before reconnect timer fires
    client.close();

    vi.advanceTimersByTime(200);
    // No new connection created
    expect(instances).toHaveLength(1);
    expect(client.state).toBe("closed");
  });

  it("close ends all subscription iterators", async () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
    });
    client.connect();
    const ws = instances[0]!;
    const iter = client.subscribe("s1");
    completeHandshake(ws);

    // Close client
    client.close();

    // Iterator should complete
    const result = await (iter[Symbol.asyncIterator]() as AsyncIterator<unknown>).next();
    expect(result.done).toBe(true);
  });

  it("AbortSignal cancels subscription", async () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
    });
    client.connect();
    const ws = instances[0]!;
    const ac = new AbortController();
    const iter = client.subscribe("s1", { signal: ac.signal });
    completeHandshake(ws);

    sendServer(ws, {
      type: "event",
      streamId: "s1",
      event: { seq: 1, timestamp: "t", streamId: "s1", event: {} },
    });

    ac.abort();

    // Should complete after abort
    const items: unknown[] = [];
    for await (const item of iter) {
      items.push(item);
    }
    // Got the event that was already pushed, then done
    expect(items).toHaveLength(1);
    client.close();
  });

  it("iterator return() unsubscribes", async () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
    });
    client.connect();
    const ws = instances[0]!;
    const iter = client.subscribe("s1");
    completeHandshake(ws);
    ws.sentMessages.length = 0;

    // Call return() on iterator
    const asyncIter = iter[Symbol.asyncIterator]();
    await asyncIter.return!();

    // Should have sent unsubscribe
    const messages = parseSent(ws);
    const unsubMsg = messages.find((m) => m.type === "unsubscribe");
    expect(unsubMsg).toEqual({ type: "unsubscribe", streamId: "s1" });
    client.close();
  });

  it("does not reconnect when reconnect is disabled", () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
      reconnect: false,
    });
    client.connect();
    const ws = instances[0]!;
    completeHandshake(ws);

    ws.simulateClose();

    vi.advanceTimersByTime(60_000);
    expect(instances).toHaveLength(1); // no reconnection
    expect(client.state).toBe("disconnected");
    client.close();
  });

  it("stops after maxReconnectAttempts", async () => {
    const errors: unknown[] = [];
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
      maxReconnectAttempts: 2,
      baseReconnectDelayMs: 100,
    });
    client.on("error", (error) => errors.push(error));
    client.connect();
    const iter = client.subscribe("s1");

    // First connection fails
    instances[0]!.simulateOpen();
    instances[0]!.simulateClose();
    vi.advanceTimersByTime(125); // attempt 1
    expect(instances).toHaveLength(2);

    instances[1]!.simulateOpen();
    instances[1]!.simulateClose();
    vi.advanceTimersByTime(250); // attempt 2
    expect(instances).toHaveLength(3);

    instances[2]!.simulateOpen();
    instances[2]!.simulateClose();

    // Should not attempt a 3rd reconnect
    vi.advanceTimersByTime(60_000);
    expect(instances).toHaveLength(3);
    expect(client.state).toBe("disconnected");
    expect(
      errors.some((error) => String(error).includes("Max reconnection attempts reached")),
    ).toBe(true);
    const result = await (iter[Symbol.asyncIterator]() as AsyncIterator<unknown>).next();
    expect(result.done).toBe(true);
    client.close();
  });

  it("connect after close throws", () => {
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
    });
    client.close();
    expect(() => client.connect()).toThrow("Cannot connect after close()");
    expect(instances).toHaveLength(0);
    expect(client.state).toBe("closed");
  });

  it("emits an error when receiving invalid server message payload", () => {
    const errors: unknown[] = [];
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
    });
    client.on("error", (error) => errors.push(error));
    client.connect();
    const ws = instances[0]!;
    completeHandshake(ws);

    ws.simulateMessage("{not-json");

    expect(errors.some((error) => String(error).includes("invalid server message"))).toBe(true);
    client.close();
  });

  it("emits error events from server error messages", () => {
    const errors: unknown[] = [];
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: Constructor,
    });
    client.on("error", (e) => errors.push(e));
    client.connect();
    const ws = instances[0]!;
    completeHandshake(ws);

    sendServer(ws, {
      type: "error",
      code: "UNKNOWN_STREAM",
      message: "Stream not found",
    });

    expect(errors).toHaveLength(1);
    expect((errors[0] as { code: string }).code).toBe("UNKNOWN_STREAM");
    client.close();
  });
});
