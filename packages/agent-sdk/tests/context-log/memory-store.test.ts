import { describe, expect, it } from "vitest";

import { MemoryContextLogStore } from "../../src/index.js";
import {
  createContextLogStoreConformanceCases,
  defineContextLogStoreConformanceSuite,
} from "../../src/testing/index.js";

defineContextLogStoreConformanceSuite(
  "MemoryContextLogStore",
  { createStore: () => new MemoryContextLogStore() },
  { describe, it },
);

describe("context log store conformance suite", () => {
  it("runs every case against one shared store with distinct threads", async () => {
    const shared = new MemoryContextLogStore();
    let threads = 0;
    const cases = createContextLogStoreConformanceCases({
      createStore: () => shared,
      createThreadId: () => `shared-${++threads}`,
    });
    for (const testCase of cases) await testCase.run();
    expect(threads).toBe(cases.length);
  });

  it("completes every prepared manifest through the completeManifest hook", async () => {
    const seen = new Set<string>();
    const cases = createContextLogStoreConformanceCases({
      createStore: () => new MemoryContextLogStore(),
      completeManifest: (manifest, context) => {
        seen.add(context.idempotencyKey);
        expect(typeof manifest.ordinal).toBe("number");
        expect(manifest.attempt).toBeGreaterThanOrEqual(1);
        return {
          ...manifest,
          toolSnapshot: manifest.toolSnapshot === "[]" ? '["host"]' : manifest.toolSnapshot,
        };
      },
    });
    for (const testCase of cases) await testCase.run();
    expect(seen.size).toBeGreaterThan(cases.length);
  });

  it("accepts a completeManifest hook that adds required host metadata", async () => {
    const store = new MemoryContextLogStore();
    const requiring = Object.create(store) as MemoryContextLogStore;
    requiring.prepare = async (request) => {
      if (request.manifest.metadata?.tenant !== "t-1") throw new Error("tenant metadata required");
      return store.prepare(request);
    };
    const cases = createContextLogStoreConformanceCases({
      createStore: () => requiring,
      completeManifest: (manifest) => ({
        ...manifest,
        metadata: { ...manifest.metadata, tenant: "t-1" },
      }),
    });
    for (const testCase of cases) await testCase.run();
  });

  it("rejects a completeManifest hook that drops the suite's metadata", async () => {
    const testCase = createContextLogStoreConformanceCases({
      createStore: () => new MemoryContextLogStore(),
      completeManifest: (manifest) => ({ ...manifest, metadata: { tenant: "t-1" } }),
    }).find((candidate) => candidate.name.startsWith("prepare commits a root version"));
    await expect(testCase!.run()).rejects.toThrow(/must keep manifest.metadata.run/);
  });

  it("fails against a store that ignores the expected revision", async () => {
    const store = new MemoryContextLogStore();
    const broken = Object.create(store) as MemoryContextLogStore;
    broken.prepare = async (request) => {
      const head = await store.readHead(request.stream);
      return store.prepare({ ...request, expectedRevision: head?.revision ?? 0 });
    };
    const testCase = createContextLogStoreConformanceCases({ createStore: () => broken }).find(
      (candidate) => candidate.name.startsWith("a stale expected revision"),
    );
    await expect(testCase!.run()).rejects.toThrow(/ContextLogError of kind "conflict"/);
  });
});
