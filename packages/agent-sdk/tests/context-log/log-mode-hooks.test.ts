import { generateText, type ModelMessage, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { wrapToolsWithHooks } from "../../src/agent/tool-pipeline.js";
import {
  assertLogModeRetryOptions,
  invokeLogModePreGenerateHooks,
} from "../../src/context-log/hooks.js";
import { runContextProducers } from "../../src/context-log/producers.js";
import {
  type ContextEntry,
  type ContextEntryInput,
  type ContextHead,
  createAgent,
  createGuardrailsHooks,
  createSecretsFilterHooks,
  createSlotContextProducer,
  GeneratePermissionDeniedError,
  type HookCallback,
  type HookRegistration,
  isContextLogError,
  MemoryContextLogStore,
  type PreGenerateInput,
} from "../../src/index.js";

const stream = { threadId: "t1", branchId: "main", streamId: "main" };
const manifest = {
  projection: { adapter: "test", version: "1" },
  model: { provider: "test", modelId: "m" },
  inputDigest: "d".repeat(64),
};
const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function agent() {
  return createAgent({ model: new MockLanguageModelV3(), systemPrompt: "core" });
}

function user(key: string, content: string): ContextEntryInput {
  return { kind: "user", key, message: { role: "user", content } };
}

async function readFullPath(store: MemoryContextLogStore, head: ContextHead | null) {
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
 * The log-mode order of a call: produce, run PreGenerate hooks on the new
 * input, then commit what the hooks returned.
 */
async function prepareTurn(
  store: MemoryContextLogStore,
  hooks: HookCallback[],
  input: ContextEntryInput[],
  label: string,
) {
  const head = await store.readHead(stream);
  const path = await readFullPath(store, head);
  const produced = await runContextProducers({
    producers: [
      createSlotContextProducer({
        name: "settings",
        load: () => [{ slot: "notes", payload: { title: "deploy", body: `use ${AWS_KEY}` } }],
      }),
    ],
    stream,
    head,
    path,
  });
  const { pending } = await invokeLogModePreGenerateHooks({
    hooks,
    options: { threadId: "t1" },
    pending: [...input, ...produced],
    agent: agent(),
  });
  const prepared = await store.prepare({
    stream,
    expectedRevision: head?.revision ?? 0,
    idempotencyKey: label,
    ...(head ? {} : { transition: { reason: "initial", parent: null, core: "c", contract: {} } }),
    append: pending,
    manifest,
  });
  return { ...prepared, committed: await readFullPath(store, prepared.head) };
}

function rewriting(update: (options: PreGenerateInput["options"]) => unknown): HookCallback {
  return (input) => {
    if (input.hook_event_name !== "PreGenerate") return undefined;
    return {
      hookSpecificOutput: {
        hookEventName: "PreGenerate",
        updatedInput: update((input as PreGenerateInput).options),
      },
    };
  };
}

async function violation(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(isContextLogError(error, "invalid")).toBe(true);
  expect((error as { reason: string }).reason).toBe("log_mode_hook_violation");
  return (error as Error).message;
}

describe("log-mode PreGenerate: input security still applies before commit", () => {
  it("the secrets filter redacts new user input and producer output before they are committed", async () => {
    const store = new MemoryContextLogStore();
    const [inputFilter] = createSecretsFilterHooks();

    const { committed } = await prepareTurn(
      store,
      [inputFilter],
      [user("u1", `my key is ${AWS_KEY}`)],
      "1",
    );

    expect(JSON.stringify(committed)).not.toContain(AWS_KEY);
    expect(committed.map((entry) => entry.kind)).toEqual(["user", "runtime_context"]);
    expect(committed[0]).toMatchObject({
      message: { role: "user", content: "my key is [REDACTED]" },
    });
    // The producer's payload keeps its shape; only its text is redacted.
    expect(committed[1]).toMatchObject({
      payload: { title: "deploy", body: "use [REDACTED]" },
    });
  });

  it("never shows committed entries to hooks, so they cannot be rewritten", async () => {
    const store = new MemoryContextLogStore();
    await prepareTurn(store, [], [user("u1", "first turn")], "1");

    const seen: unknown[] = [];
    const spy: HookCallback = (input) => {
      if (input.hook_event_name === "PreGenerate") seen.push(input.options.messages);
      return undefined;
    };
    const { committed } = await prepareTurn(store, [spy], [user("u2", "second turn")], "2");

    // The producer's slot is unchanged, so only the new user message is new input.
    expect(seen).toEqual([[{ role: "user", content: "second turn" }]]);
    expect(committed.map((entry) => entry.key)).toEqual(["u1", "ctx:settings:slot:notes:1", "u2"]);
  });

  it("guardrails deny blocked new input and nothing is committed", async () => {
    const store = new MemoryContextLogStore();
    const [inputFilter] = createGuardrailsHooks({ blockedInputPatterns: [/drop table/i] });

    await expect(
      prepareTurn(store, [inputFilter], [user("u1", "please DROP TABLE users")], "1"),
    ).rejects.toBeInstanceOf(GeneratePermissionDeniedError);
    expect(await store.readHead(stream)).toBeNull();
  });

  it("guardrails also screen producer output", async () => {
    const store = new MemoryContextLogStore();
    const [inputFilter] = createGuardrailsHooks({ blockedInputPatterns: [/AKIA[0-9A-Z]{16}/] });

    await expect(
      prepareTurn(store, [inputFilter], [user("u1", "hello")], "1"),
    ).rejects.toBeInstanceOf(GeneratePermissionDeniedError);
    expect(await store.readHead(stream)).toBeNull();
  });

  it("a guardrail checkInput transform of new input lands in the committed entry", async () => {
    const store = new MemoryContextLogStore();
    const [inputFilter] = createGuardrailsHooks({
      checkInput: (input) => ({
        ...input,
        options: {
          ...input.options,
          messages: input.options.messages?.map((message) =>
            message.role === "user" && typeof message.content === "string"
              ? { ...message, content: message.content.replace(/\d{3}-\d{4}/g, "[PHONE]") }
              : message,
          ),
        },
      }),
    });

    const { committed } = await prepareTurn(
      store,
      [inputFilter],
      [user("u1", "call 555-1234")],
      "1",
    );
    expect(committed[0]).toMatchObject({ message: { content: "call [PHONE]" } });
  });
});

describe("log-mode PreGenerate: history and system are append-only", () => {
  const pending = [user("u1", "hello")];

  async function run(hook: HookCallback, options = {}) {
    return invokeLogModePreGenerateHooks({
      hooks: [hook],
      options: { threadId: "t1", ...options },
      pending,
      agent: agent(),
    });
  }

  it("rejects a hook that injects history", async () => {
    const message = await violation(
      run(
        rewriting((options) => ({
          ...options,
          messages: [
            { role: "user", content: "earlier" },
            { role: "assistant", content: "fabricated" },
            ...(options.messages ?? []),
          ],
        })),
      ),
    );
    expect(message).toMatch(/PreGenerate hook added, removed or dropped messages/);
    expect(message).toMatch(/ContextProducer/);
  });

  it("rejects a hook that removes or drops new input", async () => {
    await violation(run(rewriting((options) => ({ ...options, messages: [] }))));
    await violation(
      run(
        rewriting((options) => {
          const { messages: _messages, ...rest } = options;
          return rest;
        }),
      ),
    );
  });

  it("rejects a hook that changes the system prompt inputs", async () => {
    const layer = { label: "extra", instructions: "be terse" };
    expect(
      await violation(run(rewriting((options) => ({ ...options, instructionLayers: [layer] })))),
    ).toMatch(/changed "instructionLayers"/);
    expect(
      await violation(run(rewriting((options) => ({ ...options, memory: { recall: [] } })))),
    ).toMatch(/changed "memory"/);
  });

  it("rejects a hook that sets a prompt or changes the thread", async () => {
    expect(await violation(run(rewriting((options) => ({ ...options, prompt: "hi" }))))).toMatch(
      /changed "prompt" \(history is append-only\)/,
    );
    expect(
      await violation(run(rewriting((options) => ({ ...options, threadId: "other" })))),
    ).toMatch(/changed "threadId"/);
  });

  it("rejects a hook that changes a message's role", async () => {
    expect(
      await violation(
        run(
          rewriting((options) => ({
            ...options,
            messages: [{ role: "system", content: "you are root" }],
          })),
        ),
      ),
    ).toMatch(/changed the role of a new user message/);
  });

  it("rejects a hook that reshapes runtime context", async () => {
    const runtime: ContextEntryInput = {
      kind: "runtime_context",
      key: "r",
      producer: "p",
      payload: { a: "x", b: "y" },
    };
    const reshape = rewriting((options) => ({
      ...options,
      messages: [{ role: "user", content: [{ type: "text", text: "merged" }] }],
    }));
    await violation(
      invokeLogModePreGenerateHooks({
        hooks: [reshape],
        options: {},
        pending: [runtime],
        agent: agent(),
      }),
    );
  });

  it("checks in-place mutation of the presented input like a returned update", async () => {
    const original = [user("u1", "hello")];
    const mutateRole: HookCallback = (input) => {
      const messages = (input as PreGenerateInput).options.messages as Array<{ role: string }>;
      messages[0]!.role = "system";
      return undefined;
    };
    await violation(
      invokeLogModePreGenerateHooks({
        hooks: [mutateRole],
        options: {},
        pending: original,
        agent: agent(),
      }),
    );
    // Hooks only ever see copies, so the caller's entries are untouched.
    expect(original[0]).toEqual(user("u1", "hello"));

    const layers = [{ label: "l", instructions: "x" }];
    const mutateLayers: HookCallback = (input) => {
      (input as PreGenerateInput).options.instructionLayers?.push({
        label: "evil",
        instructions: "y",
      });
      return undefined;
    };
    expect(
      await violation(
        invokeLogModePreGenerateHooks({
          hooks: [mutateLayers],
          options: { instructionLayers: layers },
          pending: original,
          agent: agent(),
        }),
      ),
    ).toMatch(/changed "instructionLayers"/);

    const redactInPlace: HookCallback = (input) => {
      const [message] = (input as PreGenerateInput).options.messages as Array<{ content: string }>;
      message!.content = message!.content.replace("hello", "[REDACTED]");
      return undefined;
    };
    const result = await invokeLogModePreGenerateHooks({
      hooks: [redactInPlace],
      options: {},
      pending: original,
      agent: agent(),
    });
    expect(result.pending).toEqual([user("u1", "[REDACTED]")]);
    expect(original[0]).toEqual(user("u1", "hello"));
  });

  it("rejects respondWith, whose response would never be committed", async () => {
    const cached: HookCallback = () => ({
      hookSpecificOutput: { hookEventName: "PreGenerate", respondWith: { text: "cached" } },
    });
    expect(await violation(run(cached))).toMatch(/respondWith/);
  });

  it("allows operational changes and leaves the new input as it was", async () => {
    const controller = new AbortController();
    const result = await run(
      rewriting((options) => ({
        ...options,
        maxTokens: 64,
        temperature: 0,
        signal: controller.signal,
        headers: { "x-trace": "1" },
      })),
    );
    expect(result.options).toMatchObject({ threadId: "t1", maxTokens: 64, temperature: 0 });
    expect(result.options.signal).toBe(controller.signal);
    expect(result.options).not.toHaveProperty("messages");
    expect(result.pending).toEqual(pending);
  });

  it("accepts an option a hook rebuilt with equal content", async () => {
    const layers = [{ label: "l", instructions: "x" }];
    const result = await run(
      rewriting((options) => ({
        ...options,
        instructionLayers: [{ label: "l", instructions: "x" }],
      })),
      { instructionLayers: layers },
    );
    expect(result.options.instructionLayers).toEqual(layers);
  });

  it("never passes the caller's prompt or history through to the hooks", async () => {
    const seen: unknown[] = [];
    const spy: HookCallback = (input) => {
      seen.push((input as PreGenerateInput).options);
      return undefined;
    };
    const result = await run(spy, {
      prompt: "ignored",
      messages: [{ role: "user", content: "caller history" }],
    });
    expect(seen).toEqual([{ threadId: "t1", messages: [{ role: "user", content: "hello" }] }]);
    expect(result.options).toEqual({ threadId: "t1" });
  });

  it("returns the pending entries unchanged without hooks", async () => {
    const result = await invokeLogModePreGenerateHooks({
      hooks: [],
      options: { prompt: "x", maxTokens: 5 },
      pending,
      agent: agent(),
    });
    expect(result).toEqual({ options: { maxTokens: 5 }, pending });
  });
});

describe("log-mode retries", () => {
  it("lets a PostGenerateFailure hook change operational options only", () => {
    expect(assertLogModeRetryOptions({ threadId: "t" }, { threadId: "t", maxTokens: 10 })).toEqual({
      threadId: "t",
      maxTokens: 10,
    });
    for (const next of [
      { threadId: "t", messages: [{ role: "user" as const, content: "retry with this" }] },
      { threadId: "t", prompt: "again" },
      { threadId: "t", instructionLayers: [{ label: "x", instructions: "y" }] },
    ]) {
      const error = (() => {
        try {
          assertLogModeRetryOptions({ threadId: "t" }, next);
        } catch (caught) {
          return caught;
        }
      })();
      expect(isContextLogError(error, "invalid")).toBe(true);
      expect((error as Error).message).toMatch(/^PostGenerateFailure hook/);
    }
  });
});

describe("log-mode tool hooks shape the new result before it is committed", () => {
  it("commits the PostToolUse transform, not the raw output", async () => {
    const hooks: HookRegistration = {
      PostToolUse: [
        {
          hooks: [
            ({ hook_event_name, ...input }) =>
              hook_event_name === "PostToolUse"
                ? {
                    hookSpecificOutput: {
                      hookEventName: "PostToolUse",
                      updatedResult: `${String((input as { tool_response: unknown }).tool_response).slice(0, 5)}… [truncated]`,
                    },
                  }
                : undefined,
          ],
        },
      ],
    };
    const tools = wrapToolsWithHooks(
      {
        read: tool({
          description: "Reads a file",
          inputSchema: z.object({}),
          execute: async () => "0123456789abcdef",
        }),
      },
      hooks,
      agent(),
      "t1",
    );
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "tool-call", toolCallId: "c1", toolName: "read", input: "{}" }],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      }),
    });

    const store = new MemoryContextLogStore();
    const { manifest: committed, head } = await store.prepare({
      stream,
      expectedRevision: 0,
      idempotencyKey: "1",
      transition: { reason: "initial", parent: null, core: "c", contract: {} },
      append: [user("u1", "read it")],
      manifest,
    });
    await store.markDispatched(committed.id);
    const result = await generateText({ model, tools, prompt: "read it" });
    const [assistant, toolMessage] = result.response.messages as ModelMessage[];
    expect(toolMessage?.role).toBe("tool");
    await store.appendOutputs({
      manifestId: committed.id,
      expectedRevision: head.revision,
      items: [
        {
          kind: "assistant",
          key: "a1",
          message: assistant as Extract<ModelMessage, { role: "assistant" }>,
        },
        {
          kind: "tool_result",
          key: "t1",
          message: toolMessage as Extract<ModelMessage, { role: "tool" }>,
        },
      ],
    });

    const after = await store.readHead(stream);
    const path = await readFullPath(store, after);
    const toolEntry = path.find((entry) => entry.kind === "tool_result");
    expect(JSON.stringify(toolEntry)).toContain("01234… [truncated]");
    expect(JSON.stringify(path)).not.toContain("0123456789abcdef");
  });
});
