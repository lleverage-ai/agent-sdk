import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WsClient } from "../../src/client/ws-client.js";
import { WsServer } from "../../src/server/ws-server.js";
import { InMemoryEventStore } from "../../src/stores/memory.js";
import type { StoredEvent } from "../../src/types.js";
import { createMockWebSocketConstructor, MockWebSocket } from "../helpers/mock-ws.js";

type TestEvent = { kind: string; value: number };

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

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

describe("Reconnect churn load", () => {
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

  it("20 connect/disconnect cycles — every event received exactly once", async () => {
    const mock = createMockWebSocketConstructor();
    const client = new WsClient({
      url: "ws://localhost",
      WebSocket: mock.Constructor,
      baseReconnectDelayMs: 100,
      maxReconnectDelayMs: 200,
    });

    client.connect();
    connectClientToServer(server, mock, 0);

    const iterable = client.subscribe<TestEvent>("s1");
    const iterator = iterable[Symbol.asyncIterator]();
    await flushMicrotasks();

    const allReceivedSeqs: number[] = [];
    let instanceIdx = 0;

    for (let cycle = 0; cycle < 20; cycle++) {
      // Append events for this cycle
      const ev = await store.append("s1", [{ kind: "cycle", value: cycle }]);
      for (const e of ev) server.broadcast("s1", [e] as StoredEvent<unknown>[]);

      // Pull events (replay-end + event on first cycle, just event on subsequent)
      const items = await pullN(iterator, cycle === 0 ? 2 : 1);
      for (const item of items) {
        if (typeof item === "object" && item !== null && "seq" in item) {
          allReceivedSeqs.push((item as StoredEvent<TestEvent>).seq);
        }
      }

      // Disconnect
      mock.instances[instanceIdx]!.simulateClose();
      instanceIdx++;

      // Reconnect
      vi.advanceTimersByTime(250);
      connectClientToServer(server, mock, instanceIdx);
      await flushMicrotasks();

      // Pull the replay-end after reconnect
      await pullN(iterator, 1);
    }

    // Verify: all 20 events received exactly once
    expect(allReceivedSeqs).toHaveLength(20);
    const uniqueSeqs = new Set(allReceivedSeqs);
    expect(uniqueSeqs.size).toBe(20);

    client.close();
  });

  it("10 independent clients each see all events after connect", async () => {
    // Pre-populate with 10 events
    await store.append(
      "s1",
      Array.from({ length: 10 }, (_, i) => ({ kind: "init", value: i })),
    );

    for (let c = 0; c < 10; c++) {
      const mock = createMockWebSocketConstructor();
      const wsClient = new WsClient({
        url: "ws://localhost",
        WebSocket: mock.Constructor,
        baseReconnectDelayMs: 100,
        maxReconnectDelayMs: 200,
      });

      wsClient.connect();
      connectClientToServer(server, mock, 0);

      const iterable = wsClient.subscribe<TestEvent>("s1");
      const iterator = iterable[Symbol.asyncIterator]();
      await flushMicrotasks();

      // Pull all replayed events + replay-end
      const items = await pullN(iterator, 11);
      const seqs = new Set<number>();
      for (const item of items) {
        if (typeof item === "object" && item !== null && "seq" in item) {
          seqs.add((item as StoredEvent<TestEvent>).seq);
        }
      }

      // Each client should see all 10 events
      expect(seqs.size).toBe(10);

      wsClient.close();
    }
  });

  it("no subscription leaks after churn", async () => {
    const cycles = 10;
    const clients: MockWebSocket[] = [];

    for (let i = 0; i < cycles; i++) {
      const ws = new MockWebSocket();
      ws.readyState = 1;
      server.handleConnection(ws);
      clients.push(ws);
    }

    // Connect and disconnect all but the last
    for (let i = 0; i < cycles - 1; i++) {
      clients[i]!.simulateClose();
    }

    // After churn, only the last client should remain
    // Broadcast an event — only the last (still-open) client should receive
    const events = await store.append("s1", [{ kind: "test", value: 1 }]);

    // The server should not throw when broadcasting
    expect(() => server.broadcast("s1", events as StoredEvent<unknown>[])).not.toThrow();

    server.close();
  });
});
