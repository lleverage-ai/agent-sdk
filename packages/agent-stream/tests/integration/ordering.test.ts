import { describe, expect, it } from "vitest";

import { InMemoryEventStore } from "../../src/stores/memory.js";

type TestEvent = { kind: string; value: number };

describe("Event ordering integration", () => {
  it("maintains monotonic seq order across multiple appends", async () => {
    const store = new InMemoryEventStore<TestEvent>();

    await store.append("s1", [{ kind: "a", value: 1 }]);
    await store.append("s1", [{ kind: "b", value: 2 }]);
    await store.append("s1", [{ kind: "c", value: 3 }]);

    const events = await store.replay("s1");
    expect(events).toHaveLength(3);

    for (let i = 0; i < events.length; i++) {
      expect(events[i]!.seq).toBe(i + 1);
    }

    // Verify no gaps
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.seq - events[i - 1]!.seq).toBe(1);
    }
  });

  it("maintains order with batch and single appends interleaved", async () => {
    const store = new InMemoryEventStore<TestEvent>();

    await store.append("s1", [
      { kind: "batch1", value: 1 },
      { kind: "batch1", value: 2 },
    ]);
    await store.append("s1", [{ kind: "single", value: 3 }]);
    await store.append("s1", [
      { kind: "batch2", value: 4 },
      { kind: "batch2", value: 5 },
      { kind: "batch2", value: 6 },
    ]);

    const events = await store.replay("s1");
    expect(events).toHaveLength(6);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.map((e) => e.event.value)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("replays partial ranges correctly", async () => {
    const store = new InMemoryEventStore<TestEvent>();

    for (let i = 0; i < 10; i++) {
      await store.append("s1", [{ kind: "item", value: i }]);
    }

    // Replay middle range
    const middle = await store.replay("s1", { afterSeq: 3, limit: 4 });
    expect(middle).toHaveLength(4);
    expect(middle[0]!.seq).toBe(4);
    expect(middle[3]!.seq).toBe(7);

    // Replay tail
    const tail = await store.replay("s1", { afterSeq: 7 });
    expect(tail).toHaveLength(3);
    expect(tail[0]!.seq).toBe(8);
    expect(tail[2]!.seq).toBe(10);
  });

  it("head tracks the latest seq accurately", async () => {
    const store = new InMemoryEventStore<TestEvent>();

    expect(await store.head("s1")).toBe(0);

    await store.append("s1", [{ kind: "a", value: 1 }]);
    expect(await store.head("s1")).toBe(1);

    await store.append("s1", [
      { kind: "b", value: 2 },
      { kind: "c", value: 3 },
    ]);
    expect(await store.head("s1")).toBe(3);
  });
});
