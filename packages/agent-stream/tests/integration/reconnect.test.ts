import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WsClient } from "../../src/client/ws-client.js";
import { WsServer } from "../../src/server/ws-server.js";
import { InMemoryEventStore } from "../../src/stores/memory.js";
import type { StoredEvent } from "../../src/types.js";
import { createMockWebSocketConstructor, MockWebSocket } from "../helpers/mock-ws.js";

type TestEvent = { kind: string; value: number };

/** Flush pending microtasks (e.g. from async replayAndPromote). */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

/**
 * Pull exactly N items from an async iterator WITHOUT calling return().
 * Unlike `for await...break`, this preserves the subscription across calls.
 */
async function pullN<T>(iterator: AsyncIterator<T>, n: number): Promise<T[]> {
  const items: T[] = [];
  for (let i = 0; i < n; i++) {
    const result = await iterator.next();
    if (result.done) break;
    items.push(result.value);
  }
  return items;
}

function connectClientToServer(
  server: WsServer,
  mock: ReturnType<typeof createMockWebSocketConstructor>,
  instanceIdx: number,
): { clientWs: MockWebSocket; serverWs: MockWebSocket } {
  const clientWs = mock.instances[instanceIdx]!;
  const serverWs = new MockWebSocket();
  serverWs.readyState = 1;
  clientWs.peer = serverWs;
  serverWs.peer = clientWs;
  server.handleConnection(serverWs);
  clientWs.simulateOpen();
  return { clientWs, serverWs };
}

describe("Reconnection integration", () => {
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

  it("resumes from lastConfirmedSeq after reconnect", async () => {
    const mock = createMockWebSocketConstructor();

    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: mock.Constructor,
      baseReconnectDelayMs: 100,
      maxReconnectDelayMs: 200,
    });

    // -- First connection --
    client.connect();
    connectClientToServer(server, mock, 0);

    const iterable = client.subscribe<TestEvent>("s1");
    const iterator = iterable[Symbol.asyncIterator]();
    await flushMicrotasks(); // replay of empty store → replay-end

    // Add and broadcast events 1-5
    const ev1 = await store.append("s1", [
      { kind: "a", value: 1 },
      { kind: "b", value: 2 },
      { kind: "c", value: 3 },
      { kind: "d", value: 4 },
      { kind: "e", value: 5 },
    ]);
    for (const e of ev1) server.broadcast("s1", [e] as StoredEvent<unknown>[]);

    const firstBatch = await pullN(iterator, 6); // replay-end + 5 events
    expect(
      firstBatch.filter((i): i is StoredEvent<TestEvent> => "seq" in i).map((e) => e.seq),
    ).toEqual([1, 2, 3, 4, 5]);

    // -- Disconnect --
    mock.instances[0]!.simulateClose();

    // Add events 6-8 while disconnected
    await store.append("s1", [
      { kind: "f", value: 6 },
      { kind: "g", value: 7 },
      { kind: "h", value: 8 },
    ]);

    // -- Reconnect --
    vi.advanceTimersByTime(250);
    connectClientToServer(server, mock, 1);
    await flushMicrotasks();

    const secondBatch = await pullN(iterator, 4); // 3 events + replay-end
    const secondSeqs = secondBatch
      .filter((i): i is StoredEvent<TestEvent> => "seq" in i)
      .map((e) => e.seq);
    expect(secondSeqs).toEqual([6, 7, 8]);

    client.close();
  });

  it("reconnection during replay restarts from last confirmed seq", async () => {
    // Pre-populate store with 10 events
    for (let i = 1; i <= 10; i++) {
      await store.append("s1", [{ kind: "init", value: i }]);
    }

    const mock = createMockWebSocketConstructor();

    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: mock.Constructor,
      baseReconnectDelayMs: 100,
    });

    client.connect();
    connectClientToServer(server, mock, 0);

    const iterable = client.subscribe<TestEvent>("s1");
    const iterator = iterable[Symbol.asyncIterator]();
    await flushMicrotasks();

    const firstBatch = await pullN(iterator, 11);
    expect(
      firstBatch.filter((i): i is StoredEvent<TestEvent> => "seq" in i).map((e) => e.seq),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // -- Disconnect and add more events --
    mock.instances[0]!.simulateClose();
    await store.append("s1", [
      { kind: "new", value: 11 },
      { kind: "new", value: 12 },
    ]);

    // -- Reconnect --
    vi.advanceTimersByTime(250);
    connectClientToServer(server, mock, 1);
    await flushMicrotasks();

    const secondBatch = await pullN(iterator, 3); // 2 events + replay-end
    const secondSeqs = secondBatch
      .filter((i): i is StoredEvent<TestEvent> => "seq" in i)
      .map((e) => e.seq);
    expect(secondSeqs).toEqual([11, 12]);

    client.close();
  });

  it("multiple reconnections maintain correct sequence tracking", async () => {
    const mock = createMockWebSocketConstructor();

    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: mock.Constructor,
      baseReconnectDelayMs: 100,
    });

    client.connect();
    connectClientToServer(server, mock, 0);

    const iterable = client.subscribe<TestEvent>("s1");
    const iterator = iterable[Symbol.asyncIterator]();
    await flushMicrotasks();

    // Session 1: events 1-3
    const ev1 = await store.append("s1", [
      { kind: "a", value: 1 },
      { kind: "b", value: 2 },
      { kind: "c", value: 3 },
    ]);
    for (const e of ev1) server.broadcast("s1", [e] as StoredEvent<unknown>[]);

    const batch1 = await pullN(iterator, 4); // replay-end + 3 events
    expect(batch1.filter((i): i is StoredEvent<TestEvent> => "seq" in i).map((e) => e.seq)).toEqual(
      [1, 2, 3],
    );

    // Disconnect 1
    mock.instances[0]!.simulateClose();
    await store.append("s1", [{ kind: "d", value: 4 }]);

    // Reconnect 1
    vi.advanceTimersByTime(250);
    connectClientToServer(server, mock, 1);
    await flushMicrotasks();

    const batch2 = await pullN(iterator, 2); // 1 event + replay-end
    expect(batch2.filter((i): i is StoredEvent<TestEvent> => "seq" in i).map((e) => e.seq)).toEqual(
      [4],
    );

    // Disconnect 2
    mock.instances[1]!.simulateClose();
    await store.append("s1", [{ kind: "e", value: 5 }]);

    // Reconnect 2
    vi.advanceTimersByTime(250);
    connectClientToServer(server, mock, 2);
    await flushMicrotasks();

    const batch3 = await pullN(iterator, 2); // 1 event + replay-end
    expect(batch3.filter((i): i is StoredEvent<TestEvent> => "seq" in i).map((e) => e.seq)).toEqual(
      [5],
    );

    client.close();
  });

  it("live events after reconnect are delivered correctly", async () => {
    const mock = createMockWebSocketConstructor();

    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: mock.Constructor,
      baseReconnectDelayMs: 100,
    });

    client.connect();
    connectClientToServer(server, mock, 0);

    const iterable = client.subscribe<TestEvent>("s1");
    const iterator = iterable[Symbol.asyncIterator]();
    await flushMicrotasks();

    // Initial live event
    const ev1 = await store.append("s1", [{ kind: "a", value: 1 }]);
    server.broadcast("s1", ev1 as StoredEvent<unknown>[]);

    const batch1 = await pullN(iterator, 2); // replay-end + 1 event
    expect(batch1.filter((i): i is StoredEvent<TestEvent> => "seq" in i).map((e) => e.seq)).toEqual(
      [1],
    );

    // Disconnect and reconnect
    mock.instances[0]!.simulateClose();
    vi.advanceTimersByTime(250);
    connectClientToServer(server, mock, 1);
    await flushMicrotasks();

    // Collect replay-end only (afterSeq=1, no new events to replay)
    const batch2 = await pullN(iterator, 1);
    expect(batch2[0]).toHaveProperty("type", "replay-end");

    // Now broadcast new live events after reconnect
    const ev2 = await store.append("s1", [{ kind: "b", value: 2 }]);
    server.broadcast("s1", ev2 as StoredEvent<unknown>[]);

    const liveItems = await pullN(iterator, 1);
    const liveSeqs = liveItems
      .filter((i): i is StoredEvent<TestEvent> => "seq" in i)
      .map((e) => e.seq);
    expect(liveSeqs).toEqual([2]);

    client.close();
  });
});
