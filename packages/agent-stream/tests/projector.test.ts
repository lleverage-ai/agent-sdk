import { beforeEach, describe, expect, it } from "vitest";

import { Projector } from "../src/projector.js";
import { InMemoryEventStore } from "../src/stores/memory.js";
import type { StoredEvent } from "../src/types.js";

interface CounterState {
  count: number;
  lastKind: string;
}

type TestEvent = { kind: string; value: number };

function createCounterProjector() {
  return new Projector<CounterState, TestEvent>({
    initialState: { count: 0, lastKind: "" },
    reducer: (state, event: StoredEvent<TestEvent>) => ({
      count: state.count + event.event.value,
      lastKind: event.event.kind,
    }),
  });
}

describe("Projector", () => {
  let store: InMemoryEventStore<TestEvent>;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  it("starts with initial state", () => {
    const projector = createCounterProjector();
    expect(projector.getState()).toEqual({ count: 0, lastKind: "" });
    expect(projector.getLastSeq()).toBe(0);
  });

  it("applies events and updates state", async () => {
    const projector = createCounterProjector();
    const stored = await store.append("s1", [
      { kind: "add", value: 5 },
      { kind: "add", value: 3 },
    ]);
    projector.apply(stored);
    expect(projector.getState()).toEqual({ count: 8, lastKind: "add" });
    expect(projector.getLastSeq()).toBe(2);
  });

  it("skips already-processed events (idempotent)", async () => {
    const projector = createCounterProjector();
    const stored = await store.append("s1", [
      { kind: "add", value: 5 },
      { kind: "add", value: 3 },
    ]);
    projector.apply(stored);
    // Apply same events again
    projector.apply(stored);
    expect(projector.getState()).toEqual({ count: 8, lastKind: "add" });
    expect(projector.getLastSeq()).toBe(2);
  });

  it("processes only new events in subsequent applies", async () => {
    const projector = createCounterProjector();
    const first = await store.append("s1", [{ kind: "add", value: 5 }]);
    projector.apply(first);

    const second = await store.append("s1", [{ kind: "sub", value: 2 }]);
    // Apply all events including already-processed ones
    projector.apply([...first, ...second]);
    expect(projector.getState()).toEqual({ count: 7, lastKind: "sub" });
    expect(projector.getLastSeq()).toBe(2);
  });

  it("catches up from store", async () => {
    const projector = createCounterProjector();
    await store.append("s1", [
      { kind: "add", value: 10 },
      { kind: "add", value: 20 },
    ]);
    const count = await projector.catchUp(store, "s1");
    expect(count).toBe(2);
    expect(projector.getState()).toEqual({ count: 30, lastKind: "add" });
    expect(projector.getLastSeq()).toBe(2);
  });

  it("catches up incrementally", async () => {
    const projector = createCounterProjector();
    await store.append("s1", [{ kind: "add", value: 10 }]);
    await projector.catchUp(store, "s1");

    await store.append("s1", [{ kind: "add", value: 5 }]);
    const count = await projector.catchUp(store, "s1");
    expect(count).toBe(1);
    expect(projector.getState()).toEqual({ count: 15, lastKind: "add" });
  });

  it("catches up returns 0 for empty stream", async () => {
    const projector = createCounterProjector();
    const count = await projector.catchUp(store, "empty");
    expect(count).toBe(0);
    expect(projector.getState()).toEqual({ count: 0, lastKind: "" });
  });

  it("resets to initial state", async () => {
    const projector = createCounterProjector();
    const stored = await store.append("s1", [{ kind: "add", value: 99 }]);
    projector.apply(stored);
    expect(projector.getState().count).toBe(99);

    projector.reset();
    expect(projector.getState()).toEqual({ count: 0, lastKind: "" });
    expect(projector.getLastSeq()).toBe(0);
  });

  it("can catch up after reset", async () => {
    const projector = createCounterProjector();
    await store.append("s1", [
      { kind: "add", value: 10 },
      { kind: "add", value: 20 },
    ]);
    await projector.catchUp(store, "s1");
    expect(projector.getState().count).toBe(30);

    projector.reset();
    await projector.catchUp(store, "s1");
    expect(projector.getState().count).toBe(30);
    expect(projector.getLastSeq()).toBe(2);
  });
});
