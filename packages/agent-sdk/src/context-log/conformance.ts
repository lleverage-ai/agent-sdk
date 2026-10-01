/**
 * Framework-agnostic conformance suite for {@link ContextLogStore}
 * implementations.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";

import { type ContextLogErrorKind, isContextLogError } from "./errors.js";
import { canonicalContextJson } from "./json.js";
import type {
  AssistantContextEntryInput,
  ContextEntry,
  ContextEntryInput,
  ContextHead,
  ContextLogStore,
  ContextManifestInput,
  ContextPathRef,
  ContextPrepareRequest,
  ContextStreamRef,
  ContextTransition,
  RuntimeContextEntryInput,
  ToolResultContextEntryInput,
  UserContextEntryInput,
} from "./types.js";

/**
 * Options for the context log store conformance suite.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextLogStoreConformanceOptions {
  /**
   * Creates the store under test. Called once per case. A store backed by a
   * shared database may return the same instance: every case uses its own
   * thread ids.
   */
  createStore: () => ContextLogStore | Promise<ContextLogStore>;
  /** Releases a store after a case. */
  disposeStore?: (store: ContextLogStore) => void | Promise<void>;
  /**
   * Returns a fresh thread id. Use it when the store only accepts ids it
   * provisioned (for example sessions that must exist in a database).
   * @defaultValue a random UUID-based id
   */
  createThreadId?: () => string | Promise<string>;
}

/**
 * One case of the conformance suite.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextLogConformanceCase {
  /** Human-readable case name. */
  name: string;
  /** Runs the case; rejects with a descriptive error on failure. */
  run: () => Promise<void>;
}

/**
 * Minimal test-framework surface the suite registers cases with. Vitest,
 * Jest, Mocha and `bun:test` all provide it.
 *
 * @experimental
 * @category Context Log
 */
export interface ConformanceTestApi {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<void>) => void;
}

class ConformanceFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextLogConformanceFailure";
  }
}

function fail(message: string): never {
  throw new ConformanceFailure(message);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function same(actual: unknown, expected: unknown, message: string): void {
  const a = canonicalContextJson(actual);
  const e = canonicalContextJson(expected);
  if (a !== e) fail(`${message}\n  expected: ${e}\n  actual:   ${a}`);
}

async function rejects(
  action: () => Promise<unknown>,
  kind: ContextLogErrorKind,
  reason?: string,
): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    if (!isContextLogError(error, kind)) {
      fail(`expected a ContextLogError of kind "${kind}", got ${String(error)}`);
    }
    if (reason !== undefined && error.reason !== reason) {
      fail(`expected reason "${reason}", got "${error.reason}"`);
    }
    return error;
  }
  return fail(`expected a ContextLogError of kind "${kind}", but the call succeeded`);
}

const CONTRACT = { projection: "conformance", serialisation: "v1" };

function transition(overrides: Partial<ContextTransition> = {}): ContextTransition {
  return {
    reason: "initial",
    parent: null,
    core: "You are a test agent.",
    contract: CONTRACT,
    ...overrides,
  };
}

function manifest(overrides: Partial<ContextManifestInput> = {}): ContextManifestInput {
  return {
    projection: { adapter: "conformance", version: "1" },
    model: { provider: "test", modelId: "model-a" },
    inputDigest: "a".repeat(64),
    ...overrides,
  };
}

function user(key: string, text = `text for ${key}`): UserContextEntryInput {
  return { kind: "user", key, message: { role: "user", content: [{ type: "text", text }] } };
}

function assistant(key: string, text = `reply for ${key}`): AssistantContextEntryInput {
  return {
    kind: "assistant",
    key,
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

function toolResult(key: string, toolCallId: string): ToolResultContextEntryInput {
  return {
    kind: "tool_result",
    key,
    message: {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName: "lookup",
          output: { type: "json", value: { found: true } },
        },
      ],
    },
  };
}

function runtime(
  key: string,
  payload: RuntimeContextEntryInput["payload"],
  supersedes?: string,
): RuntimeContextEntryInput {
  return {
    kind: "runtime_context",
    key,
    producer: "clock",
    payload,
    ...(supersedes !== undefined ? { supersedes } : {}),
  };
}

/** Entry content in a form comparable with the input, without store-added record fields. */
function inputOf(entry: ContextEntry): ContextEntryInput {
  const { position: _p, versionId: _v, manifestId: _m, createdAt: _c, ...input } = entry;
  return input as ContextEntryInput;
}

async function readAll(
  store: ContextLogStore,
  ref: ContextPathRef,
  limit?: number,
): Promise<ContextEntry[]> {
  const entries: ContextEntry[] = [];
  let after = 0;
  for (let page = 0; page < 10_000; page += 1) {
    const result = await store.readPath(ref, { after, ...(limit !== undefined ? { limit } : {}) });
    if (result.entries.length === 0 && result.nextAfter !== null) {
      fail("readPath returned an empty page with a next cursor");
    }
    entries.push(...result.entries);
    if (result.nextAfter === null) return entries;
    check(result.nextAfter > after, "readPath cursor must advance");
    after = result.nextAfter;
  }
  return fail("readPath did not terminate");
}

interface CaseContext {
  store: ContextLogStore;
  thread: string;
  stream: (branchId?: string, streamId?: string) => ContextStreamRef;
  key: (label: string) => string;
  /** Prepares on a stream, reading the expected revision from its head. */
  prepare: (
    stream: ContextStreamRef,
    append: ContextEntryInput[],
    extra?: Partial<ContextPrepareRequest>,
  ) => ReturnType<ContextLogStore["prepare"]>;
}

/**
 * Builds the conformance cases for a {@link ContextLogStore} implementation.
 *
 * The cases cover compare-and-swap conflicts, idempotent and uncertain
 * retries, byte-exact content, pagination, the call lifecycle, transitions and
 * branch inheritance. Run them with any test framework, or use
 * {@link defineContextLogStoreConformanceSuite}.
 *
 * @param options - How to create the store under test
 * @returns The cases, in a stable order
 *
 * @experimental
 * @category Context Log
 */
export function createContextLogStoreConformanceCases(
  options: ContextLogStoreConformanceOptions,
): ContextLogConformanceCase[] {
  const cases: ContextLogConformanceCase[] = [];

  const define = (name: string, body: (context: CaseContext) => Promise<void>) => {
    cases.push({
      name,
      run: async () => {
        const store = await options.createStore();
        try {
          const thread = options.createThreadId
            ? await options.createThreadId()
            : `conformance-${randomUUID()}`;
          const stream = (branchId = "main", streamId = "main") => ({
            threadId: thread,
            branchId,
            streamId,
          });
          const key = (label: string) => `${label}-${randomUUID()}`;
          const prepare: CaseContext["prepare"] = async (target, append, extra = {}) => {
            const head = await store.readHead(target);
            return store.prepare({
              stream: target,
              expectedRevision: head?.revision ?? 0,
              idempotencyKey: key("prepare"),
              append,
              manifest: manifest(),
              ...(head ? {} : { transition: transition() }),
              ...extra,
            });
          };
          await body({ store, thread, stream, key, prepare });
        } finally {
          await options.disposeStore?.(store);
        }
      },
    });
  };

  define("readHead returns null for a stream without a head", async ({ store, stream }) => {
    check((await store.readHead(stream())) === null, "expected no head");
  });

  define("the first prepare requires a transition", async ({ store, stream, key }) => {
    await rejects(
      () =>
        store.prepare({
          stream: stream(),
          expectedRevision: 0,
          idempotencyKey: key("prepare"),
          append: [user("u1")],
          manifest: manifest(),
        }),
      "conflict",
      "invalid_transition",
    );
    check((await store.readHead(stream())) === null, "a refused prepare must not create a head");
  });

  define(
    "prepare commits a root version, entries, a manifest and a head",
    async ({ store, stream, key }) => {
      const idempotencyKey = key("prepare");
      const result = await store.prepare({
        stream: stream(),
        expectedRevision: 0,
        idempotencyKey,
        transition: transition({ metadata: { source: "conformance" } }),
        append: [user("u1"), runtime("r1", { today: "2026-10-01" })],
        manifest: manifest({ ordinal: 1, attempt: 1, metadata: { run: "r-1" } }),
      });
      check(result.created, "expected created: true");
      const { head, manifest: committed } = result;
      same(head.stream, stream(), "head stream");
      check(head.revision === 1, `expected revision 1, got ${head.revision}`);
      check(head.entryCount === 2, `expected 2 entries, got ${head.entryCount}`);
      check(head.lastManifestId === committed.id, "head.lastManifestId must be the manifest");
      check(
        typeof head.pathDigest === "string" && head.pathDigest.length > 0,
        "head needs a path digest",
      );
      same(await store.readHead(stream()), head, "readHead after prepare");

      check(committed.idempotencyKey === idempotencyKey, "manifest idempotency key");
      check(committed.versionId === head.versionId, "manifest version");
      check(committed.entryCount === 2 && committed.headRevision === 1, "manifest boundary");
      check(committed.pathDigest === head.pathDigest, "manifest path digest must equal the head's");
      check(
        committed.dispatchedAt === null && committed.outcome === null,
        "a new manifest is open",
      );
      same(committed.metadata, { run: "r-1" }, "manifest metadata");
      same(await store.readManifest(committed.id), committed, "readManifest");

      const version = await store.readVersion(head.versionId);
      check(version.parentVersionId === null && version.inheritedCount === 0, "root version");
      check(version.reason === "initial", "version reason");
      check(version.core === "You are a test agent.", "version core");
      same(version.contract, CONTRACT, "version contract");
      same(version.metadata, { source: "conformance" }, "version metadata");
      same(version.stream, stream(), "version stream");
      check(version.createdByManifestId === committed.id, "version creator");

      const entries = await readAll(store, head);
      check(entries.length === 2, "expected two entries");
      entries.forEach((entry, index) => {
        check(entry.position === index + 1, "positions are dense and 1-based");
        check(entry.versionId === head.versionId, "entry version");
        check(entry.manifestId === committed.id, "entry manifest");
      });
      same(
        entries.map(inputOf),
        [user("u1"), runtime("r1", { today: "2026-10-01" })],
        "entry content",
      );
    },
  );

  define(
    "entry content and metadata round-trip byte for byte",
    async ({ store, stream, prepare }) => {
      const exotic: ContextEntryInput[] = [
        {
          kind: "user",
          key: "exotic-user",
          message: {
            role: "user",
            content: [{ type: "text", text: 'Ünïcödé 🚀   "quotes" \\ back\nslash\ttab \u0001' }],
          },
          metadata: { zeta: 1, alpha: [true, null, -0.5, 1e21], nested: { b: "x", a: "y" } },
        },
        {
          kind: "assistant",
          key: "exotic-assistant",
          model: { provider: "anthropic", modelId: "claude-test" },
          providerMetadata: { anthropic: { responseId: "msg_1", usage: { cacheRead: 10 } } },
          message: {
            role: "assistant",
            content: [
              {
                type: "reasoning",
                text: "thinking…",
                providerOptions: { anthropic: { signature: "EqQBCgIYAhIM+/==" } },
              },
              { type: "text", text: "answer" },
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "lookup",
                input: { z: 1, a: [2, 3] },
              },
            ],
          },
        },
        toolResult("exotic-tool", "call-1"),
        runtime("exotic-runtime", { b: { deep: ["x", { y: null }] }, a: "1" }),
      ];
      const { head } = await prepare(stream(), exotic);
      const entries = await readAll(store, head);
      check(entries.length === exotic.length, "every entry is returned");
      entries.forEach((entry, index) => {
        // Model-facing content (the message, or a runtime payload) must keep
        // its exact bytes, including nested key order: structural equality is
        // not enough for provider replay. Other fields must be equal as JSON.
        const expected = exotic[index] as unknown as Record<string, unknown>;
        const actual = inputOf(entry) as unknown as Record<string, unknown>;
        same(actual, expected, `entry ${index}`);
        for (const field of ["message", "payload"]) {
          if (!(field in expected)) continue;
          const want = JSON.stringify(expected[field]);
          const got = JSON.stringify(actual[field]);
          if (got !== want)
            fail(`entry ${index} ${field} changed\n  expected: ${want}\n  actual:   ${got}`);
        }
      });
    },
  );

  define(
    "a stale expected revision conflicts and writes nothing",
    async ({ store, stream, key, prepare }) => {
      const first = await prepare(stream(), [user("u1")]);
      const error = (await rejects(
        () =>
          store.prepare({
            stream: stream(),
            expectedRevision: 0,
            idempotencyKey: key("prepare"),
            append: [user("u2")],
            manifest: manifest(),
          }),
        "conflict",
        "head_moved",
      )) as { head: ContextHead | null };
      same(error.head, first.head, "the conflict reports the current head");
      same(await store.readHead(stream()), first.head, "the head is unchanged");
      check((await readAll(store, first.head)).length === 1, "nothing was appended");
    },
  );

  define(
    "exactly one of two concurrent prepares on the same revision wins",
    async ({ store, stream, key, prepare }) => {
      const { head } = await prepare(stream(), [user("u1")]);
      const attempt = (label: string) =>
        store.prepare({
          stream: stream(),
          expectedRevision: head.revision,
          idempotencyKey: key(label),
          append: [user(label)],
          manifest: manifest(),
        });
      const results = await Promise.allSettled([attempt("left"), attempt("right")]);
      const won = results.filter((result) => result.status === "fulfilled");
      const lost = results.filter((result) => result.status === "rejected");
      check(won.length === 1 && lost.length === 1, "exactly one prepare must win");
      const reason = (lost[0] as PromiseRejectedResult).reason;
      check(
        isContextLogError(reason, "conflict"),
        `the loser must conflict, got ${String(reason)}`,
      );
      const after = (await store.readHead(stream()))!;
      check(after.revision === head.revision + 1, "the head moved exactly once");
      check(after.entryCount === 2, "only the winner's entry was appended");
    },
  );

  define(
    "an idempotent retry returns the committed prepare without appending",
    async ({ store, stream, key }) => {
      const request: ContextPrepareRequest = {
        stream: stream(),
        expectedRevision: 0,
        idempotencyKey: key("prepare"),
        transition: transition(),
        append: [user("u1")],
        manifest: manifest(),
      };
      const first = await store.prepare(request);
      const retry = await store.prepare(request);
      check(!retry.created, "a retry must report created: false");
      same(retry.manifest, first.manifest, "a retry returns the same manifest");
      same(retry.head, first.head, "a retry returns the current head");
      check((await readAll(store, first.head)).length === 1, "a retry appends nothing");
    },
  );

  define(
    "an uncertain prepare is recovered by its idempotency key after the head moved",
    async ({ store, stream, key, prepare }) => {
      await prepare(stream(), [user("u0")]);
      const head = (await store.readHead(stream()))!;
      const request: ContextPrepareRequest = {
        stream: stream(),
        expectedRevision: head.revision,
        idempotencyKey: key("uncertain"),
        append: [user("u1")],
        manifest: manifest({ ordinal: 2, attempt: 1 }),
      };
      // The caller never sees this result (for example a timeout), and the head
      // moves on before it retries.
      await store.prepare(request);
      await rejects(
        () => store.prepare({ ...request, idempotencyKey: key("other") }),
        "conflict",
        "head_moved",
      );
      await prepare(stream(), [user("u2")]);

      const recovered = await store.prepare(request);
      check(!recovered.created, "recovery reports the committed prepare");
      check(
        recovered.manifest.entryCount === head.entryCount + 1,
        "recovery returns the original boundary",
      );
      same(recovered.head, await store.readHead(stream()), "recovery returns the current head");
      const path = await readAll(store, recovered.manifest);
      same(
        path.map((entry) => entry.key),
        ["u0", "u1"],
        "the manifest reads back the path it committed",
      );
    },
  );

  define(
    "reusing an idempotency key for a different request conflicts",
    async ({ store, stream, key }) => {
      const idempotencyKey = key("prepare");
      const base: ContextPrepareRequest = {
        stream: stream(),
        expectedRevision: 0,
        idempotencyKey,
        transition: transition(),
        append: [user("u1")],
        manifest: manifest(),
      };
      const first = await store.prepare(base);
      await rejects(
        () =>
          store.prepare({
            ...base,
            expectedRevision: first.head.revision,
            append: [user("u1", "different")],
          }),
        "conflict",
        "idempotency_mismatch",
      );
      await rejects(
        () => store.prepare({ ...base, manifest: manifest({ inputDigest: "b".repeat(64) }) }),
        "conflict",
        "idempotency_mismatch",
      );
      // The expected revision is part of the request.
      await rejects(
        () => store.prepare({ ...base, expectedRevision: first.head.revision }),
        "conflict",
        "idempotency_mismatch",
      );
      same(await store.readHead(stream()), first.head, "the head is unchanged");
    },
  );

  define("entry keys are unique along a path", async ({ store, stream, key, prepare }) => {
    const { head } = await prepare(stream(), [user("u1")]);
    await rejects(
      () =>
        store.prepare({
          stream: stream(),
          expectedRevision: head.revision,
          idempotencyKey: key("prepare"),
          append: [user("u2"), user("u1", "again")],
          manifest: manifest(),
        }),
      "conflict",
      "key_taken",
    );
    same(await store.readHead(stream()), head, "a key conflict writes nothing");
    await rejects(
      () =>
        store.prepare({
          stream: stream(),
          expectedRevision: head.revision,
          idempotencyKey: key("prepare"),
          append: [user("u3"), user("u3")],
          manifest: manifest(),
        }),
      "invalid",
    );
  });

  define(
    "the call lifecycle is prepare, dispatch, outputs, outcome",
    async ({ store, stream, prepare }) => {
      const { manifest: prepared, head } = await prepare(stream(), [user("u1")]);
      await rejects(
        () =>
          store.appendOutputs({
            manifestId: prepared.id,
            expectedRevision: head.revision,
            items: [assistant("a1")],
          }),
        "conflict",
        "invalid_lifecycle",
      );
      await rejects(
        () => store.recordOutcome(prepared.id, { status: "completed" }),
        "conflict",
        "invalid_lifecycle",
      );

      const dispatched = await store.markDispatched(prepared.id);
      check(typeof dispatched.dispatchedAt === "string", "dispatchedAt is recorded");
      await rejects(
        () => store.markDispatched(prepared.id),
        "conflict",
        "dispatch_already_started",
      );

      const outputs = await store.appendOutputs({
        manifestId: prepared.id,
        expectedRevision: head.revision,
        items: [
          {
            ...assistant("a1"),
            message: {
              role: "assistant",
              content: [{ type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: {} }],
            },
          },
        ],
      });
      check(outputs.created, "outputs were appended");
      check(outputs.head.revision === head.revision + 1, "outputs move the head");
      check(outputs.head.lastManifestId === prepared.id, "outputs keep the manifest on the head");
      check(outputs.head.pathDigest !== head.pathDigest, "outputs change the path digest");
      check(
        outputs.entries[0]?.position === head.entryCount + 1,
        "outputs follow the prepared path",
      );
      check(outputs.entries[0]?.manifestId === prepared.id, "outputs belong to the manifest");

      const closed = await store.recordOutcome(prepared.id, {
        status: "completed",
        metadata: { inputTokens: 12 },
      });
      check(closed.outcome?.status === "completed", "the outcome is recorded");
      same(closed.outcome?.metadata, { inputTokens: 12 }, "outcome metadata");
      const repeated = await store.recordOutcome(prepared.id, { status: "completed" });
      check(repeated.outcome?.status === "completed", "repeating an outcome is a no-op");
      await rejects(
        () => store.recordOutcome(prepared.id, { status: "failed" }),
        "conflict",
        "invalid_lifecycle",
      );

      // Tool results may follow a completed call.
      const tools = await store.appendOutputs({
        manifestId: prepared.id,
        expectedRevision: outputs.head.revision,
        items: [toolResult("t1", "call-1")],
      });
      check(
        tools.head.entryCount === head.entryCount + 2,
        "tool results are appended after the output",
      );
      check(
        (await store.readManifest(prepared.id)).entryCount === head.entryCount,
        "a manifest's boundary never moves",
      );
    },
  );

  define("only cancellation may close an undispatched call", async ({ store, stream, prepare }) => {
    const { manifest: prepared } = await prepare(stream(), [user("u1")]);
    const cancelled = await store.recordOutcome(prepared.id, { status: "cancelled" });
    check(
      cancelled.outcome?.status === "cancelled" && cancelled.dispatchedAt === null,
      "cancelled before dispatch",
    );
    await rejects(() => store.markDispatched(prepared.id), "conflict", "dispatch_already_started");
  });

  define(
    "a call cannot be dispatched once the head has moved past it",
    async ({ store, stream, prepare }) => {
      const stale = await prepare(stream(), [user("u1")]);
      await prepare(stream(), [user("u2")]);
      await rejects(() => store.markDispatched(stale.manifest.id), "conflict", "head_moved");
    },
  );

  define(
    "outputs are refused after a failed, cancelled or unknown outcome",
    async ({ store, stream, prepare }) => {
      for (const status of ["failed", "cancelled", "unknown"] as const) {
        const { manifest: prepared, head } = await prepare(stream(), [user(`u-${status}`)]);
        await store.markDispatched(prepared.id);
        await store.recordOutcome(prepared.id, { status });
        await rejects(
          () =>
            store.appendOutputs({
              manifestId: prepared.id,
              expectedRevision: head.revision,
              items: [assistant(`a-${status}`)],
            }),
          "conflict",
          "invalid_lifecycle",
        );
      }
    },
  );

  define(
    "appendOutputs is conditional on the head revision and idempotent on retry",
    async ({ store, stream, prepare }) => {
      const { manifest: prepared, head } = await prepare(stream(), [user("u1")]);
      await store.markDispatched(prepared.id);
      await rejects(
        () =>
          store.appendOutputs({
            manifestId: prepared.id,
            expectedRevision: head.revision - 1,
            items: [assistant("a1")],
          }),
        "conflict",
        "head_moved",
      );
      const request = {
        manifestId: prepared.id,
        expectedRevision: head.revision,
        items: [assistant("a1")],
      };
      const first = await store.appendOutputs(request);
      const retry = await store.appendOutputs(request);
      check(!retry.created, "an identical retry reports created: false");
      same(retry.entries, first.entries, "an identical retry returns the committed entries");
      same(retry.head, first.head, "an identical retry does not move the head");
      // A different request reusing a committed key conflicts (the stale
      // revision or the taken key; stores may report either).
      await rejects(
        () => store.appendOutputs({ ...request, items: [assistant("a1", "different")] }),
        "conflict",
      );
      await rejects(
        () =>
          store.appendOutputs({
            manifestId: prepared.id,
            expectedRevision: first.head.revision,
            items: [assistant("a1", "different")],
          }),
        "conflict",
        "key_taken",
      );
      await rejects(
        () =>
          store.appendOutputs({
            manifestId: prepared.id,
            expectedRevision: first.head.revision,
            items: [user("not-an-output") as unknown as AssistantContextEntryInput],
          }),
        "invalid",
      );
    },
  );

  define("operations on unknown records report not found", async ({ store, stream }) => {
    const missing = `missing-${randomUUID()}`;
    await rejects(() => store.readManifest(missing), "not_found");
    await rejects(() => store.readVersion(missing), "not_found");
    await rejects(() => store.markDispatched(missing), "not_found");
    await rejects(() => store.recordOutcome(missing, { status: "cancelled" }), "not_found");
    await rejects(
      () =>
        store.appendOutputs({ manifestId: missing, expectedRevision: 1, items: [assistant("a1")] }),
      "not_found",
    );
    await rejects(
      () => store.readPath({ stream: stream(), versionId: missing, entryCount: 1 }),
      "not_found",
    );
  });

  define("a path reference only reads its own stream", async ({ store, stream, prepare }) => {
    const main = await prepare(stream(), [user("u1")]);
    await rejects(
      () => store.readPath({ ...main.head, stream: stream("other-branch") }),
      "not_found",
    );
    await rejects(
      () => store.readPath({ ...main.head, stream: stream("main", "other-stream") }),
      "not_found",
    );
  });

  define(
    "an output retry is recovered after a transition and other retries conflict",
    async ({ store, stream, prepare }) => {
      const { manifest: prepared, head } = await prepare(stream(), [user("u1")]);
      await store.markDispatched(prepared.id);
      const request = {
        manifestId: prepared.id,
        expectedRevision: head.revision,
        items: [assistant("a1"), assistant("a2")],
      };
      const first = await store.appendOutputs(request);
      await rejects(
        () => store.appendOutputs({ ...request, items: [assistant("a2"), assistant("a1")] }),
        "conflict",
      );
      await rejects(
        () => store.appendOutputs({ ...request, items: [assistant("a1")] }),
        "conflict",
      );
      await store.recordOutcome(prepared.id, { status: "completed" });

      // A compaction drops the outputs from the head's path.
      await prepare(stream(), [runtime("summary", { summary: "a1 and a2" })], {
        transition: transition({
          reason: "compaction",
          parent: { versionId: first.head.versionId, inheritedCount: 0 },
        }),
      });
      const retry = await store.appendOutputs(request);
      check(!retry.created, "the retry reports the committed outputs");
      same(retry.entries, first.entries, "the retry returns the committed entries");
      same(retry.head, await store.readHead(stream()), "the retry returns the current head");
    },
  );

  define(
    "readPath pages in order and never changes for a committed reference",
    async ({ store, stream, prepare }) => {
      const first = await prepare(
        stream(),
        Array.from({ length: 7 }, (_, index) => user(`u${index + 1}`)),
      );
      const head = first.head;
      const page1 = await store.readPath(head, { limit: 3 });
      check(page1.entries.length >= 1 && page1.entries.length <= 3, "a page respects the limit");
      const all = await readAll(store, head, 3);
      same(
        all.map((entry) => entry.position),
        [1, 2, 3, 4, 5, 6, 7],
        "pages cover the path once, in order",
      );
      same(
        all.map((entry) => entry.key),
        ["u1", "u2", "u3", "u4", "u5", "u6", "u7"],
        "page content",
      );
      const tail = await store.readPath(head, { after: 7 });
      check(tail.entries.length === 0 && tail.nextAfter === null, "reading past the end is empty");
      const middle: number[] = [];
      for (let after: number | null = 5; after !== null; ) {
        const page = await store.readPath(head, { after });
        middle.push(...page.entries.map((entry) => entry.position));
        after = page.nextAfter;
      }
      same(middle, [6, 7], "after skips earlier positions");

      await prepare(stream(), [user("u8")]);
      same(await readAll(store, head), all, "an old head reads the same path after appends");
      same(await readAll(store, first.manifest), all, "a manifest reads the path it committed");
    },
  );

  define(
    "a compaction transition starts a child version and keeps the parent readable",
    async ({ store, stream, prepare }) => {
      const before = await prepare(stream(), [user("u1"), user("u2"), user("u3")]);
      const compacted = await prepare(
        stream(),
        [runtime("summary", { summary: "u1 and u2" }), user("u4")],
        {
          transition: transition({
            reason: "compaction",
            parent: { versionId: before.head.versionId, inheritedCount: 0 },
            metadata: { summarised: 2 },
          }),
        },
      );
      const version = await store.readVersion(compacted.head.versionId);
      check(version.id !== before.head.versionId, "a transition creates a new version");
      check(version.parentVersionId === before.head.versionId, "the child names its parent");
      check(
        version.inheritedCount === 0 && version.reason === "compaction",
        "child version fields",
      );
      same(version.metadata, { summarised: 2 }, "transition metadata");
      same(
        (await readAll(store, compacted.head)).map((entry) => entry.key),
        ["summary", "u4"],
        "the child path holds only its own entries",
      );
      same(
        (await readAll(store, before.manifest)).map((entry) => entry.key),
        ["u1", "u2", "u3"],
        "the parent path is still readable from its manifest",
      );
      check(
        compacted.head.revision === before.head.revision + 1,
        "a transition moves the head once",
      );

      // Keys outside the inherited prefix are free on the child path.
      const reused = await prepare(stream(), [user("u1", "replayed")]);
      check(reused.head.entryCount === 3, "a key the child did not inherit can be reused");
    },
  );

  define("a transition can inherit a prefix of its parent", async ({ store, stream, prepare }) => {
    const before = await prepare(stream(), [user("u1"), user("u2"), user("u3")]);
    const changed = await prepare(stream(), [user("u4")], {
      transition: transition({
        reason: "model_change",
        parent: { versionId: before.head.versionId, inheritedCount: 2 },
      }),
    });
    const entries = await readAll(store, changed.head);
    same(
      entries.map((entry) => entry.key),
      ["u1", "u2", "u4"],
      "the child path is the inherited prefix plus its own entries",
    );
    check(entries[0]?.versionId === before.head.versionId, "inherited entries keep their version");
    check(
      entries[2]?.versionId === changed.head.versionId && entries[2]?.position === 3,
      "own entries follow the prefix",
    );
    await rejects(() => prepare(stream(), [user("u2", "again")]), "conflict", "key_taken");

    // Keys stay unique through more than one level of inheritance.
    const grandchild = await prepare(stream(), [user("u5")], {
      transition: transition({
        reason: "compaction",
        parent: { versionId: changed.head.versionId, inheritedCount: 3 },
      }),
    });
    same(
      (await readAll(store, grandchild.head)).map((entry) => entry.key),
      ["u1", "u2", "u4", "u5"],
      "a grandchild path chains both inherited prefixes",
    );
    await rejects(() => prepare(stream(), [user("u1", "again")]), "conflict", "key_taken");
  });

  define("invalid transitions conflict", async ({ store, stream, prepare }) => {
    const { head } = await prepare(stream(), [user("u1")]);
    await rejects(
      () => prepare(stream(), [user("u2")], { transition: transition() }),
      "conflict",
      "invalid_transition",
    );
    await rejects(
      () =>
        prepare(stream(), [user("u2")], {
          transition: transition({
            reason: "compaction",
            parent: { versionId: head.versionId, inheritedCount: 2 },
          }),
        }),
      "conflict",
      "invalid_transition",
    );
    await rejects(
      () =>
        prepare(stream(), [user("u2")], {
          transition: transition({
            reason: "compaction",
            parent: { versionId: `missing-${randomUUID()}`, inheritedCount: 0 },
          }),
        }),
      "conflict",
      "invalid_transition",
    );
    await rejects(
      () =>
        prepare(stream("main", "other"), [user("u2")], {
          transition: transition({
            reason: "branch",
            parent: { versionId: head.versionId, inheritedCount: 1 },
          }),
        }),
      "conflict",
      "invalid_transition",
    );
    same(await store.readHead(stream()), head, "invalid transitions write nothing");
  });

  define("hosts can declare their own transition reasons", async ({ store, stream, prepare }) => {
    const { head } = await prepare(stream(), [user("u1")]);
    const custom = await prepare(stream(), [], {
      transition: transition({
        reason: "host_policy_change",
        core: "A changed core.",
        parent: { versionId: head.versionId, inheritedCount: 1 },
      }),
    });
    const version = await store.readVersion(custom.head.versionId);
    check(version.reason === "host_policy_change", "a custom reason is stored");
    check(version.core === "A changed core.", "the new core is stored");
    check(custom.head.entryCount === 1, "an empty prepare keeps the inherited path");
    check(
      custom.head.pathDigest !== head.pathDigest,
      "a transition changes the path digest even without new entries",
    );
    const again = await prepare(stream(), [], {
      transition: transition({
        reason: "host_policy_change",
        core: "A changed core.",
        parent: { versionId: custom.head.versionId, inheritedCount: 0 },
      }),
    });
    const repeat = await prepare(stream(), [], {
      transition: transition({
        reason: "host_policy_change",
        core: "A changed core.",
        parent: { versionId: again.head.versionId, inheritedCount: 0 },
      }),
    });
    check(
      repeat.head.pathDigest !== again.head.pathDigest,
      "every new version changes the path digest, even an identical empty one",
    );
  });

  define(
    "a new branch inherits a prefix and diverges independently",
    async ({ store, stream, prepare }) => {
      const main = await prepare(stream(), [user("u1"), assistant("a1"), user("u2")]);
      const branch = await prepare(stream("edit"), [user("u2", "edited")], {
        transition: transition({
          reason: "branch",
          parent: { versionId: main.head.versionId, inheritedCount: 2 },
        }),
      });
      check(branch.head.revision === 1, "a branch has its own head");
      same(branch.head.stream, stream("edit"), "the branch head is on the branch");
      same(
        (await readAll(store, branch.head)).map(inputOf),
        [user("u1"), assistant("a1"), user("u2", "edited")],
        "the branch path is the inherited prefix plus its edit",
      );
      same(await store.readHead(stream()), main.head, "the original branch is unchanged");
      same(
        (await readAll(store, main.head)).map((entry) => entry.key),
        ["u1", "a1", "u2"],
        "the original path is unchanged",
      );
      const more = await prepare(stream(), [user("u3")]);
      check(more.head.revision === main.head.revision + 1, "branches advance independently");
      check((await store.readHead(stream("edit")))?.revision === 1, "the branch head did not move");
    },
  );

  define("streams on one branch have independent heads", async ({ store, stream, prepare }) => {
    const main = await prepare(stream(), [user("u1")]);
    const child = await prepare(stream("main", "run-1/subagent/research"), [user("u1")]);
    check(
      child.head.revision === 1 && child.head.versionId !== main.head.versionId,
      "the child stream has its own head",
    );
    same(await store.readHead(stream()), main.head, "the main stream is unchanged");
  });

  define("the path digest identifies the path", async ({ store, stream, prepare }) => {
    const first = await prepare(stream(), [user("u1")]);
    const again = await store.readHead(stream());
    check(again?.pathDigest === first.head.pathDigest, "rereading a head returns the same digest");
    const second = await prepare(stream(), [user("u2")]);
    check(second.head.pathDigest !== first.head.pathDigest, "an append changes the digest");
    const empty = await prepare(stream(), []);
    check(
      empty.head.pathDigest === second.head.pathDigest,
      "a prepare without entries keeps the digest",
    );
    check(
      empty.head.revision === second.head.revision + 1,
      "a prepare without entries still moves the revision",
    );
  });

  return cases;
}

/**
 * Registers the context log store conformance suite with a test framework.
 *
 * @param name - Name of the store under test, used for the `describe` block
 * @param options - How to create the store under test
 * @param api - The framework's `describe` and `it`
 *
 * @example
 * ```typescript
 * import { describe, it } from "vitest";
 * import { MemoryContextLogStore } from "@lleverage-ai/agent-sdk";
 * import { defineContextLogStoreConformanceSuite } from "@lleverage-ai/agent-sdk/testing";
 *
 * defineContextLogStoreConformanceSuite(
 *   "MemoryContextLogStore",
 *   { createStore: () => new MemoryContextLogStore() },
 *   { describe, it },
 * );
 * ```
 *
 * @experimental
 * @category Context Log
 */
export function defineContextLogStoreConformanceSuite(
  name: string,
  options: ContextLogStoreConformanceOptions,
  api: ConformanceTestApi,
): void {
  api.describe(`ContextLogStore conformance: ${name}`, () => {
    for (const testCase of createContextLogStoreConformanceCases(options)) {
      api.it(testCase.name, testCase.run);
    }
  });
}
