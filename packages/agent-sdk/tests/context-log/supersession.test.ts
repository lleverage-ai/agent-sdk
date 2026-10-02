import { describe, expect, it } from "vitest";

import { activeContextEntries, type ContextEntry, MemoryContextLogStore } from "../../src/index.js";

const stream = { threadId: "t1", branchId: "main", streamId: "main" };
const manifest = {
  projection: { adapter: "test", version: "1" },
  model: { provider: "test", modelId: "m" },
  inputDigest: "d".repeat(64),
};

function runtime(key: string, payload: unknown, supersedes?: string, retraction?: boolean) {
  return {
    kind: "runtime_context" as const,
    key,
    producer: "p",
    payload: payload as null,
    ...(supersedes ? { supersedes } : {}),
    ...(retraction ? { retraction } : {}),
  };
}

async function keysOf(entries: ContextEntry[]) {
  return activeContextEntries(entries).map((entry) => entry.key);
}

describe("activeContextEntries", () => {
  it("emits only the latest entry of a supersession chain", async () => {
    const store = new MemoryContextLogStore();
    const { head } = await store.prepare({
      stream,
      expectedRevision: 0,
      idempotencyKey: "k1",
      transition: { reason: "initial", parent: null, core: "c", contract: {} },
      append: [
        runtime("a1", 1),
        { kind: "user", key: "u1", message: { role: "user", content: "hi" } },
        runtime("a2", 2, "a1"),
        runtime("a3", 3, "a2"),
      ],
      manifest,
    });
    const { entries } = await store.readPath(head);
    expect(await keysOf(entries)).toEqual(["u1", "a3"]);
  });

  it("never emits a retraction and hides what it retracts", async () => {
    const store = new MemoryContextLogStore();
    const { head } = await store.prepare({
      stream,
      expectedRevision: 0,
      idempotencyKey: "k1",
      transition: { reason: "initial", parent: null, core: "c", contract: {} },
      append: [runtime("a1", 1), runtime("r1", null, "a1", true)],
      manifest,
    });
    expect(await keysOf((await store.readPath(head)).entries)).toEqual([]);

    const next = await store.prepare({
      stream,
      expectedRevision: head.revision,
      idempotencyKey: "k2",
      append: [runtime("a2", 2, "r1")],
      manifest,
    });
    expect(await keysOf((await store.readPath(next.head)).entries)).toEqual(["a2"]);
  });

  it("applies supersession across an inherited prefix", async () => {
    const store = new MemoryContextLogStore();
    const base = await store.prepare({
      stream,
      expectedRevision: 0,
      idempotencyKey: "k1",
      transition: { reason: "initial", parent: null, core: "c", contract: {} },
      append: [
        runtime("a1", 1),
        { kind: "user", key: "u1", message: { role: "user", content: "hi" } },
      ],
      manifest,
    });
    const child = await store.prepare({
      stream,
      expectedRevision: base.head.revision,
      idempotencyKey: "k2",
      transition: {
        reason: "compaction",
        parent: { versionId: base.head.versionId, inheritedCount: 2 },
        core: "c",
        contract: {},
      },
      append: [runtime("a2", 2, "a1")],
      manifest,
    });
    expect(await keysOf((await store.readPath(child.head)).entries)).toEqual(["u1", "a2"]);
    // The parent's own path still shows its original value.
    expect(await keysOf((await store.readPath(base.head)).entries)).toEqual(["a1", "u1"]);
  });
});
