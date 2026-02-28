import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientMessage, ServerMessage } from "../../../src/stream/protocol.js";
import { encodeMessage, PROTOCOL_ERRORS, PROTOCOL_VERSION } from "../../../src/stream/protocol.js";
import { WsServer } from "../../../src/stream/server/ws-server.js";
import { InMemoryEventStore } from "../../../src/stream/stores/memory.js";
import type { IEventStore, StoredEvent } from "../../../src/stream/types.js";
import { MockWebSocket } from "../helpers/mock-ws.js";

type TestEvent = { kind: string; value: number };

function parseSent(ws: MockWebSocket): ServerMessage[] {
  return ws.sentMessages.map((m) => JSON.parse(m) as ServerMessage);
}

function sendClient(ws: MockWebSocket, msg: ClientMessage): void {
  ws.simulateMessage(encodeMessage(msg));
}

function doHandshake(ws: MockWebSocket): void {
  sendClient(ws, { type: "hello", version: PROTOCOL_VERSION });
}

describe("WsServer", () => {
  let store: InMemoryEventStore<TestEvent>;
  let server: WsServer;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new InMemoryEventStore<TestEvent>();
    server = new WsServer({
      store: store as InMemoryEventStore<unknown>,
      heartbeatIntervalMs: 30_000,
      heartbeatTimeoutMs: 10_000,
      maxBufferSize: 5,
    });
  });

  afterEach(() => {
    server.close();
    vi.useRealTimers();
  });

  it("responds with server-hello on valid handshake", () => {
    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);

    const messages = parseSent(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: "server-hello",
      version: PROTOCOL_VERSION,
    });
  });

  it("rejects version mismatch with error and close", () => {
    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    sendClient(ws, { type: "hello", version: 999 });

    const messages = parseSent(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe("error");
    expect((messages[0] as { code: string }).code).toBe(PROTOCOL_ERRORS.VERSION_MISMATCH);
    expect(ws.readyState).toBe(3); // CLOSED
  });

  it("replays events and sends replay-end on subscribe", async () => {
    await store.append("s1", [
      { kind: "a", value: 1 },
      { kind: "b", value: 2 },
    ]);

    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);
    ws.sentMessages.length = 0; // clear server-hello

    sendClient(ws, { type: "subscribe", streamId: "s1" });
    // Let async replay complete
    await vi.advanceTimersByTimeAsync(0);

    const messages = parseSent(ws);
    // 2 event messages + 1 replay-end
    expect(messages).toHaveLength(3);
    expect(messages[0]!.type).toBe("event");
    expect(messages[1]!.type).toBe("event");
    expect(messages[2]).toEqual({
      type: "replay-end",
      streamId: "s1",
      lastReplaySeq: 2,
    });
  });

  it("replays only events after afterSeq", async () => {
    await store.append("s1", [
      { kind: "a", value: 1 },
      { kind: "b", value: 2 },
      { kind: "c", value: 3 },
    ]);

    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);
    ws.sentMessages.length = 0;

    sendClient(ws, { type: "subscribe", streamId: "s1", afterSeq: 2 });
    await vi.advanceTimersByTimeAsync(0);

    const messages = parseSent(ws);
    expect(messages).toHaveLength(2); // 1 event + replay-end
    expect(messages[0]!.type).toBe("event");
    const eventMsg = messages[0] as { event: StoredEvent<TestEvent> };
    expect(eventMsg.event.seq).toBe(3);
    expect(messages[1]).toEqual({
      type: "replay-end",
      streamId: "s1",
      lastReplaySeq: 3,
    });
  });

  it("does not deliver replay frames after unsubscribe during in-flight replay", async () => {
    let resolveReplay: ((events: StoredEvent<unknown>[]) => void) | null = null;
    const blockingStore: IEventStore<unknown> = {
      append: async () => [],
      replay: async () =>
        new Promise<StoredEvent<unknown>[]>((resolve) => {
          resolveReplay = resolve;
        }),
      head: async () => 0,
      delete: async () => undefined,
    };
    server = new WsServer({
      store: blockingStore,
      heartbeatIntervalMs: 30_000,
      heartbeatTimeoutMs: 10_000,
      maxBufferSize: 5,
    });

    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);
    ws.sentMessages.length = 0;

    sendClient(ws, { type: "subscribe", streamId: "s1" });
    sendClient(ws, { type: "unsubscribe", streamId: "s1" });

    resolveReplay?.([
      {
        seq: 1,
        timestamp: new Date().toISOString(),
        streamId: "s1",
        event: { kind: "replayed", value: 1 },
      },
    ]);
    await vi.advanceTimersByTimeAsync(0);

    expect(parseSent(ws)).toHaveLength(0);
  });

  it("broadcast delivers to subscribed clients only", async () => {
    const ws1 = new MockWebSocket();
    ws1.readyState = 1;
    const ws2 = new MockWebSocket();
    ws2.readyState = 1;

    server.handleConnection(ws1);
    server.handleConnection(ws2);
    doHandshake(ws1);
    doHandshake(ws2);

    // ws1 subscribes to s1, ws2 subscribes to s2
    sendClient(ws1, { type: "subscribe", streamId: "s1" });
    sendClient(ws2, { type: "subscribe", streamId: "s2" });
    await vi.advanceTimersByTimeAsync(0);

    ws1.sentMessages.length = 0;
    ws2.sentMessages.length = 0;

    const events = await store.append("s1", [{ kind: "x", value: 42 }]);
    server.broadcast("s1", events as StoredEvent<unknown>[]);

    expect(parseSent(ws1)).toHaveLength(1);
    expect(parseSent(ws1)[0]!.type).toBe("event");
    expect(parseSent(ws2)).toHaveLength(0);
  });

  it("buffers live events during replay and flushes after", async () => {
    // Pre-populate store with events
    await store.append("s1", [
      { kind: "a", value: 1 },
      { kind: "b", value: 2 },
    ]);

    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);
    ws.sentMessages.length = 0;

    sendClient(ws, { type: "subscribe", streamId: "s1" });

    // Before replay completes, broadcast a new event
    const newEvents = await store.append("s1", [{ kind: "c", value: 3 }]);
    server.broadcast("s1", newEvents as StoredEvent<unknown>[]);

    // Now let replay complete
    await vi.advanceTimersByTimeAsync(0);

    const messages = parseSent(ws);
    // 2 replay events + replay-end + 1 live event (buffered and flushed)
    expect(messages).toHaveLength(4);
    expect(messages[0]!.type).toBe("event");
    expect(messages[1]!.type).toBe("event");
    expect(messages[2]!.type).toBe("replay-end");
    expect(messages[3]!.type).toBe("event");
    const liveEvent = messages[3] as { event: StoredEvent<TestEvent> };
    expect(liveEvent.event.seq).toBe(3);
  });

  it("deduplicates buffered events that were also replayed", async () => {
    // Store has events 1-3
    const stored = await store.append("s1", [
      { kind: "a", value: 1 },
      { kind: "b", value: 2 },
      { kind: "c", value: 3 },
    ]);

    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);
    ws.sentMessages.length = 0;

    sendClient(ws, { type: "subscribe", streamId: "s1" });

    // Broadcast events 2-3 synchronously before replay microtask completes
    server.broadcast("s1", [stored[1]!, stored[2]!] as StoredEvent<unknown>[]);

    await vi.advanceTimersByTimeAsync(0);

    const messages = parseSent(ws);
    // 3 replay events + replay-end, buffered events 2-3 deduped (seq <= lastReplaySeq=3)
    expect(messages).toHaveLength(4); // no duplicates
    const eventSeqs = messages
      .filter((m) => m.type === "event")
      .map((m) => (m as { event: StoredEvent<TestEvent> }).event.seq);
    expect(eventSeqs).toEqual([1, 2, 3]);
  });

  it("sends heartbeat ping and handles pong", async () => {
    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);
    ws.sentMessages.length = 0;

    // Advance past heartbeat interval
    vi.advanceTimersByTime(30_000);
    const messages = parseSent(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "ping" });

    // Respond with pong
    sendClient(ws, { type: "pong" });

    // Advance past timeout — should NOT disconnect because we sent pong
    vi.advanceTimersByTime(10_000);
    expect(ws.readyState).toBe(1); // still OPEN
  });

  it("clears stale heartbeat timeouts from earlier ping cycles", () => {
    server = new WsServer({
      store: store as InMemoryEventStore<unknown>,
      heartbeatIntervalMs: 10,
      heartbeatTimeoutMs: 25,
      maxBufferSize: 5,
    });

    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);

    // Trigger two heartbeat cycles; second cycle should clear first timeout.
    vi.advanceTimersByTime(10);
    vi.advanceTimersByTime(10);
    sendClient(ws, { type: "pong" });

    // Advance past where the first timeout would have fired if left armed.
    vi.advanceTimersByTime(15);
    expect(ws.readyState).toBe(1); // still OPEN
  });

  it("disconnects on heartbeat timeout (no pong)", () => {
    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);

    // Advance past heartbeat interval + timeout
    vi.advanceTimersByTime(30_000 + 10_000);
    expect(ws.readyState).toBe(3); // CLOSED
  });

  it("disconnects client on buffer overflow", async () => {
    // Store has no events, so replay is instant
    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);

    sendClient(ws, { type: "subscribe", streamId: "s1" });

    // Buffer events before replay completes (maxBufferSize=5)
    const events: StoredEvent<unknown>[] = [];
    for (let i = 1; i <= 6; i++) {
      events.push({
        seq: i,
        timestamp: new Date().toISOString(),
        streamId: "s1",
        event: { kind: "overflow", value: i },
      });
    }
    server.broadcast("s1", events);

    // Client should be disconnected
    const messages = parseSent(ws);
    const errorMsg = messages.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect((errorMsg as { code: string }).code).toBe(PROTOCOL_ERRORS.BUFFER_OVERFLOW);
  });

  it("continues processing other clients when one overflows", async () => {
    const ws1 = new MockWebSocket();
    ws1.readyState = 1;
    const ws2 = new MockWebSocket();
    ws2.readyState = 1;
    server.handleConnection(ws1);
    server.handleConnection(ws2);
    doHandshake(ws1);
    doHandshake(ws2);

    sendClient(ws1, { type: "subscribe", streamId: "s1" });
    sendClient(ws2, { type: "subscribe", streamId: "s1" });

    const events: StoredEvent<unknown>[] = [];
    for (let i = 1; i <= 6; i++) {
      events.push({
        seq: i,
        timestamp: new Date().toISOString(),
        streamId: "s1",
        event: { kind: "overflow", value: i },
      });
    }
    server.broadcast("s1", events);

    const ws1Error = parseSent(ws1).find((m) => m.type === "error");
    const ws2Error = parseSent(ws2).find((m) => m.type === "error");
    expect((ws1Error as { code: string }).code).toBe(PROTOCOL_ERRORS.BUFFER_OVERFLOW);
    expect((ws2Error as { code: string }).code).toBe(PROTOCOL_ERRORS.BUFFER_OVERFLOW);
  });

  it("sends replay error when store replay fails", async () => {
    const failingStore: IEventStore<unknown> = {
      append: async () => [],
      replay: async () => {
        throw new Error("boom");
      },
      head: async () => 0,
      delete: async () => undefined,
    };
    server = new WsServer({
      store: failingStore,
      heartbeatIntervalMs: 30_000,
      heartbeatTimeoutMs: 10_000,
      maxBufferSize: 5,
    });

    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);
    ws.sentMessages.length = 0;

    sendClient(ws, { type: "subscribe", streamId: "s1" });
    await vi.advanceTimersByTimeAsync(0);

    const errorMsg = parseSent(ws).find((m) => m.type === "error") as
      | { type: "error"; code: string }
      | undefined;
    expect(errorMsg?.code).toBe(PROTOCOL_ERRORS.REPLAY_FAILED);
  });

  it("unsubscribe stops event delivery", async () => {
    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);
    sendClient(ws, { type: "subscribe", streamId: "s1" });
    await vi.advanceTimersByTimeAsync(0);
    ws.sentMessages.length = 0;

    sendClient(ws, { type: "unsubscribe", streamId: "s1" });

    const events = await store.append("s1", [{ kind: "x", value: 1 }]);
    server.broadcast("s1", events as StoredEvent<unknown>[]);

    expect(parseSent(ws)).toHaveLength(0);
  });

  it("handles client disconnect gracefully", async () => {
    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);
    sendClient(ws, { type: "subscribe", streamId: "s1" });
    await vi.advanceTimersByTimeAsync(0);

    ws.simulateClose();

    // Broadcasting after disconnect should not throw
    const events = await store.append("s1", [{ kind: "x", value: 1 }]);
    expect(() => server.broadcast("s1", events as StoredEvent<unknown>[])).not.toThrow();
  });

  it("removes client on websocket error event", async () => {
    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    doHandshake(ws);
    sendClient(ws, { type: "subscribe", streamId: "s1" });
    await vi.advanceTimersByTimeAsync(0);
    ws.sentMessages.length = 0;

    ws.simulateError("boom");

    const events = await store.append("s1", [{ kind: "x", value: 1 }]);
    server.broadcast("s1", events as StoredEvent<unknown>[]);
    expect(parseSent(ws)).toHaveLength(0);
  });

  it("sends error for invalid message format", () => {
    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);

    ws.simulateMessage("not valid json{{{");
    const messages = parseSent(ws);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe("error");
    expect((messages[0] as { code: string }).code).toBe(PROTOCOL_ERRORS.INVALID_MESSAGE);
  });

  it("close() disconnects all clients", async () => {
    const ws1 = new MockWebSocket();
    ws1.readyState = 1;
    const ws2 = new MockWebSocket();
    ws2.readyState = 1;

    server.handleConnection(ws1);
    server.handleConnection(ws2);
    doHandshake(ws1);
    doHandshake(ws2);

    server.close();

    expect(ws1.readyState).toBe(3);
    expect(ws2.readyState).toBe(3);
  });

  it("rejects new connections after close", () => {
    server.close();

    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);
    expect(ws.readyState).toBe(3);
  });

  it("ignores subscribe before handshake", async () => {
    const ws = new MockWebSocket();
    ws.readyState = 1;
    server.handleConnection(ws);

    // Send subscribe without hello first
    sendClient(ws, { type: "subscribe", streamId: "s1" });
    await vi.advanceTimersByTimeAsync(0);

    expect(parseSent(ws)).toHaveLength(0);
  });
});
