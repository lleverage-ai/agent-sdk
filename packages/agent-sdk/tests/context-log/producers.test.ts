import { describe, expect, it } from "vitest";
import { resolveContextProducers, runContextProducers } from "../../src/context-log/producers.js";
import {
  activeContextEntries,
  CONTEXT_UNAVAILABLE,
  type ContextEntry,
  type ContextHead,
  type ContextLogStore,
  type ContextProducer,
  type ContextSlotValue,
  createSlotContextProducer,
  definePlugin,
  isContextLogError,
  MemoryContextLogStore,
  type RuntimeContextEntryInput,
} from "../../src/index.js";

const stream = { threadId: "t1", branchId: "main", streamId: "main" };
const manifest = {
  projection: { adapter: "test", version: "1" },
  model: { provider: "test", modelId: "m" },
  inputDigest: "d".repeat(64),
};

async function readFullPath(store: ContextLogStore, head: ContextHead | null) {
  if (!head) return [];
  const entries: ContextEntry[] = [];
  for (let after: number | null = 0; after !== null; ) {
    const page = await store.readPath(head, { after });
    entries.push(...page.entries);
    after = page.nextAfter;
  }
  return entries;
}

/**
 * One log-mode turn as the runtime runs it: read the head once, run the
 * producers on that snapshot, and commit their output with the turn's input.
 */
async function turn(store: ContextLogStore, producers: readonly ContextProducer[], label: string) {
  const head = await store.readHead(stream);
  const path = await readFullPath(store, head);
  const produced = await runContextProducers({ producers, stream, head, path });
  const { head: next } = await store.prepare({
    stream,
    expectedRevision: head?.revision ?? 0,
    idempotencyKey: label,
    ...(head ? {} : { transition: { reason: "initial", parent: null, core: "c", contract: {} } }),
    append: [
      ...produced,
      { kind: "user", key: `user:${label}`, message: { role: "user", content: label } },
    ],
    manifest,
  });
  const committed = await readFullPath(store, next);
  return { produced, committed };
}

function activePayloads(path: readonly ContextEntry[]) {
  return activeContextEntries(path)
    .filter((entry) => entry.kind === "runtime_context")
    .map((entry) => (entry as RuntimeContextEntryInput).payload);
}

/** A slot producer whose loader returns whatever `state.values` holds. */
function scripted(options: { optional?: boolean; retractAbsent?: boolean } = {}) {
  const state: { values: ContextSlotValue[] | Error } = { values: [] };
  const producer = createSlotContextProducer({
    name: "settings",
    ...options,
    load: () => {
      if (state.values instanceof Error) throw state.values;
      return state.values;
    },
  });
  return { state, producer };
}

describe("createSlotContextProducer", () => {
  it("appends a slot once and skips it while it is unchanged", async () => {
    const store = new MemoryContextLogStore();
    const { state, producer } = scripted();
    state.values = [{ slot: "persona", payload: { name: "Ada" } }];

    const first = await turn(store, [producer], "1");
    expect(first.produced).toEqual([
      {
        kind: "runtime_context",
        key: "ctx:settings:slot:persona:1",
        producer: "settings",
        payload: { name: "Ada" },
      },
    ]);

    const second = await turn(store, [producer], "2");
    expect(second.produced).toEqual([]);
    expect(activePayloads(second.committed)).toEqual([{ name: "Ada" }]);
  });

  it("supersedes the slot's latest entry when its value changes, keeping the old entry", async () => {
    const store = new MemoryContextLogStore();
    const { state, producer } = scripted();
    state.values = [{ slot: "persona", payload: { name: "Ada" } }];
    await turn(store, [producer], "1");

    state.values = [{ slot: "persona", payload: { name: "Grace" } }];
    const { produced, committed } = await turn(store, [producer], "2");

    expect(produced).toEqual([
      {
        kind: "runtime_context",
        key: "ctx:settings:slot:persona:2",
        producer: "settings",
        payload: { name: "Grace" },
        supersedes: "ctx:settings:slot:persona:1",
      },
    ]);
    expect(committed.map((entry) => entry.key)).toContain("ctx:settings:slot:persona:1");
    expect(activePayloads(committed)).toEqual([{ name: "Grace" }]);
  });

  it("treats a metadata change as a new value", async () => {
    const store = new MemoryContextLogStore();
    const { state, producer } = scripted();
    state.values = [{ slot: "s", payload: "x", metadata: { revision: "1" } }];
    await turn(store, [producer], "1");
    state.values = [{ slot: "s", payload: "x", metadata: { revision: "2" } }];
    const { produced } = await turn(store, [producer], "2");
    expect(produced).toHaveLength(1);
    expect(produced[0]).toMatchObject({
      metadata: { revision: "2" },
      supersedes: "ctx:settings:slot:s:1",
    });
  });

  it("retracts removed configuration and lets a later value supersede the retraction", async () => {
    const store = new MemoryContextLogStore();
    const { state, producer } = scripted();
    state.values = [
      { slot: "result_contract", payload: "submit JSON" },
      { slot: "persona", payload: "Ada" },
    ];
    await turn(store, [producer], "1");

    state.values = [{ slot: "persona", payload: "Ada" }];
    const removed = await turn(store, [producer], "2");
    expect(removed.produced).toEqual([
      {
        kind: "runtime_context",
        key: "ctx:settings:slot:result_contract:2",
        producer: "settings",
        payload: null,
        supersedes: "ctx:settings:slot:result_contract:1",
        retraction: true,
      },
    ]);
    expect(activePayloads(removed.committed)).toEqual(["Ada"]);

    // Still absent: the retraction is not repeated.
    expect((await turn(store, [producer], "3")).produced).toEqual([]);

    state.values = [
      { slot: "result_contract", payload: "submit JSON" },
      { slot: "persona", payload: "Ada" },
    ];
    const restored = await turn(store, [producer], "4");
    expect(restored.produced).toEqual([
      {
        kind: "runtime_context",
        key: "ctx:settings:slot:result_contract:3",
        producer: "settings",
        payload: "submit JSON",
        supersedes: "ctx:settings:slot:result_contract:2",
      },
    ]);
    expect(activePayloads(restored.committed)).toEqual(["Ada", "submit JSON"]);
  });

  it("keeps retrieved data when retractAbsent is false", async () => {
    const store = new MemoryContextLogStore();
    const { state, producer } = scripted({ retractAbsent: false });
    state.values = [{ slot: "file:a", payload: "A" }];
    await turn(store, [producer], "1");
    state.values = [{ slot: "file:b", payload: "B" }];
    const { produced, committed } = await turn(store, [producer], "2");
    expect(produced.map((entry) => entry.key)).toEqual(["ctx:settings:slot:file%3Ab:1"]);
    expect(activePayloads(committed)).toEqual(["A", "B"]);
  });

  it("decides retraction per slot with a function", async () => {
    const store = new MemoryContextLogStore();
    const producer = createSlotContextProducer({
      name: "mixed",
      retractAbsent: (slot) => slot.startsWith("config:"),
      load: ({ path }) =>
        path.length === 0
          ? [
              { slot: "config:x", payload: 1 },
              { slot: "memory:y", payload: 2 },
            ]
          : [],
    });
    await turn(store, [producer], "1");
    const { produced } = await turn(store, [producer], "2");
    expect(produced).toEqual([
      expect.objectContaining({ key: "ctx:mixed:slot:config%3Ax:2", retraction: true }),
    ]);
  });

  it("records context_unavailable for a failed optional loader and keeps earlier slots active", async () => {
    const store = new MemoryContextLogStore();
    const { state, producer } = scripted({ optional: true });
    state.values = [{ slot: "persona", payload: "Ada" }];
    await turn(store, [producer], "1");

    state.values = new Error("connection to db://user:hunter2@host refused");
    const failed = await turn(store, [producer], "2");
    expect(failed.produced).toEqual([
      {
        kind: "runtime_context",
        key: "ctx:settings:unavailable:1",
        producer: "settings",
        payload: {
          type: CONTEXT_UNAVAILABLE,
          producer: "settings",
          reason: "The context could not be loaded.",
        },
      },
    ]);
    // The default reason never copies the error message.
    expect(JSON.stringify(failed.produced)).not.toContain("hunter2");
    // A transient failure does not retract the last committed value.
    expect(activePayloads(failed.committed)).toEqual([
      "Ada",
      expect.objectContaining({ type: CONTEXT_UNAVAILABLE }),
    ]);

    // A repeated failure is deduplicated.
    expect((await turn(store, [producer], "3")).produced).toEqual([]);

    state.values = [{ slot: "persona", payload: "Grace" }];
    const recovered = await turn(store, [producer], "4");
    expect(recovered.produced).toEqual([
      {
        kind: "runtime_context",
        key: "ctx:settings:unavailable:2",
        producer: "settings",
        payload: null,
        supersedes: "ctx:settings:unavailable:1",
        retraction: true,
      },
      {
        kind: "runtime_context",
        key: "ctx:settings:slot:persona:2",
        producer: "settings",
        payload: "Grace",
        supersedes: "ctx:settings:slot:persona:1",
      },
    ]);
    expect(activePayloads(recovered.committed)).toEqual(["Grace"]);

    // A later failure supersedes the retracted marker.
    state.values = new Error("again");
    const again = await turn(store, [producer], "5");
    expect(again.produced).toEqual([
      expect.objectContaining({
        key: "ctx:settings:unavailable:3",
        supersedes: "ctx:settings:unavailable:2",
      }),
    ]);
  });

  it("uses describeFailure for the marker's reason", async () => {
    const producer = createSlotContextProducer({
      name: "memory",
      optional: true,
      describeFailure: (error) => `memory service: ${(error as Error).name}`,
      load: () => {
        throw new TypeError("boom");
      },
    });
    const produced = await runContextProducers({
      producers: [producer],
      stream,
      head: null,
      path: [],
    });
    expect(produced[0]?.payload).toEqual({
      type: CONTEXT_UNAVAILABLE,
      producer: "memory",
      reason: "memory service: TypeError",
    });
  });

  it("propagates a required loader's error, so nothing is committed", async () => {
    const store = new MemoryContextLogStore();
    const { state, producer } = scripted();
    state.values = new Error("scope lookup failed");
    await expect(turn(store, [producer], "1")).rejects.toThrow("scope lookup failed");
    expect(await store.readHead(stream)).toBeNull();
  });

  it("propagates an optional loader's error when the call was aborted", async () => {
    const controller = new AbortController();
    const producer = createSlotContextProducer({
      name: "slow",
      optional: true,
      load: () => {
        controller.abort();
        throw new Error("aborted");
      },
    });
    await expect(
      runContextProducers({
        producers: [producer],
        stream,
        head: null,
        path: [],
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");
  });

  it("re-derives byte-identical entries from the same head", async () => {
    const store = new MemoryContextLogStore();
    const { state, producer } = scripted();
    state.values = [{ slot: "a", payload: 1 }];
    await turn(store, [producer], "1");
    state.values = [{ slot: "b:c", payload: { nested: ["x"] } }];

    const head = await store.readHead(stream);
    const path = await readFullPath(store, head);
    const first = await runContextProducers({ producers: [producer], stream, head, path });
    const retry = await runContextProducers({ producers: [producer], stream, head, path });
    expect(JSON.stringify(retry)).toBe(JSON.stringify(first));
  });

  it("rejects duplicate slots and non-JSON payloads", async () => {
    const duplicate = createSlotContextProducer({
      name: "dup",
      load: () => [
        { slot: "a", payload: 1 },
        { slot: "a", payload: 2 },
      ],
    });
    const invalid = createSlotContextProducer({
      name: "bad",
      load: () => [{ slot: "a", payload: new Date() as unknown as string }],
    });
    for (const producer of [duplicate, invalid]) {
      const error = await runContextProducers({
        producers: [producer],
        stream,
        head: null,
        path: [],
      }).catch((caught: unknown) => caught);
      expect(isContextLogError(error, "invalid")).toBe(true);
    }
  });

  it("ignores other producers' entries and keys it did not create", async () => {
    const store = new MemoryContextLogStore();
    const { state, producer } = scripted();
    const other: ContextProducer = {
      name: "other",
      produce: () => [
        {
          kind: "runtime_context",
          key: "ctx:settings:slot:persona:7",
          producer: "other",
          payload: "x",
        },
      ],
    };
    state.values = [{ slot: "persona", payload: "Ada" }];
    const { produced } = await turn(store, [other, producer], "1");
    expect(produced.map((entry) => entry.key)).toEqual([
      "ctx:settings:slot:persona:7",
      "ctx:settings:slot:persona:1",
    ]);
  });
});

describe("runContextProducers", () => {
  const head = null;

  it("drops entries whose key is already on the path", async () => {
    const store = new MemoryContextLogStore();
    const fixed: ContextProducer = {
      name: "clock",
      produce: () => [
        { kind: "runtime_context", key: "clock:2026-10-02", producer: "clock", payload: "today" },
      ],
    };
    const first = await turn(store, [fixed], "1");
    expect(first.produced).toHaveLength(1);
    const second = await turn(store, [fixed], "2");
    expect(second.produced).toEqual([]);
  });

  it("gives every producer the same head snapshot, in registration order", async () => {
    const seen: Array<{ name: string; pathLength: number }> = [];
    const spy = (name: string): ContextProducer => ({
      name,
      produce: ({ path }) => {
        seen.push({ name, pathLength: path.length });
        return [{ kind: "runtime_context", key: `${name}:1`, producer: name, payload: name }];
      },
    });
    const produced = await runContextProducers({
      producers: [spy("a"), spy("b")],
      stream,
      head,
      path: [],
    });
    expect(produced.map((entry) => entry.key)).toEqual(["a:1", "b:1"]);
    expect(seen).toEqual([
      { name: "a", pathLength: 0 },
      { name: "b", pathLength: 0 },
    ]);
  });

  it("drops an identical duplicate and rejects a conflicting one", async () => {
    const entry = { kind: "runtime_context" as const, key: "k", producer: "p", payload: 1 };
    const same: ContextProducer = { name: "p", produce: () => [entry, { ...entry }] };
    expect(await runContextProducers({ producers: [same], stream, head, path: [] })).toHaveLength(
      1,
    );

    const conflicting: ContextProducer = {
      name: "p",
      produce: () => [entry, { ...entry, payload: 2 }],
    };
    await expect(
      runContextProducers({ producers: [conflicting], stream, head, path: [] }),
    ).rejects.toMatchObject({ kind: "invalid", reason: "duplicate_key" });
  });

  it("rejects entries that are not the producer's own runtime context", async () => {
    const cases: ContextProducer[] = [
      {
        name: "p",
        produce: () =>
          [
            { kind: "user", key: "u", message: { role: "user", content: "x" } },
          ] as unknown as RuntimeContextEntryInput[],
      },
      {
        name: "p",
        produce: () => [{ kind: "runtime_context", key: "k", producer: "q", payload: 1 }],
      },
      {
        name: "p",
        produce: () => [{ kind: "runtime_context", key: "", producer: "p", payload: 1 }],
      },
      { name: "p", produce: () => "nope" as unknown as RuntimeContextEntryInput[] },
    ];
    for (const producer of cases) {
      await expect(
        runContextProducers({ producers: [producer], stream, head, path: [] }),
      ).rejects.toMatchObject({ kind: "invalid", reason: "invalid_producer_output" });
    }
  });
});

describe("producer registration", () => {
  const producer = (name: string): ContextProducer => ({ name, produce: () => [] });

  it("runs the agent's producers first, then each plugin's in plugin order", () => {
    const plugins = [
      definePlugin({ name: "one", contextProducers: [producer("p1")] }),
      definePlugin({ name: "two" }),
      definePlugin({ name: "three", contextProducers: [producer("p3a"), producer("p3b")] }),
    ];
    expect(plugins[0]?.contextProducers?.map((p) => p.name)).toEqual(["p1"]);
    const resolved = resolveContextProducers([producer("agent")], plugins);
    expect(resolved.map((p) => p.name)).toEqual(["agent", "p1", "p3a", "p3b"]);
  });

  it("rejects duplicate and missing producer names", () => {
    expect(() =>
      resolveContextProducers(
        [producer("x")],
        [definePlugin({ name: "plug", contextProducers: [producer("x")] })],
      ),
    ).toThrow(/"x" is registered by both the agent and plugin "plug"/);
    expect(() => resolveContextProducers([producer("")])).toThrow(/non-empty name/);
    expect(() => resolveContextProducers([{ name: "x" } as unknown as ContextProducer])).toThrow(
      /produce function/,
    );
  });

  it("returns no producers when none are registered", () => {
    expect(resolveContextProducers(undefined, [definePlugin({ name: "p" })])).toEqual([]);
  });
});
