import { describe, expect, it } from "vitest";

import type { IEventStore } from "../../../src/stream/types.js";

/**
 * Reusable conformance test suite for IEventStore implementations.
 *
 * Call this with a store factory to verify any store adapter conforms
 * to the IEventStore contract.
 */
export function eventStoreConformanceTests(
  name: string,
  createStore: () => IEventStore<{ kind: string; data: string }>,
): void {
  describe(`${name} conformance`, () => {
    it("appends events and assigns monotonic seq numbers", async () => {
      const store = createStore();
      const stored = await store.append("s1", [
        { kind: "a", data: "1" },
        { kind: "b", data: "2" },
        { kind: "c", data: "3" },
      ]);
      expect(stored).toHaveLength(3);
      expect(stored[0]!.seq).toBe(1);
      expect(stored[1]!.seq).toBe(2);
      expect(stored[2]!.seq).toBe(3);
    });

    it("preserves event payloads", async () => {
      const store = createStore();
      await store.append("s1", [{ kind: "x", data: "hello" }]);
      const events = await store.replay("s1");
      expect(events[0]!.event).toEqual({ kind: "x", data: "hello" });
    });

    it("assigns streamId to stored events", async () => {
      const store = createStore();
      const stored = await store.append("my-stream", [{ kind: "a", data: "1" }]);
      expect(stored[0]!.streamId).toBe("my-stream");
    });

    it("assigns ISO 8601 timestamps", async () => {
      const store = createStore();
      const stored = await store.append("s1", [{ kind: "a", data: "1" }]);
      expect(() => new Date(stored[0]!.timestamp)).not.toThrow();
      expect(new Date(stored[0]!.timestamp).toISOString()).toBe(stored[0]!.timestamp);
    });

    it("continues seq across multiple appends", async () => {
      const store = createStore();
      await store.append("s1", [{ kind: "a", data: "1" }]);
      const second = await store.append("s1", [{ kind: "b", data: "2" }]);
      expect(second[0]!.seq).toBe(2);
    });

    it("replays all events in seq order", async () => {
      const store = createStore();
      await store.append("s1", [
        { kind: "a", data: "1" },
        { kind: "b", data: "2" },
      ]);
      await store.append("s1", [{ kind: "c", data: "3" }]);
      const events = await store.replay("s1");
      expect(events).toHaveLength(3);
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    });

    it("replays with afterSeq filter", async () => {
      const store = createStore();
      await store.append("s1", [
        { kind: "a", data: "1" },
        { kind: "b", data: "2" },
        { kind: "c", data: "3" },
      ]);
      const events = await store.replay("s1", { afterSeq: 1 });
      expect(events).toHaveLength(2);
      expect(events[0]!.seq).toBe(2);
      expect(events[1]!.seq).toBe(3);
    });

    it("replays with limit", async () => {
      const store = createStore();
      await store.append("s1", [
        { kind: "a", data: "1" },
        { kind: "b", data: "2" },
        { kind: "c", data: "3" },
      ]);
      const events = await store.replay("s1", { limit: 2 });
      expect(events).toHaveLength(2);
      expect(events[0]!.seq).toBe(1);
      expect(events[1]!.seq).toBe(2);
    });

    it("replays with afterSeq and limit combined", async () => {
      const store = createStore();
      await store.append("s1", [
        { kind: "a", data: "1" },
        { kind: "b", data: "2" },
        { kind: "c", data: "3" },
        { kind: "d", data: "4" },
      ]);
      const events = await store.replay("s1", { afterSeq: 1, limit: 2 });
      expect(events).toHaveLength(2);
      expect(events[0]!.seq).toBe(2);
      expect(events[1]!.seq).toBe(3);
    });

    it("returns empty array for unknown stream replay", async () => {
      const store = createStore();
      const events = await store.replay("nonexistent");
      expect(events).toEqual([]);
    });

    it("returns 0 for head of empty/unknown stream", async () => {
      const store = createStore();
      expect(await store.head("nonexistent")).toBe(0);
    });

    it("returns correct head after appends", async () => {
      const store = createStore();
      await store.append("s1", [{ kind: "a", data: "1" }]);
      expect(await store.head("s1")).toBe(1);
      await store.append("s1", [
        { kind: "b", data: "2" },
        { kind: "c", data: "3" },
      ]);
      expect(await store.head("s1")).toBe(3);
    });

    it("deletes all events in a stream", async () => {
      const store = createStore();
      await store.append("s1", [
        { kind: "a", data: "1" },
        { kind: "b", data: "2" },
      ]);
      await store.delete("s1");
      expect(await store.replay("s1")).toEqual([]);
      expect(await store.head("s1")).toBe(0);
    });

    it("delete is a no-op for unknown streams", async () => {
      const store = createStore();
      await expect(store.delete("nonexistent")).resolves.toBeUndefined();
    });

    it("isolates streams from each other", async () => {
      const store = createStore();
      await store.append("s1", [{ kind: "a", data: "1" }]);
      await store.append("s2", [{ kind: "b", data: "2" }]);

      const s1Events = await store.replay("s1");
      const s2Events = await store.replay("s2");

      expect(s1Events).toHaveLength(1);
      expect(s1Events[0]!.event.kind).toBe("a");
      expect(s2Events).toHaveLength(1);
      expect(s2Events[0]!.event.kind).toBe("b");
    });

    it("deleting one stream does not affect others", async () => {
      const store = createStore();
      await store.append("s1", [{ kind: "a", data: "1" }]);
      await store.append("s2", [{ kind: "b", data: "2" }]);
      await store.delete("s1");

      expect(await store.replay("s1")).toEqual([]);
      expect(await store.replay("s2")).toHaveLength(1);
    });

    it("seq starts at 1 for each stream independently", async () => {
      const store = createStore();
      const s1 = await store.append("s1", [{ kind: "a", data: "1" }]);
      const s2 = await store.append("s2", [{ kind: "b", data: "2" }]);
      expect(s1[0]!.seq).toBe(1);
      expect(s2[0]!.seq).toBe(1);
    });

    it("handles empty append", async () => {
      const store = createStore();
      const result = await store.append("s1", []);
      expect(result).toEqual([]);
      expect(await store.head("s1")).toBe(0);
    });

    it("handles large batch append", async () => {
      const store = createStore();
      const events = Array.from({ length: 100 }, (_, i) => ({
        kind: "item",
        data: String(i),
      }));
      const stored = await store.append("s1", events);
      expect(stored).toHaveLength(100);
      expect(stored[0]!.seq).toBe(1);
      expect(stored[99]!.seq).toBe(100);
      expect(await store.head("s1")).toBe(100);

      const replayed = await store.replay("s1");
      expect(replayed).toHaveLength(100);
    });

    it("replays with limit 0 returns empty", async () => {
      const store = createStore();
      await store.append("s1", [{ kind: "a", data: "1" }]);
      const events = await store.replay("s1", { limit: 0 });
      expect(events).toEqual([]);
    });
  });
}
