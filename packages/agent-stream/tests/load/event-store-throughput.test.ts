import { describe, expect, it } from "vitest";

import { InMemoryEventStore } from "../../src/stores/memory.js";
import { assertSLO, generateTestEvents, Stopwatch } from "./helpers.js";

type TestEvent = { kind: string; value: number };

describe("EventStore throughput", () => {
  it("sequential append 5000 events in batches of 100", async () => {
    const store = new InMemoryEventStore<TestEvent>();
    const events = generateTestEvents(5000);
    const sw = new Stopwatch();

    for (let i = 0; i < 5000; i += 100) {
      const batch = events.slice(i, i + 100);
      const stop = sw.start();
      await store.append("s1", batch);
      stop();
    }

    const report = sw.getReport();
    assertSLO(report, "sequential-append-batch-100", { p99MaxMs: 5 });
    expect(await store.head("s1")).toBe(5000);
  });

  it("single-batch append 5000 events", async () => {
    const store = new InMemoryEventStore<TestEvent>();
    const events = generateTestEvents(5000);

    const t0 = performance.now();
    await store.append("s1", events);
    const elapsed = performance.now() - t0;

    expect(elapsed, `single-batch append took ${elapsed.toFixed(2)}ms`).toBeLessThan(200);
    expect(await store.head("s1")).toBe(5000);
  });

  it("replay 1000 events (50 iterations)", async () => {
    const store = new InMemoryEventStore<TestEvent>();
    await store.append("s1", generateTestEvents(1000));
    const sw = new Stopwatch();

    for (let i = 0; i < 50; i++) {
      const stop = sw.start();
      const result = await store.replay("s1");
      stop();
      expect(result).toHaveLength(1000);
    }

    const report = sw.getReport();
    assertSLO(report, "replay-1000", { p95MaxMs: 10 });
  });

  it("replay 5000 events (20 iterations)", async () => {
    const store = new InMemoryEventStore<TestEvent>();
    await store.append("s1", generateTestEvents(5000));
    const sw = new Stopwatch();

    for (let i = 0; i < 20; i++) {
      const stop = sw.start();
      const result = await store.replay("s1");
      stop();
      expect(result).toHaveLength(5000);
    }

    const report = sw.getReport();
    assertSLO(report, "replay-5000", { p95MaxMs: 50 });
  });

  it("tail replay (last 100 of 5000)", async () => {
    const store = new InMemoryEventStore<TestEvent>();
    await store.append("s1", generateTestEvents(5000));
    const sw = new Stopwatch();

    for (let i = 0; i < 50; i++) {
      const stop = sw.start();
      const result = await store.replay("s1", { afterSeq: 4900 });
      stop();
      expect(result).toHaveLength(100);
    }

    const report = sw.getReport();
    assertSLO(report, "tail-replay-100-of-5000", { p95MaxMs: 5 });
  });

  it("50 concurrent independent streams", async () => {
    const store = new InMemoryEventStore<TestEvent>();
    const events = generateTestEvents(100);

    const t0 = performance.now();
    await Promise.all(Array.from({ length: 50 }, (_, i) => store.append(`stream-${i}`, events)));
    const elapsed = performance.now() - t0;

    expect(elapsed, `50 concurrent streams took ${elapsed.toFixed(2)}ms`).toBeLessThan(500);

    for (let i = 0; i < 50; i++) {
      expect(await store.head(`stream-${i}`)).toBe(100);
    }
  });

  it("interleaved append + replay (no ordering violations)", async () => {
    const store = new InMemoryEventStore<TestEvent>();
    const streamId = "s1";
    const appendPromises: Promise<void>[] = [];
    const replayResults: number[][] = [];

    // Append 10 batches of 100 events each + concurrent replays
    for (let batch = 0; batch < 10; batch++) {
      appendPromises.push(store.append(streamId, generateTestEvents(100)).then(() => {}));
      appendPromises.push(
        store.replay(streamId).then((events) => {
          const seqs = events.map((e) => e.seq);
          replayResults.push(seqs);
        }),
      );
    }

    await Promise.all(appendPromises);

    // Each replay must have strictly increasing seqs
    for (const seqs of replayResults) {
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
      }
    }

    // Final head should reflect all appends
    const finalHead = await store.head(streamId);
    expect(finalHead).toBe(1000);
  });
});
