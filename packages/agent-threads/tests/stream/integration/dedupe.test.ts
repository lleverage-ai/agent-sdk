import { describe, expect, it } from "vitest";

import { Projector } from "../../../src/stream/projector.js";
import { InMemoryEventStore } from "../../../src/stream/stores/memory.js";
import type { StoredEvent } from "../../../src/stream/types.js";

type TestEvent = { kind: string; text: string };

interface TextState {
  fullText: string;
  eventCount: number;
}

function createTextProjector() {
  return new Projector<TextState, TestEvent>({
    initialState: { fullText: "", eventCount: 0 },
    reducer: (state: TextState, event: StoredEvent<TestEvent>) => ({
      fullText: state.fullText + event.event.text,
      eventCount: state.eventCount + 1,
    }),
  });
}

describe("Deduplication integration", () => {
  it("projector skips already-processed seqs during catch-up", async () => {
    const store = new InMemoryEventStore<TestEvent>();
    const projector = createTextProjector();

    // First batch
    await store.append("s1", [
      { kind: "text-delta", text: "Hello" },
      { kind: "text-delta", text: " " },
    ]);
    await projector.catchUp(store, "s1");
    expect(projector.getState()).toEqual({ fullText: "Hello ", eventCount: 2 });

    // Second batch
    await store.append("s1", [{ kind: "text-delta", text: "World" }]);
    await projector.catchUp(store, "s1");

    // Should only have processed 3 events total, not 5
    expect(projector.getState()).toEqual({ fullText: "Hello World", eventCount: 3 });
    expect(projector.getLastSeq()).toBe(3);
  });

  it("multiple catch-ups produce same result as single catch-up", async () => {
    const store = new InMemoryEventStore<TestEvent>();

    await store.append("s1", [
      { kind: "text-delta", text: "A" },
      { kind: "text-delta", text: "B" },
      { kind: "text-delta", text: "C" },
    ]);

    // Incremental catch-up
    const incremental = createTextProjector();
    // Catch-up after each append (simulating live processing)
    await incremental.catchUp(store, "s1");
    const incrementalState = incremental.getState();

    // Single catch-up
    const single = createTextProjector();
    await single.catchUp(store, "s1");
    const singleState = single.getState();

    expect(incrementalState).toEqual(singleState);
  });

  it("projector handles manual apply + catch-up without double-counting", async () => {
    const store = new InMemoryEventStore<TestEvent>();
    const projector = createTextProjector();

    const stored = await store.append("s1", [
      { kind: "text-delta", text: "X" },
      { kind: "text-delta", text: "Y" },
    ]);

    // Manually apply first event
    projector.apply([stored[0]!]);
    expect(projector.getLastSeq()).toBe(1);

    // Catch up should only get second event
    const count = await projector.catchUp(store, "s1");
    expect(count).toBe(1);
    expect(projector.getState()).toEqual({ fullText: "XY", eventCount: 2 });
  });

  it("catch-up after store append returns correct new event count", async () => {
    const store = new InMemoryEventStore<TestEvent>();
    const projector = createTextProjector();

    await store.append("s1", [{ kind: "text-delta", text: "1" }]);
    let count = await projector.catchUp(store, "s1");
    expect(count).toBe(1);

    await store.append("s1", [
      { kind: "text-delta", text: "2" },
      { kind: "text-delta", text: "3" },
    ]);
    count = await projector.catchUp(store, "s1");
    expect(count).toBe(2);

    // No new events
    count = await projector.catchUp(store, "s1");
    expect(count).toBe(0);
  });

  it("projector state matches full replay reduction", async () => {
    const store = new InMemoryEventStore<TestEvent>();
    const projector = createTextProjector();

    const events = Array.from({ length: 20 }, (_, i) => ({
      kind: "text-delta",
      text: String.fromCharCode(65 + (i % 26)),
    }));
    await store.append("s1", events);

    // Catch up projector
    await projector.catchUp(store, "s1");

    // Manually replay and reduce
    const allEvents = await store.replay("s1");
    const manualState = allEvents.reduce(
      (state, event) => ({
        fullText: state.fullText + event.event.text,
        eventCount: state.eventCount + 1,
      }),
      { fullText: "", eventCount: 0 },
    );

    expect(projector.getState()).toEqual(manualState);
  });
});
