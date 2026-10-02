/**
 * A host supplies history for a log-mode run with `contextHistory`: a root
 * history imports a stream's legacy history as its first version (the
 * declared `legacy_projection_import` transition), and appended history adds
 * messages written outside the agent (for example a voice turn) after the
 * head's path. Every entry passes the PreGenerate hooks before it is
 * committed, and the run's first prepare commits it before the run's input.
 */

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  type AgentOptions,
  ConfigurationError,
  type ContextAdmitInput,
  type ContextHistoryInput,
  type ContextLogStore,
  type ContextStreamRef,
  createAgent,
  isContextLogError,
  LEGACY_PROJECTION_IMPORT_REASON,
  MemoryContextLogStore,
  ValidationError,
} from "../../src/index.js";

const THREAD = "thread-1";
const MAIN: ContextStreamRef = { threadId: THREAD, branchId: "main", streamId: "main" };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function createRecordingModel() {
  let calls = 0;
  const requests: LanguageModelV3CallOptions[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      requests.push(options);
      calls++;
      return {
        content: [{ type: "text", text: `A${calls}` }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
  });
  return { model: model as LanguageModel, requests };
}

function logAgent(
  model: LanguageModel,
  store: ContextLogStore,
  options: Partial<AgentOptions> = {},
  contextLog: Partial<NonNullable<AgentOptions["contextLog"]>> = {},
) {
  return createAgent({
    model,
    systemPrompt: "You are the core.",
    ...options,
    contextLog: { mode: "log", store, ...contextLog },
  });
}

const text = (role: "user" | "assistant", value: string) => ({
  role,
  content: [{ type: "text", text: value }],
});

/** A legacy conversation: a question, a tool call and its result, an answer. */
const legacyHistory: ContextHistoryInput = {
  root: {
    reason: LEGACY_PROJECTION_IMPORT_REASON,
    metadata: { legacyImport: { sourceEventSequence: 42 } },
  },
  entries: [
    {
      key: "import:0",
      message: { role: "user", content: "What is on Monday?" },
      metadata: { imported: true },
    },
    {
      key: "import:1",
      message: {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call-1", toolName: "calendar", input: { day: "mon" } },
        ],
      },
      metadata: { imported: true },
    },
    {
      key: "import:2",
      message: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "calendar",
            output: { type: "json", value: { events: ["stand-up"] } },
          },
        ],
      },
      metadata: { imported: true },
    },
    {
      key: "import:3",
      message: { role: "assistant", content: "A stand-up." },
      metadata: { imported: true },
    },
  ],
};

async function readAll(store: ContextLogStore) {
  const head = (await store.readHead(MAIN))!;
  const page = await store.readPath(head, { after: 0, limit: 100 });
  return { head, entries: page.entries };
}

describe("log-mode imported history", () => {
  it("imports a stream's history as its first version before the run's input", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createRecordingModel();
    const admitted: ContextAdmitInput[] = [];

    await logAgent(
      model,
      store,
      {},
      {
        admit: (input) => {
          admitted.push(input);
          return { allow: true };
        },
      },
    ).generate({ prompt: "And Tuesday?", threadId: THREAD, contextHistory: legacyHistory });

    const { head, entries } = await readAll(store);
    expect(entries.map((entry) => entry.key)).toEqual([
      "import:0",
      "import:1",
      "import:2",
      "import:3",
      expect.stringMatching(/^user:/),
      expect.stringMatching(/^output:/),
    ]);
    expect(entries.slice(0, 4).every((entry) => entry.metadata?.imported === true)).toBe(true);
    const version = await store.readVersion(head.versionId);
    expect(version).toMatchObject({
      reason: LEGACY_PROJECTION_IMPORT_REASON,
      parentVersionId: null,
      core: "You are the core.",
      metadata: { legacyImport: { sourceEventSequence: 42 } },
    });
    // The admit hook sees the declared cause.
    const prepare = admitted.find((input) => input.phase === "prepare");
    expect(prepare?.phase === "prepare" && prepare.request.transition?.reason).toBe(
      LEGACY_PROJECTION_IMPORT_REASON,
    );
    // The provider receives the imported history, then the new input.
    const prompt = requests[0]!.prompt;
    expect(prompt[1]).toEqual(text("user", "What is on Monday?"));
    expect(prompt.at(-1)).toEqual(text("user", "And Tuesday?"));
  });

  it("ignores root history once the stream has a head, so concurrent first runs converge", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createRecordingModel();
    const agent = logAgent(model, store);
    await agent.generate({ prompt: "First run", threadId: THREAD, contextHistory: legacyHistory });
    const first = await readAll(store);

    // A second run that read the same legacy source, after the import.
    await agent.generate({ prompt: "Second run", threadId: THREAD, contextHistory: legacyHistory });
    const second = await readAll(store);
    expect(second.head.versionId).toBe(first.head.versionId);
    expect(second.entries.filter((entry) => entry.key.startsWith("import:"))).toHaveLength(4);
    expect(second.entries).toHaveLength(first.entries.length + 2);
  });

  it("ignores root history on a declared branch, which inherits its source instead", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createRecordingModel();
    const agent = logAgent(model, store);
    await agent.generate({ prompt: "first", threadId: THREAD });
    const head = (await store.readHead(MAIN))!;
    await agent.generate({
      prompt: "edited",
      threadId: THREAD,
      contextStream: {
        branchId: "edit",
        branchFrom: { stream: MAIN, versionId: head.versionId, entryCount: 1 },
      },
      contextHistory: legacyHistory,
    });
    const edit = (await store.readHead({ ...MAIN, branchId: "edit" }))!;
    const page = await store.readPath(edit, { after: 0, limit: 100 });
    expect(page.entries.some((entry) => entry.key.startsWith("import:"))).toBe(false);
    expect((await store.readVersion(edit.versionId)).reason).toBe("branch");
  });

  it("refuses imported history that ends with an unanswered tool call", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createRecordingModel();
    const pending: ContextHistoryInput = {
      root: legacyHistory.root,
      entries: legacyHistory.entries.slice(0, 2),
    };
    const error = await logAgent(model, store)
      .generate({ prompt: "Hi", threadId: THREAD, contextHistory: pending })
      .catch((caught: unknown) => caught);
    expect(isContextLogError(error, "invalid")).toBe(true);
    expect((error as { reason?: string }).reason).toBe("history_unanswered_tool_call");
    expect(await store.readHead(MAIN)).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("screens every history entry with the PreGenerate hooks before it is committed", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createRecordingModel();
    const seen: string[] = [];
    const agent = logAgent(model, store, {
      hooks: {
        PreGenerate: [
          (input) => {
            if (input.hook_event_name !== "PreGenerate") return undefined;
            // Hooks never see the unscreened option itself.
            expect(input.options.contextHistory).toBeUndefined();
            const messages = (input.options.messages ?? []).map((message) => {
              seen.push(message.role);
              return JSON.parse(
                JSON.stringify(message).replaceAll("stand-up", "[REDACTED]"),
              ) as typeof message;
            });
            return {
              hookSpecificOutput: {
                hookEventName: "PreGenerate",
                updatedInput: { ...input.options, messages },
              },
            };
          },
        ],
      },
    });
    await agent.generate({ prompt: "Hi", threadId: THREAD, contextHistory: legacyHistory });
    expect(seen.slice(0, 4)).toEqual(["user", "assistant", "tool", "assistant"]);
    const { entries } = await readAll(store);
    expect(JSON.stringify(entries)).not.toContain("stand-up");
    expect(JSON.stringify(requests[0]!.prompt)).not.toContain("stand-up");
  });

  it("rejects malformed history before anything is committed", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createRecordingModel();
    const agent = logAgent(model, store);
    const cases: unknown[] = [
      { entries: "nope" },
      { entries: [{ key: "", message: { role: "user", content: "x" } }] },
      {
        entries: [
          { key: "a", message: { role: "user", content: "x" } },
          { key: "a", message: { role: "user", content: "y" } },
        ],
      },
      { entries: [{ key: "a", message: { role: "system", content: "x" } }] },
      { root: { reason: "initial" }, entries: [] },
    ];
    for (const contextHistory of cases) {
      await expect(
        agent.generate({
          prompt: "Hi",
          threadId: THREAD,
          contextHistory: contextHistory as ContextHistoryInput,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await store.readHead(MAIN)).toBeNull();
  });

  it("refuses contextHistory outside log mode", async () => {
    const { model } = createRecordingModel();
    await expect(
      createAgent({ model }).generate({ prompt: "Hi", contextHistory: legacyHistory }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });
});

describe("log-mode appended history", () => {
  const voice: ContextHistoryInput = {
    entries: [
      {
        key: "outside:event-7",
        message: { role: "user", content: "Move Monday to Tuesday." },
        metadata: { eventId: "event-7" },
      },
      {
        key: "outside:event-8",
        message: { role: "assistant", content: "Moved." },
        metadata: { eventId: "event-8" },
      },
    ],
  };

  it("appends history after the head's path and before the run's input", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createRecordingModel();
    const agent = logAgent(model, store);
    await agent.generate({ prompt: "Plan my week.", threadId: THREAD });
    const before = await readAll(store);

    await agent.generate({ prompt: "Recap.", threadId: THREAD, contextHistory: voice });

    const after = await readAll(store);
    // A pure append: the earlier path is unchanged and the same version.
    expect(after.head.versionId).toBe(before.head.versionId);
    expect(after.entries.slice(0, before.entries.length)).toEqual(before.entries);
    expect(after.entries.slice(before.entries.length).map((entry) => entry.key)).toEqual([
      "outside:event-7",
      "outside:event-8",
      expect.stringMatching(/^user:/),
      expect.stringMatching(/^output:/),
    ]);
    expect(after.entries[before.entries.length]!.metadata).toEqual({ eventId: "event-7" });
    const prompt = requests.at(-1)!.prompt;
    expect(prompt.slice(-3)).toEqual([
      text("user", "Move Monday to Tuesday."),
      text("assistant", "Moved."),
      text("user", "Recap."),
    ]);
  });

  it("never appends an entry twice across repeated runs, and sends identical bytes", async () => {
    const store = new MemoryContextLogStore();
    const { model, requests } = createRecordingModel();
    const agent = logAgent(model, store);
    await agent.generate({ prompt: "Plan my week.", threadId: THREAD });
    await agent.generate({ prompt: "Recap.", threadId: THREAD, contextHistory: voice });
    const once = await readAll(store);
    // The next run reads the same outside events again.
    await agent.generate({ prompt: "Thanks.", threadId: THREAD, contextHistory: voice });
    const twice = await readAll(store);
    expect(twice.entries.filter((entry) => entry.key.startsWith("outside:"))).toHaveLength(2);
    expect(twice.entries.slice(0, once.entries.length)).toEqual(once.entries);
    // The second run's request extends the first's byte for byte.
    const [, first, second] = requests;
    expect(
      JSON.stringify(second!.prompt).startsWith(JSON.stringify(first!.prompt).slice(0, -1)),
    ).toBe(true);
  });

  it("re-plans identical history after an uncertain first prepare", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createRecordingModel();
    const prepared: string[] = [];
    let failures = 1;
    const flaky: ContextLogStore = Object.assign(Object.create(store), {
      prepare: async (request: Parameters<ContextLogStore["prepare"]>[0]) => {
        prepared.push(JSON.stringify(request.append));
        if (failures-- > 0) {
          const { ContextLogUnavailableError } = await import("../../src/index.js");
          throw new ContextLogUnavailableError("flaky");
        }
        return store.prepare(request);
      },
    });
    await logAgent(model, flaky).generate({
      prompt: "Hi",
      threadId: THREAD,
      contextHistory: voice,
    });
    expect(prepared.length).toBeGreaterThanOrEqual(2);
    expect(new Set(prepared).size).toBe(1);
    const { entries } = await readAll(store);
    expect(entries.filter((entry) => entry.key.startsWith("outside:"))).toHaveLength(2);
  });
});
