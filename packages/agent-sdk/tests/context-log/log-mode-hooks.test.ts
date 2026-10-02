import { generateText, type ModelMessage, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { wrapToolsWithHooks } from "../../src/agent/tool-pipeline.js";
import {
  createLogModeRetryGuard,
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
  type GenerateOptions,
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
  fingerprintSecret: string | null = "host-secret",
) {
  const head = await store.readHead(stream);
  const path = await readFullPath(store, head);
  const produced = await runContextProducers({
    producers: [
      createSlotContextProducer({
        name: "settings",
        ...(fingerprintSecret === null ? {} : { fingerprintSecret }),
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
    expect(committed.map((entry) => entry.key)).toEqual([
      "u1",
      expect.stringMatching(/^ctx:settings:slot:notes:1:[0-9a-f]{32}$/),
      "u2",
    ]);
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

  it("rejects a hook that changes providerOptions, which can carry model input", async () => {
    expect(
      await violation(
        run(
          rewriting((options) => ({
            ...options,
            providerOptions: { openai: { instructions: "replace the system prompt" } },
          })),
        ),
      ),
    ).toMatch(/changed "providerOptions"/);
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

describe("log-mode PreGenerate: hooks compose instead of racing", () => {
  const maxTokens = rewriting((options) => ({ ...options, maxTokens: 64 }));

  it("keeps the secrets filter's redaction when an operational hook also returns an update", async () => {
    const [secrets] = createSecretsFilterHooks();
    for (const hooks of [
      [maxTokens, secrets],
      [secrets, maxTokens],
    ]) {
      const result = await invokeLogModePreGenerateHooks({
        hooks,
        options: { threadId: "t1" },
        pending: [user("u1", `key ${AWS_KEY}`)],
        agent: agent(),
      });
      expect(result.pending).toEqual([user("u1", "key [REDACTED]")]);
      expect(result.options).toEqual({ threadId: "t1", maxTokens: 64 });
    }
  });

  it("keeps a guardrail transform and lets later hooks see it", async () => {
    const [guardrail] = createGuardrailsHooks({
      checkInput: (input) => ({
        ...input,
        options: {
          ...input.options,
          messages: input.options.messages?.map((message) => ({
            ...message,
            content: String(message.content).replace("555-1234", "[PHONE]"),
          })) as ModelMessage[],
        },
      }),
    });
    const seen: unknown[] = [];
    const spy: HookCallback = (input) => {
      seen.push((input as PreGenerateInput).options.messages);
      return undefined;
    };
    const result = await invokeLogModePreGenerateHooks({
      hooks: [maxTokens, guardrail, spy],
      options: {},
      pending: [user("u1", "call 555-1234")],
      agent: agent(),
    });
    expect(result.pending).toEqual([user("u1", "call [PHONE]")]);
    expect(seen).toEqual([[{ role: "user", content: "call [PHONE]" }]]);
    expect(result.options).toEqual({ maxTokens: 64 });
  });

  it("stops at any hook's denial", async () => {
    const [guard] = createGuardrailsHooks({ blockedInputPatterns: [/forbidden/] });
    await expect(
      invokeLogModePreGenerateHooks({
        hooks: [maxTokens, guard],
        options: {},
        pending: [user("u1", "forbidden")],
        agent: agent(),
      }),
    ).rejects.toBeInstanceOf(GeneratePermissionDeniedError);
  });
});

describe("log-mode PreGenerate: new tool calls and results are screened", () => {
  const assistantCall: ContextEntryInput = {
    kind: "assistant",
    key: "a1",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Reading the config." },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "read",
          input: { path: `/keys/${AWS_KEY}` },
        },
      ],
    },
  };
  const textResult: ContextEntryInput = {
    kind: "tool_result",
    key: "t1",
    message: {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "read",
          output: { type: "text", value: `aws_access_key_id = ${AWS_KEY}` },
        },
      ],
    },
  };
  const jsonResult: ContextEntryInput = {
    kind: "tool_result",
    key: "t2",
    message: {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-2",
          toolName: "env",
          output: { type: "json", value: { env: [{ type: "AWS", value: AWS_KEY }], count: 1 } },
        },
        {
          type: "tool-result",
          toolCallId: "call-3",
          toolName: "shot",
          output: {
            type: "content",
            value: [
              { type: "text", text: `caption ${AWS_KEY}` },
              { type: "file-data", data: "aGVsbG8=", mediaType: "image/png" },
            ],
          },
        },
      ],
    },
  };

  it("redacts text and JSON tool results and tool call input before commit, keeping ids and structure", async () => {
    const store = new MemoryContextLogStore();
    const [secrets] = createSecretsFilterHooks();
    const { pending } = await invokeLogModePreGenerateHooks({
      hooks: [secrets],
      options: {},
      pending: [assistantCall, textResult, jsonResult],
      agent: agent(),
    });
    await store.prepare({
      stream,
      expectedRevision: 0,
      idempotencyKey: "1",
      transition: { reason: "initial", parent: null, core: "c", contract: {} },
      append: pending,
      manifest,
    });
    const committed = await readFullPath(store, await store.readHead(stream));

    expect(JSON.stringify(committed)).not.toContain(AWS_KEY);
    const redact = (value: string) => value.replaceAll(AWS_KEY, "[REDACTED]");
    const expected = [assistantCall, textResult, jsonResult].map((entry) =>
      JSON.parse(redact(JSON.stringify(entry))),
    );
    expect(
      committed.map(({ position, versionId, manifestId, createdAt, ...entry }) => entry),
    ).toEqual(expected);
  });

  it("guardrails deny blocked text in a new tool result", async () => {
    const [guard] = createGuardrailsHooks({ blockedInputPatterns: [/aws_access_key_id/] });
    await expect(
      invokeLogModePreGenerateHooks({
        hooks: [guard],
        options: {},
        pending: [textResult],
        agent: agent(),
      }),
    ).rejects.toBeInstanceOf(GeneratePermissionDeniedError);
  });

  it("guardrails deny blocked text inside a JSON tool result or tool call input", async () => {
    const [guard] = createGuardrailsHooks({ blockedInputPatterns: [/AKIA/] });
    for (const entry of [jsonResult, assistantCall]) {
      await expect(
        invokeLogModePreGenerateHooks({
          hooks: [guard],
          options: {},
          pending: [entry],
          agent: agent(),
        }),
      ).rejects.toBeInstanceOf(GeneratePermissionDeniedError);
    }
  });

  it("rejects a hook that reshapes a tool result's text view", async () => {
    const reshape = rewriting((options) => ({
      ...options,
      messages: [{ role: "tool", content: [{ type: "text", text: "merged" }] }],
    }));
    expect(
      await violation(
        invokeLogModePreGenerateHooks({
          hooks: [reshape],
          options: {},
          pending: [jsonResult],
          agent: agent(),
        }),
      ),
    ).toMatch(/changed the shape of new input/);
  });
});

describe("log-mode PreGenerate: object keys and numbers in data are screened", () => {
  const runtime = (payload: unknown): ContextEntryInput => ({
    kind: "runtime_context",
    key: "r",
    producer: "p",
    payload: payload as null,
  });
  const jsonTool = (value: unknown): ContextEntryInput => ({
    kind: "tool_result",
    key: "t",
    message: {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "env",
          output: { type: "json", value: value as null },
        },
      ],
    },
  });

  async function screen(hooks: HookCallback[], pending: ContextEntryInput[]) {
    return invokeLogModePreGenerateHooks({ hooks, options: {}, pending, agent: agent() });
  }

  it("redacts a secret that is only an object key, keeping key order and values", async () => {
    const [secrets] = createSecretsFilterHooks();
    const { pending } = await screen([secrets], [runtime({ first: 1, [AWS_KEY]: 2, last: 3 })]);
    const payload = (pending[0] as { payload: Record<string, number> }).payload;
    expect(Object.entries(payload)).toEqual([
      ["first", 1],
      ["[REDACTED]", 2],
      ["last", 3],
    ]);
  });

  it("redacts nested keys in JSON tool results and runtime context, with values under them", async () => {
    const [secrets] = createSecretsFilterHooks();
    const { pending } = await screen(
      [secrets],
      [
        jsonTool({ env: { [AWS_KEY]: { note: `copy of ${AWS_KEY}` } } }),
        runtime([{ deep: { [AWS_KEY]: true } }]),
      ],
    );
    expect(JSON.stringify(pending)).not.toContain(AWS_KEY);
    expect(pending[0]).toMatchObject({
      message: {
        content: [
          {
            toolCallId: "call-1",
            output: {
              type: "json",
              value: { env: { "[REDACTED]": { note: "copy of [REDACTED]" } } },
            },
          },
        ],
      },
    });
    expect(pending[1]).toMatchObject({ payload: [{ deep: { "[REDACTED]": true } }] });
  });

  it("guardrails deny a blocked key", async () => {
    const [guard] = createGuardrailsHooks({ blockedInputPatterns: [/AKIA[0-9A-Z]{16}/] });
    for (const entry of [runtime({ [AWS_KEY]: 1 }), jsonTool({ a: { [AWS_KEY]: null } })]) {
      await expect(screen([guard], [entry])).rejects.toBeInstanceOf(GeneratePermissionDeniedError);
    }
  });

  it("rejects a redaction that would merge two fields", async () => {
    const [secrets] = createSecretsFilterHooks();
    expect(
      await violation(screen([secrets], [runtime({ [AWS_KEY]: 1, "[REDACTED]": 2 })])),
    ).toMatch(/would merge two fields/);
  });

  it("screens numbers as their decimal text and writes a changed number back as a string", async () => {
    const [secrets] = createSecretsFilterHooks({ patterns: [/\b4111\d{12}\b/g] });
    const { pending } = await screen([secrets], [runtime({ card: 4111111111111111, count: 2 })]);
    expect(pending[0]).toMatchObject({ payload: { card: "[REDACTED]", count: 2 } });

    const [guard] = createGuardrailsHooks({ blockedInputPatterns: [/^1234$/m] });
    await expect(screen([guard], [jsonTool({ pin: 1234 })])).rejects.toBeInstanceOf(
      GeneratePermissionDeniedError,
    );
  });
});

describe("log-mode PreGenerate: options are isolated from hooks", () => {
  it("catches nested in-place changes to provider options", async () => {
    const options: GenerateOptions = { providerOptions: { openai: { instructions: "original" } } };
    const nested: HookCallback = (input) => {
      const view = (input as PreGenerateInput).options;
      view.providerOptions.openai.instructions = "injected";
      return { hookSpecificOutput: { hookEventName: "PreGenerate", updatedInput: { ...view } } };
    };
    expect(
      await violation(
        invokeLogModePreGenerateHooks({
          hooks: [nested],
          options,
          pending: [user("u1", "x")],
          agent: agent(),
        }),
      ),
    ).toMatch(/changed "providerOptions"/);
    expect(options.providerOptions.openai.instructions).toBe("original");
  });

  it("withholds options that are not plain JSON and restores them unchanged", async () => {
    const output = { schema: { parse: () => "x" } } as unknown as GenerateOptions["output"];
    const seen: unknown[] = [];
    const spy: HookCallback = (input) => {
      seen.push("output" in (input as PreGenerateInput).options);
      return undefined;
    };
    const result = await invokeLogModePreGenerateHooks({
      hooks: [spy],
      options: { output },
      pending: [user("u1", "x")],
      agent: agent(),
    });
    expect(seen).toEqual([false]);
    expect(result.options.output).toBe(output);

    const replace = rewriting((view) => ({ ...view, output: {} }));
    expect(
      await violation(
        invokeLogModePreGenerateHooks({
          hooks: [replace],
          options: { output },
          pending: [],
          agent: agent(),
        }),
      ),
    ).toMatch(/changed "output"/);
  });
});

describe("log-mode producers with input filters", () => {
  it("does not re-append an unchanged slot whose committed payload was redacted", async () => {
    const store = new MemoryContextLogStore();
    const [secrets] = createSecretsFilterHooks();
    const first = await prepareTurn(store, [secrets], [user("u1", "one")], "1");
    expect(JSON.stringify(first.committed)).not.toContain(AWS_KEY);
    const second = await prepareTurn(store, [secrets], [user("u2", "two")], "2");
    const third = await prepareTurn(store, [secrets], [user("u3", "three")], "3");
    expect(second.committed.length - first.committed.length).toBe(1);
    expect(third.committed.map((entry) => entry.kind)).toEqual([
      "user",
      "runtime_context",
      "user",
      "user",
    ]);
  });

  it("persists only a keyed fingerprint, and none without a host secret", async () => {
    const [secrets] = createSecretsFilterHooks();
    const keyed = await prepareTurn(new MemoryContextLogStore(), [secrets], [user("u1", "x")], "1");
    const otherSecret = await prepareTurn(
      new MemoryContextLogStore(),
      [secrets],
      [user("u1", "x")],
      "1",
      "another-secret",
    );
    const keyOf = (committed: ContextEntry[]) =>
      committed.find((entry) => entry.kind === "runtime_context")?.key;
    expect(keyOf(keyed.committed)).toMatch(/^ctx:settings:slot:notes:1:[0-9a-f]{32}$/);
    // Keyed: the same source under another secret has an unrelated fingerprint.
    expect(keyOf(otherSecret.committed)).not.toBe(keyOf(keyed.committed));

    // Without a secret, nothing derived from the unredacted source is persisted,
    // and a redacted slot is compared by its committed payload, so it is
    // appended again.
    const store = new MemoryContextLogStore();
    const first = await prepareTurn(store, [secrets], [user("u1", "x")], "1", null);
    expect(keyOf(first.committed)).toBe("ctx:settings:slot:notes:1:-");
    const second = await prepareTurn(store, [secrets], [user("u2", "y")], "2", null);
    expect(second.committed.filter((entry) => entry.kind === "runtime_context")).toHaveLength(2);
  });
});

describe("log-mode retries", () => {
  function retry(
    previous: GenerateOptions,
    hook: (options: GenerateOptions) => GenerateOptions | undefined,
  ) {
    const guard = createLogModeRetryGuard(previous);
    return guard.accept(hook(guard.options));
  }

  it("accepts a retry hook that spreads the previous options, input included", () => {
    const previous = {
      threadId: "t",
      prompt: "p",
      messages: [{ role: "user" as const, content: "hello" }],
    };
    const next = retry(previous, (options) => ({ ...options, maxTokens: 10 }));
    expect(next).toEqual({ ...previous, maxTokens: 10 });
    // The attempt's own input is kept, not the hook's copy.
    expect(next.messages).toBe(previous.messages);
    expect(() =>
      retry(previous, (options) => ({
        ...options,
        messages: [{ role: "user", content: "changed" }],
      })),
    ).toThrow(/changed "messages"/);
  });

  it("lets a PostGenerateFailure hook change operational options only", () => {
    expect(retry({ threadId: "t" }, (options) => ({ ...options, maxTokens: 10 }))).toEqual({
      threadId: "t",
      maxTokens: 10,
    });
    for (const change of [
      { messages: [{ role: "user" as const, content: "retry with this" }] },
      { prompt: "again" },
      { instructionLayers: [{ label: "x", instructions: "y" }] },
      { providerOptions: { openai: { instructions: "new system" } } },
    ]) {
      const error = (() => {
        try {
          retry({ threadId: "t" }, (options) => ({ ...options, ...change }));
        } catch (caught) {
          return caught;
        }
      })();
      expect(isContextLogError(error, "invalid")).toBe(true);
      expect((error as Error).message).toMatch(/^PostGenerateFailure hook/);
    }
  });

  it("catches provider input changed in place, before or without a returned update", () => {
    const previous: GenerateOptions = {
      threadId: "t",
      providerOptions: { openai: { instructions: "original" } },
    };
    const mutate = (options: GenerateOptions) => {
      options.providerOptions.openai.instructions = "injected";
    };
    // Mutated in place and returned as a shallow spread.
    expect(() =>
      retry(previous, (options) => {
        mutate(options);
        return { ...options };
      }),
    ).toThrow(/changed "providerOptions"/);
    // Mutated in place only.
    expect(() =>
      retry(previous, (options) => {
        mutate(options);
        return undefined;
      }),
    ).toThrow(/changed "providerOptions"/);
    // The attempt's own options are never handed to the hooks.
    expect(previous.providerOptions.openai.instructions).toBe("original");
  });

  it("withholds options that are not plain JSON and restores them", () => {
    const output = { schema: { parse: () => "x" } } as unknown as GenerateOptions["output"];
    const guard = createLogModeRetryGuard({ threadId: "t", output });
    expect(guard.options).not.toHaveProperty("output");
    expect(guard.accept({ ...guard.options, maxTokens: 3 })).toEqual({
      threadId: "t",
      output,
      maxTokens: 3,
    });
    expect(() =>
      guard.accept({ ...guard.options, output: {} as GenerateOptions["output"] }),
    ).toThrow(/changed "output"/);
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
