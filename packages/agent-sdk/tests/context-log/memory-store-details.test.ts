import { describe, expect, it } from "vitest";

import {
  ContextLogInvalidError,
  type ContextPrepareRequest,
  canonicalContextJson,
  isContextLogError,
  MemoryContextLogStore,
} from "../../src/index.js";

const stream = { threadId: "t1", branchId: "main", streamId: "main" };

function request(overrides: Partial<ContextPrepareRequest> = {}): ContextPrepareRequest {
  return {
    stream,
    expectedRevision: 0,
    idempotencyKey: "k1",
    transition: { reason: "initial", parent: null, core: "core", contract: {} },
    append: [{ kind: "user", key: "u1", message: { role: "user", content: "hi" } }],
    manifest: {
      projection: { adapter: "test", version: "1" },
      model: { provider: "test", modelId: "m" },
      inputDigest: "d".repeat(64),
    },
    ...overrides,
  };
}

describe("MemoryContextLogStore", () => {
  it("rejects content that would not survive a JSON round trip", async () => {
    const store = new MemoryContextLogStore();
    const error = await store
      .prepare(
        request({
          append: [
            {
              kind: "user",
              key: "u1",
              message: {
                role: "user",
                content: [{ type: "file", data: new Uint8Array([1, 2]), mediaType: "image/png" }],
              },
            },
          ],
        }),
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContextLogInvalidError);
    expect(isContextLogError(error, "invalid")).toBe(true);
    expect(await store.readHead(stream)).toBeNull();
  });

  it("returns copies that callers cannot use to mutate the log", async () => {
    const store = new MemoryContextLogStore();
    const { head, manifest } = await store.prepare(request());
    manifest.metadata = { changed: true };
    head.revision = 99;
    const page = await store.readPath(head);
    (page.entries[0] as { key: string }).key = "mutated";

    expect((await store.readManifest(manifest.id)).metadata).toBeUndefined();
    expect((await store.readHead(stream))?.revision).toBe(1);
    expect((await store.readPath(head)).entries[0]?.key).toBe("u1");
  });

  it("scopes idempotency keys to a thread", async () => {
    const store = new MemoryContextLogStore();
    await store.prepare(request());
    const other = await store.prepare(request({ stream: { ...stream, threadId: "t2" } }));
    expect(other.created).toBe(true);
  });

  it("clamps page sizes and rejects invalid cursors", async () => {
    const store = new MemoryContextLogStore();
    const { head } = await store.prepare(request());
    await expect(store.readPath(head, { limit: 0 })).rejects.toBeInstanceOf(ContextLogInvalidError);
    await expect(store.readPath(head, { after: -1 })).rejects.toBeInstanceOf(
      ContextLogInvalidError,
    );
    await expect(store.readPath({ ...head, entryCount: 5 })).rejects.toBeInstanceOf(
      ContextLogInvalidError,
    );
  });

  it("rejects a sparse append array without writing anything", async () => {
    const store = new MemoryContextLogStore();
    const { head } = await store.prepare(request());
    const sparse: ContextPrepareRequest["append"] = [];
    sparse[1] = { kind: "user", key: "u3", message: { role: "user", content: "late" } };
    await expect(
      store.prepare(
        request({
          idempotencyKey: "k2",
          expectedRevision: 1,
          transition: undefined,
          append: sparse,
        }),
      ),
    ).rejects.toBeInstanceOf(ContextLogInvalidError);
    expect(await store.readHead(stream)).toEqual(head);
    expect((await store.readPath(head)).entries).toHaveLength(1);
  });

  it("keeps only the fields of a stream reference", async () => {
    const store = new MemoryContextLogStore();
    const extended = Object.assign({ ...stream }, { onChange: () => undefined });
    const { head } = await store.prepare(request({ stream: extended }));
    expect(head.stream).toEqual(stream);
    expect(await store.readHead(extended)).toEqual(head);
  });

  it("requires a SHA-256 input digest", async () => {
    const store = new MemoryContextLogStore();
    await expect(
      store.prepare(request({ manifest: { ...request().manifest, inputDigest: "not-a-digest" } })),
    ).rejects.toBeInstanceOf(ContextLogInvalidError);
  });
});

describe("canonicalContextJson", () => {
  it("sorts keys and keeps __proto__ keys as data", () => {
    expect(canonicalContextJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalContextJson(JSON.parse('{"__proto__":{"x":1}}'))).not.toBe(
      canonicalContextJson(JSON.parse('{"__proto__":{"x":2}}')),
    );
  });
});
