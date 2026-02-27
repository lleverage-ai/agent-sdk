import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WsClient } from "../../src/client/ws-client.js";
import { Projector } from "../../src/projector.js";
import { WsServer } from "../../src/server/ws-server.js";
import { InMemoryEventStore } from "../../src/stores/memory.js";
import type { StoredEvent } from "../../src/types.js";
import { createMockWebSocketConstructor, MockWebSocket } from "../helpers/mock-ws.js";

type TestEvent = { kind: string; value: number };

/**
 * Helper: wire a MockWebSocket pair to a WsServer (server side) and
 * a WsClient (client side) through linked MockWebSocket instances.
 *
 * The WsClient uses a mock constructor, and we link its instance to
 * a server-side MockWebSocket that we hand to WsServer.handleConnection().
 */
function wireClientToServer(
  server: WsServer,
  clientWsCtor: ReturnType<typeof createMockWebSocketConstructor>,
): {
  client: WsClient;
  getClientWs: () => MockWebSocket;
  getServerWs: () => MockWebSocket;
} {
  const serverWs = new MockWebSocket();
  serverWs.readyState = 1;

  const client = new WsClient({
    url: "ws://localhost",
    WebSocket: clientWsCtor.Constructor,
    reconnect: false,
  });

  const getClientWs = () => clientWsCtor.instances[clientWsCtor.instances.length - 1]!;

  client.connect();

  // Link the client-side mock to the server-side mock
  const clientWs = getClientWs();
  clientWs.peer = serverWs;
  serverWs.peer = clientWs;

  // Register with server
  server.handleConnection(serverWs);

  // Open the client-side socket (triggers hello → server-hello handshake)
  clientWs.simulateOpen();

  return { client, getClientWs: () => clientWs, getServerWs: () => serverWs };
}

describe("Replay-race integration", () => {
  let store: InMemoryEventStore<TestEvent>;
  let server: WsServer;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new InMemoryEventStore<TestEvent>();
    server = new WsServer({
      store: store as InMemoryEventStore<unknown>,
      heartbeatIntervalMs: 60_000,
      heartbeatTimeoutMs: 10_000,
    });
  });

  afterEach(() => {
    server.close();
    vi.useRealTimers();
  });

  it("delivers replay events then live events in order", async () => {
    // Pre-populate store
    await store.append("s1", [
      { kind: "a", value: 1 },
      { kind: "b", value: 2 },
      { kind: "c", value: 3 },
    ]);

    const mock = createMockWebSocketConstructor();
    const { client, getClientWs } = wireClientToServer(server, mock);

    const iter = client.subscribe<TestEvent>("s1");
    // Let handshake + subscribe + replay complete
    await vi.advanceTimersByTimeAsync(0);

    // Now broadcast a new live event
    const newEvents = await store.append("s1", [{ kind: "d", value: 4 }]);
    server.broadcast("s1", newEvents as StoredEvent<unknown>[]);

    const items = await collectN(iter, 5); // 3 replay + replay-end + 1 live
    const seqs = items.filter((i): i is StoredEvent<TestEvent> => "seq" in i).map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3, 4]);

    const replayEnd = items.find((i) => "type" in i && i.type === "replay-end");
    expect(replayEnd).toBeDefined();

    client.close();
  });

  it("new event during replay is buffered and delivered after replay-end", async () => {
    // Pre-populate with 10 events
    for (let i = 0; i < 10; i++) {
      await store.append("s1", [{ kind: "init", value: i + 1 }]);
    }

    const mock = createMockWebSocketConstructor();
    const { client } = wireClientToServer(server, mock);

    const iter = client.subscribe<TestEvent>("s1");

    // Broadcast event 11 synchronously before replay completes
    const newEvents = await store.append("s1", [{ kind: "live", value: 11 }]);
    server.broadcast("s1", newEvents as StoredEvent<unknown>[]);

    await vi.advanceTimersByTimeAsync(0);

    // Collect all: 10 replay + replay-end + 1 live = 12
    const items = await collectN(iter, 12);

    const seqs = items.filter((i): i is StoredEvent<TestEvent> => "seq" in i).map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    // Replay-end should come before event 11
    const replayEndIdx = items.findIndex((i) => "type" in i && i.type === "replay-end");
    const event11Idx = items.findIndex(
      (i) => "seq" in i && (i as StoredEvent<TestEvent>).seq === 11,
    );
    expect(replayEndIdx).toBeLessThan(event11Idx);

    client.close();
  });

  it("deduplicates events that appear in both replay and live", async () => {
    // Store has events 1-5
    const stored = await store.append("s1", [
      { kind: "a", value: 1 },
      { kind: "b", value: 2 },
      { kind: "c", value: 3 },
      { kind: "d", value: 4 },
      { kind: "e", value: 5 },
    ]);

    const mock = createMockWebSocketConstructor();
    const { client } = wireClientToServer(server, mock);

    const iter = client.subscribe<TestEvent>("s1");

    // Broadcast events 4,5 as if they arrived live during replay
    server.broadcast("s1", [stored[3]!, stored[4]!] as StoredEvent<unknown>[]);

    await vi.advanceTimersByTimeAsync(0);

    // Should get: 5 unique events + replay-end = 6 items
    const items = await collectN(iter, 6);

    const seqs = items.filter((i): i is StoredEvent<TestEvent> => "seq" in i).map((e) => e.seq);
    // Each seq appears exactly once
    expect(seqs).toEqual([1, 2, 3, 4, 5]);

    client.close();
  });

  it("events arrive in seq order after promotion", async () => {
    await store.append("s1", [{ kind: "init", value: 1 }]);

    const mock = createMockWebSocketConstructor();
    const { client } = wireClientToServer(server, mock);

    const iter = client.subscribe<TestEvent>("s1");
    await vi.advanceTimersByTimeAsync(0);

    // Broadcast multiple events in order
    for (let i = 2; i <= 5; i++) {
      const events = await store.append("s1", [{ kind: "live", value: i }]);
      server.broadcast("s1", events as StoredEvent<unknown>[]);
    }

    // 1 replay + replay-end + 4 live = 6
    const items = await collectN(iter, 6);
    const seqs = items.filter((i): i is StoredEvent<TestEvent> => "seq" in i).map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);

    client.close();
  });

  it("projector state matches after replay→live transition", async () => {
    // Create projector
    const projector = new Projector<{ total: number }, TestEvent>({
      initialState: { total: 0 },
      reducer: (state, event) => ({
        total: state.total + event.event.value,
      }),
    });

    // Store events
    await store.append("s1", [
      { kind: "add", value: 10 },
      { kind: "add", value: 20 },
    ]);

    const mock = createMockWebSocketConstructor();
    const { client } = wireClientToServer(server, mock);

    const iter = client.subscribe<TestEvent>("s1");
    await vi.advanceTimersByTimeAsync(0);

    // Add live event
    const live = await store.append("s1", [{ kind: "add", value: 30 }]);
    server.broadcast("s1", live as StoredEvent<unknown>[]);

    // Apply to projector
    const items = await collectN(iter, 4); // 2 replay + replay-end + 1 live
    for (const item of items) {
      if ("seq" in item) {
        projector.apply([item as StoredEvent<TestEvent>]);
      }
    }

    expect(projector.getState()).toEqual({ total: 60 });
    expect(projector.getLastSeq()).toBe(3);

    // Verify projector matches direct catch-up
    const freshProjector = new Projector<{ total: number }, TestEvent>({
      initialState: { total: 0 },
      reducer: (state, event) => ({
        total: state.total + event.event.value,
      }),
    });
    await freshProjector.catchUp(store, "s1");
    expect(freshProjector.getState()).toEqual(projector.getState());

    client.close();
  });

  it("subscribe with afterSeq skips already-seen events", async () => {
    await store.append("s1", [
      { kind: "a", value: 1 },
      { kind: "b", value: 2 },
      { kind: "c", value: 3 },
      { kind: "d", value: 4 },
      { kind: "e", value: 5 },
    ]);

    const mock = createMockWebSocketConstructor();
    const { client } = wireClientToServer(server, mock);

    // Subscribe starting after seq 3
    const iter = client.subscribe<TestEvent>("s1", { afterSeq: 3 });
    await vi.advanceTimersByTimeAsync(0);

    const items = await collectN(iter, 3); // 2 events + replay-end
    const seqs = items.filter((i): i is StoredEvent<TestEvent> => "seq" in i).map((e) => e.seq);
    expect(seqs).toEqual([4, 5]);

    client.close();
  });
});

async function collectN<T>(iter: AsyncIterable<T>, n: number): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iter) {
    items.push(item);
    if (items.length >= n) break;
  }
  return items;
}
