import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientMessage, ServerMessage } from "../../src/protocol.js";
import { encodeMessage, PROTOCOL_ERRORS, PROTOCOL_VERSION } from "../../src/protocol.js";
import { WsServer } from "../../src/server/ws-server.js";
import { InMemoryEventStore } from "../../src/stores/memory.js";
import type { StoredEvent } from "../../src/types.js";
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

function createSubscribedClient(server: WsServer, streamId: string): MockWebSocket {
  const ws = new MockWebSocket();
  ws.readyState = 1;
  server.handleConnection(ws);
  doHandshake(ws);
  sendClient(ws, { type: "subscribe", streamId });
  return ws;
}

function countEventMessages(ws: MockWebSocket): number {
  return parseSent(ws).filter((m) => m.type === "event").length;
}

describe("WsServer broadcast load", () => {
  let store: InMemoryEventStore<TestEvent>;
  let server: WsServer;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new InMemoryEventStore<TestEvent>();
    server = new WsServer({
      store: store as InMemoryEventStore<unknown>,
      heartbeatIntervalMs: 60_000,
      heartbeatTimeoutMs: 10_000,
      maxBufferSize: 2000,
    });
  });

  afterEach(() => {
    server.close();
    vi.useRealTimers();
  });

  it("broadcasts 1000 events to 1 client", async () => {
    const ws = createSubscribedClient(server, "s1");
    await vi.advanceTimersByTimeAsync(0);
    ws.sentMessages.length = 0;

    for (let i = 0; i < 1000; i++) {
      const events = await store.append("s1", [{ kind: "e", value: i }]);
      server.broadcast("s1", events as StoredEvent<unknown>[]);
    }

    expect(countEventMessages(ws)).toBe(1000);
  });

  it("broadcasts 100 events to 50 clients", async () => {
    const clients: MockWebSocket[] = [];
    for (let i = 0; i < 50; i++) {
      clients.push(createSubscribedClient(server, "s1"));
    }
    await vi.advanceTimersByTimeAsync(0);
    for (const ws of clients) ws.sentMessages.length = 0;

    for (let i = 0; i < 100; i++) {
      const events = await store.append("s1", [{ kind: "e", value: i }]);
      server.broadcast("s1", events as StoredEvent<unknown>[]);
    }

    for (const ws of clients) {
      expect(countEventMessages(ws)).toBe(100);
    }
  });

  it("broadcasts 100 events to 100 clients", async () => {
    const clients: MockWebSocket[] = [];
    for (let i = 0; i < 100; i++) {
      clients.push(createSubscribedClient(server, "s1"));
    }
    await vi.advanceTimersByTimeAsync(0);
    for (const ws of clients) ws.sentMessages.length = 0;

    for (let i = 0; i < 100; i++) {
      const events = await store.append("s1", [{ kind: "e", value: i }]);
      server.broadcast("s1", events as StoredEvent<unknown>[]);
    }

    for (const ws of clients) {
      expect(countEventMessages(ws)).toBe(100);
    }
  });

  it("replays 1000 events on subscribe", async () => {
    for (let i = 0; i < 1000; i++) {
      await store.append("s1", [{ kind: "e", value: i }]);
    }

    const ws = createSubscribedClient(server, "s1");
    await vi.advanceTimersByTimeAsync(0);

    const messages = parseSent(ws);
    const eventMessages = messages.filter((m) => m.type === "event");
    const replayEnd = messages.find((m) => m.type === "replay-end");

    expect(eventMessages).toHaveLength(1000);
    expect(replayEnd).toBeDefined();
    expect((replayEnd as { lastReplaySeq: number }).lastReplaySeq).toBe(1000);

    // Verify ordering
    const seqs = eventMessages.map((m) => (m as { event: StoredEvent<TestEvent> }).event.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]!).toBe(seqs[i - 1]! + 1);
    }
  });

  it("replays 500 + live 500 during replay — deduped and ordered", async () => {
    // Pre-populate with 500 events
    for (let i = 0; i < 500; i++) {
      await store.append("s1", [{ kind: "e", value: i }]);
    }

    const ws = createSubscribedClient(server, "s1");

    // Before replay completes, broadcast 500 more
    for (let i = 500; i < 1000; i++) {
      const events = await store.append("s1", [{ kind: "e", value: i }]);
      server.broadcast("s1", events as StoredEvent<unknown>[]);
    }

    // Let replay complete
    await vi.advanceTimersByTimeAsync(0);

    const messages = parseSent(ws);
    const eventMessages = messages.filter((m) => m.type === "event");
    const seqs = eventMessages.map((m) => (m as { event: StoredEvent<TestEvent> }).event.seq);

    // All 1000 events should be present, no duplicates
    expect(seqs).toHaveLength(1000);
    const uniqueSeqs = new Set(seqs);
    expect(uniqueSeqs.size).toBe(1000);

    // Check ordering
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
  });

  it("buffer overflow under load disconnects client", async () => {
    // Use a server with small buffer
    server.close();
    server = new WsServer({
      store: store as InMemoryEventStore<unknown>,
      heartbeatIntervalMs: 60_000,
      heartbeatTimeoutMs: 10_000,
      maxBufferSize: 5,
    });

    const ws = createSubscribedClient(server, "s1");
    // Do NOT advance timers — replay is pending, so events buffer

    const events: StoredEvent<unknown>[] = [];
    for (let i = 1; i <= 10; i++) {
      events.push({
        seq: i,
        timestamp: new Date().toISOString(),
        streamId: "s1",
        event: { kind: "overflow", value: i },
      });
    }
    server.broadcast("s1", events);

    const messages = parseSent(ws);
    const errorMsg = messages.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    expect((errorMsg as { code: string }).code).toBe(PROTOCOL_ERRORS.BUFFER_OVERFLOW);
    expect(ws.readyState).toBe(3); // CLOSED
  });
});
