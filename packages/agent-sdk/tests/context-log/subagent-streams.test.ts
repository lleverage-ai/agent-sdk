/**
 * In log mode a delegated subagent runs on its own stream in the parent's
 * store. A finished child stream is read back as the tool result; a child
 * stream that stopped mid-task fails with `delegation_recovery_required` and
 * is never replayed.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3Prompt,
} from "@ai-sdk/provider";
import { jsonSchema, type LanguageModel, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { MemorySaver } from "../../src/checkpointer/memory-saver.js";
import {
  type Agent,
  type AgentOptions,
  type ContextEntry,
  type ContextLogStore,
  type ContextStreamRef,
  createAgent,
  DelegationRecoveryRequiredError,
  deriveSubagentContextStream,
  isContextLogError,
  MemoryContextLogStore,
  readSubagentDelegation,
  type SubagentCreateContext,
  type SubagentDefinition,
} from "../../src/index.js";

const THREAD = "thread-1";
const MAIN: ContextStreamRef = { threadId: THREAD, branchId: "main", streamId: "main" };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

type Reply = LanguageModelV3Content[] | (() => never);

const text = (value: string): LanguageModelV3Content[] => [{ type: "text", text: value }];
const call = (toolCallId: string, toolName: string, input: object): LanguageModelV3Content[] => [
  { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
];
const delegate = (toolCallId: string, description = "Research the topic") =>
  call(toolCallId, "task", { description, subagent_type: "researcher" });

/** A model that answers each call with the next scripted reply and records every request. */
function scriptedModel(replies: Reply[], modelId = "mock-model") {
  const requests: LanguageModelV3CallOptions[] = [];
  const model = new MockLanguageModelV3({
    modelId,
    provider: "mock-provider",
    doGenerate: async (request) => {
      const index = requests.length;
      requests.push(request);
      const reply = replies[Math.min(index, replies.length - 1)]!;
      if (typeof reply === "function") reply();
      const content = reply as LanguageModelV3Content[];
      return {
        content,
        finishReason: content.some((part) => part.type === "tool-call")
          ? { unified: "tool-calls" as const, raw: "tool_calls" }
          : { unified: "stop" as const, raw: "stop" },
        usage,
        warnings: [],
      };
    },
  });
  return { model: model as LanguageModel, requests };
}

const echo = tool({
  description: "Echoes its input",
  inputSchema: jsonSchema<{ value: string }>({
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  }),
  execute: async ({ value }) => `echo:${value}`,
});

async function readPath(store: ContextLogStore, stream: ContextStreamRef): Promise<ContextEntry[]> {
  const head = await store.readHead(stream);
  if (!head) return [];
  return (await store.readPath(head, { limit: 1000 })).entries;
}

/** Text a prompt carries, for asserting what a model was sent. */
const promptText = (prompt: LanguageModelV3Prompt): string => JSON.stringify(prompt);

const childStreamFor = (toolCallId: string, parent = MAIN) =>
  deriveSubagentContextStream({ parent, toolCallId, subagentType: "researcher" });

/**
 * A researcher subagent whose factory records its context and builds a
 * log-mode child on the delegation's store.
 */
function researcher(
  childModel: LanguageModel,
  overrides: Partial<AgentOptions> = {},
  wrap: (agent: Agent) => Agent = (agent) => agent,
) {
  const contexts: SubagentCreateContext[] = [];
  const definition: SubagentDefinition = {
    type: "researcher",
    description: "Researches topics",
    create: (ctx) => {
      contexts.push(ctx);
      return wrap(
        createAgent({
          model: childModel,
          systemPrompt: "You are the researcher.",
          ...(ctx.contextLog && {
            contextLog: { mode: "log" as const, store: ctx.contextLog.store },
          }),
          ...overrides,
        }),
      );
    },
  };
  return { definition, contexts };
}

function parentAgent(
  model: LanguageModel,
  store: ContextLogStore,
  subagents: SubagentDefinition[],
  overrides: Partial<AgentOptions> = {},
) {
  return createAgent({
    model,
    systemPrompt: "You are the parent.",
    contextLog: { mode: "log", store },
    subagents,
    includeGeneralPurposeSubagent: false,
    ...overrides,
  });
}

/** The parent's committed tool result for a tool call, as JSON text. */
async function toolResultFor(
  store: ContextLogStore,
  toolCallId: string,
  stream = MAIN,
): Promise<string> {
  const entry = (await readPath(store, stream)).find(
    (candidate) =>
      candidate.kind === "tool_result" &&
      candidate.message.content.some(
        (part) => part.type === "tool-result" && part.toolCallId === toolCallId,
      ),
  );
  expect(entry, `tool result for ${toolCallId}`).toBeDefined();
  return JSON.stringify(entry);
}

describe("log-mode subagent streams", () => {
  it("runs a delegation on its own stream in the parent's store", async () => {
    const store = new MemoryContextLogStore();
    const parent = scriptedModel([delegate("call-1"), text("All done")], "parent-model");
    const child = scriptedModel([text("Child result")], "child-model");
    const { definition, contexts } = researcher(child.model);

    const result = await parentAgent(parent.model, store, [definition]).generate({
      prompt: "Delegate it",
      threadId: THREAD,
    });

    expect(result.status).toBe("complete");
    const childStream = childStreamFor("call-1");
    expect(childStream.streamId).toMatch(/^main\/subagent\/researcher-[0-9a-f]{32}$/);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.contextLog).toEqual({ store, stream: childStream, parentStream: MAIN });

    // The child's history is its own stream, under its own frozen core.
    const childPath = await readPath(store, childStream);
    expect(childPath.map((entry) => entry.kind)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(childPath[0])).toContain("Research the topic");
    const childHead = await store.readHead(childStream);
    expect((await store.readVersion(childHead!.versionId)).core).toBe("You are the researcher.");

    // The parent sees only an ordinary tool result with the child's reply.
    const parentPath = await readPath(store, MAIN);
    expect(parentPath.map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "tool_result",
      "assistant",
    ]);
    expect(JSON.stringify(parentPath)).not.toContain("You are the researcher.");
    expect(await toolResultFor(store, "call-1")).toContain("Child result");
    expect(promptText(parent.requests[1]!.prompt)).toContain("Child result");
  });

  it("keeps child history across bounded generations without a private saver", async () => {
    const store = new MemoryContextLogStore();
    const parent = scriptedModel([delegate("call-1"), text("All done")]);
    const child = scriptedModel([call("echo-1", "echo", { value: "a" }), text("Final summary")]);
    // A host-style bounded loop: one step per generation, then continue the
    // same delegation with a new prompt until the child stops on its own.
    const bounded = (agent: Agent): Agent =>
      new Proxy(agent, {
        get(target, prop, receiver) {
          if (prop !== "generate") return Reflect.get(target, prop, receiver);
          const generate: Agent["generate"] = async (options) => {
            let result = await target.generate(options);
            for (let i = 0; i < 3 && result.status === "complete"; i++) {
              if (result.finishReason !== "tool-calls") break;
              result = await target.generate({ ...options, prompt: "Continue the task" });
            }
            return result;
          };
          return generate;
        },
      });
    const { definition } = researcher(child.model, { tools: { echo }, maxSteps: 1 }, bounded);

    await parentAgent(parent.model, store, [definition]).generate({
      prompt: "Delegate it",
      threadId: THREAD,
    });

    expect(child.requests).toHaveLength(2);
    // The second generation projects the first one's committed history.
    const second = promptText(child.requests[1]!.prompt);
    expect(second).toContain("Research the topic");
    expect(second).toContain("echo:a");
    expect(second).toContain("Continue the task");
    const childPath = await readPath(store, childStreamFor("call-1"));
    expect(childPath.map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "tool_result",
      "user",
      "assistant",
    ]);
    expect(await toolResultFor(store, "call-1")).toContain("Final summary");
  });

  it("reads a finished delegation back without running it again", async () => {
    const store = new MemoryContextLogStore();
    const child = scriptedModel([text("Child result")]);
    const { definition, contexts } = researcher(child.model);
    await parentAgent(scriptedModel([delegate("call-1"), text("Done")]).model, store, [
      definition,
    ]).generate({ prompt: "Delegate it", threadId: THREAD });

    // A restarted parent re-executes the same tool call.
    const restarted = scriptedModel([delegate("call-1"), text("Done again")]);
    await parentAgent(restarted.model, store, [definition]).generate({
      prompt: "Again",
      threadId: THREAD,
    });

    expect(contexts).toHaveLength(1);
    expect(child.requests).toHaveLength(1);
    expect(await readPath(store, childStreamFor("call-1"))).toHaveLength(2);
    expect(promptText(restarted.requests[1]!.prompt)).toContain("Child result");
  });

  it("fails a recreated delegation with an unfinished head with the typed error", async () => {
    const store = new MemoryContextLogStore();
    const childStream = childStreamFor("call-1");
    // A child that committed its input, then crashed before any output.
    await store.prepare({
      stream: childStream,
      expectedRevision: 0,
      idempotencyKey: "crashed",
      transition: { reason: "initial", parent: null, core: "core", contract: {} },
      append: [
        { kind: "user", key: "user:1", message: { role: "user", content: "Research the topic" } },
      ],
      manifest: {
        projection: { adapter: "test", version: "1" },
        model: { provider: "mock-provider", modelId: "mock-model" },
        inputDigest: "0".repeat(64),
      },
    });
    const before = await store.readHead(childStream);

    const child = scriptedModel([text("Should not run")]);
    const { definition, contexts } = researcher(child.model);
    const toolErrors: unknown[] = [];
    const parent = scriptedModel([delegate("call-1"), text("Reported")]);
    await parentAgent(parent.model, store, [definition], {
      transformToolError: (error) => {
        toolErrors.push(error);
        return error;
      },
    }).generate({ prompt: "Delegate it", threadId: THREAD });

    expect(contexts).toHaveLength(0);
    expect(child.requests).toHaveLength(0);
    expect(await store.readHead(childStream)).toEqual(before);
    expect(toolErrors).toHaveLength(1);
    const error = toolErrors[0];
    expect(error).toBeInstanceOf(DelegationRecoveryRequiredError);
    expect(isContextLogError(error, "refused")).toBe(true);
    expect((error as DelegationRecoveryRequiredError).reason).toBe("delegation_recovery_required");
    expect((error as DelegationRecoveryRequiredError).stream).toEqual(childStream);
    expect((error as DelegationRecoveryRequiredError).head).toEqual(before);
    // The parent still records a result for its tool call.
    expect(await toolResultFor(store, "call-1")).toContain("delegation cannot be replayed");
  });

  it("keeps the typed error through owned delegation", async () => {
    const store = new MemoryContextLogStore();
    const childStream = childStreamFor("call-1");
    const child = scriptedModel([call("echo-1", "echo", { value: "a" })]);
    // The child stops on a tool call at maxSteps: not a final reply.
    await createAgent({
      model: child.model,
      systemPrompt: "You are the researcher.",
      contextLog: { mode: "log", store },
      tools: { echo },
      maxSteps: 1,
    }).generate({
      prompt: "Research the topic",
      threadId: THREAD,
      contextStream: { branchId: childStream.branchId, streamId: childStream.streamId },
    });
    expect((await readSubagentDelegation(store, childStream)).status).toBe("unfinished");

    const { definition, contexts } = researcher(child.model);
    const toolErrors: unknown[] = [];
    await parentAgent(
      scriptedModel([delegate("call-1"), text("Reported")]).model,
      store,
      [definition],
      {
        ownedTaskPolicy: { cancellationGraceMs: 1000 },
        transformToolError: (error) => {
          toolErrors.push(error);
          return error;
        },
      },
    ).generate({ prompt: "Delegate it", threadId: THREAD });

    expect(contexts).toHaveLength(0);
    expect(toolErrors).toHaveLength(1);
    expect(toolErrors[0]).toBeInstanceOf(DelegationRecoveryRequiredError);
  });

  it("rejects a background delegation with an unfinished head before it starts", async () => {
    const store = new MemoryContextLogStore();
    const childStream = childStreamFor("call-1");
    await store.prepare({
      stream: childStream,
      expectedRevision: 0,
      idempotencyKey: "crashed",
      transition: { reason: "initial", parent: null, core: "core", contract: {} },
      append: [{ kind: "user", key: "user:1", message: { role: "user", content: "task" } }],
      manifest: {
        projection: { adapter: "test", version: "1" },
        model: { provider: "mock-provider", modelId: "mock-model" },
        inputDigest: "0".repeat(64),
      },
    });

    const child = scriptedModel([text("Should not run")]);
    const { definition, contexts } = researcher(child.model);
    const toolErrors: unknown[] = [];
    const backgroundCall = call("call-1", "task", {
      description: "Research the topic",
      subagent_type: "researcher",
      run_in_background: true,
    });
    await parentAgent(
      scriptedModel([backgroundCall, text("Reported")]).model,
      store,
      [definition],
      {
        transformToolError: (error) => {
          toolErrors.push(error);
          return error;
        },
      },
    ).generate({ prompt: "Delegate it", threadId: THREAD });

    expect(contexts).toHaveLength(0);
    expect(child.requests).toHaveLength(0);
    expect(toolErrors).toHaveLength(1);
    expect(toolErrors[0]).toBeInstanceOf(DelegationRecoveryRequiredError);
  });

  it("requires the factory to return a log-mode agent on the delegation's store", async () => {
    for (const childLog of [
      undefined,
      { mode: "log" as const, store: new MemoryContextLogStore() },
    ]) {
      const store = new MemoryContextLogStore();
      const child = scriptedModel([text("Child result")]);
      const definition: SubagentDefinition = {
        type: "researcher",
        description: "Researches topics",
        create: () =>
          createAgent({
            model: child.model,
            systemPrompt: "You are the researcher.",
            ...(childLog && { contextLog: childLog }),
          }),
      };
      await parentAgent(scriptedModel([delegate("call-1"), text("Done")]).model, store, [
        definition,
      ]).generate({ prompt: "Delegate it", threadId: THREAD });

      expect(child.requests).toHaveLength(0);
      expect(await store.readHead(childStreamFor("call-1"))).toBeNull();
      expect(await toolResultFor(store, "call-1")).toContain(
        "must return an agent with contextLog",
      );
    }
  });

  it("rejects a child that shares the parent's checkpointer", async () => {
    const store = new MemoryContextLogStore();
    const checkpointer = new MemorySaver();
    const child = scriptedModel([text("Child result")]);
    const { definition } = researcher(child.model, { checkpointer });
    await parentAgent(
      scriptedModel([delegate("call-1"), text("Done")]).model,
      store,
      [definition],
      {
        checkpointer,
      },
    ).generate({ prompt: "Delegate it", threadId: THREAD });

    expect(child.requests).toHaveLength(0);
    expect(await toolResultFor(store, "call-1")).toContain(
      "cannot share its parent's checkpointer",
    );
  });

  it("uses the host's subagent stream resolver", async () => {
    const store = new MemoryContextLogStore();
    const child = scriptedModel([text("Child result")]);
    const { definition, contexts } = researcher(child.model);
    await parentAgent(
      scriptedModel([delegate("call-1"), text("Done")]).model,
      store,
      [definition],
      {
        contextLog: {
          mode: "log",
          store,
          subagentStream: ({ toolCallId, subagentType }) => ({
            branchId: "branch-7",
            streamId: `run-1/subagent/${subagentType}-${toolCallId}`,
          }),
        },
      },
    ).generate({
      prompt: "Delegate it",
      threadId: THREAD,
      contextStream: { branchId: "branch-7", streamId: "main" },
    });

    const expected = {
      threadId: THREAD,
      branchId: "branch-7",
      streamId: "run-1/subagent/researcher-call-1",
    };
    expect(contexts[0]!.contextLog?.stream).toEqual(expected);
    expect(contexts[0]!.contextLog?.parentStream).toEqual({ ...MAIN, branchId: "branch-7" });
    expect(await readPath(store, expected)).toHaveLength(2);
  });

  it("rejects a resolver that returns the parent's own stream", async () => {
    const store = new MemoryContextLogStore();
    const child = scriptedModel([text("Child result")]);
    const { definition } = researcher(child.model);
    await parentAgent(
      scriptedModel([delegate("call-1"), text("Done")]).model,
      store,
      [definition],
      {
        contextLog: {
          mode: "log",
          store,
          subagentStream: () => ({ branchId: "main", streamId: "main" }),
        },
      },
    ).generate({ prompt: "Delegate it", threadId: THREAD });

    expect(child.requests).toHaveLength(0);
    expect(await toolResultFor(store, "call-1")).toContain("a subagent needs a stream of its own");
  });

  it("runs the built-in general-purpose subagent in log mode with the parent's admit hook", async () => {
    const store = new MemoryContextLogStore();
    const admitted: ContextStreamRef[] = [];
    // Parent and child share the model: tool call, child reply, parent reply.
    const shared = scriptedModel([
      call("call-1", "task", { description: "Summarise", subagent_type: "general-purpose" }),
      text("General result"),
      text("Done"),
    ]);
    await createAgent({
      model: shared.model,
      systemPrompt: "You are the parent.",
      contextLog: {
        mode: "log",
        store,
        admit: (input) => {
          if (input.phase === "prepare") admitted.push(input.request.stream);
          return { allow: true };
        },
      },
    }).generate({ prompt: "Delegate it", threadId: THREAD });

    const childStream = deriveSubagentContextStream({
      parent: MAIN,
      toolCallId: "call-1",
      subagentType: "general-purpose",
    });
    expect((await readPath(store, childStream)).map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
    ]);
    expect(admitted).toContainEqual(childStream);
    expect(await toolResultFor(store, "call-1")).toContain("General result");
  });

  it("leaves legacy delegation unchanged", async () => {
    const child = scriptedModel([text("Child result")]);
    const { definition, contexts } = researcher(child.model);
    const result = await createAgent({
      model: scriptedModel([delegate("call-1"), text("Done")]).model,
      subagents: [definition],
      includeGeneralPurposeSubagent: false,
    }).generate({ prompt: "Delegate it" });

    expect(result.status).toBe("complete");
    expect(contexts[0]!.contextLog).toBeUndefined();
    expect(child.requests).toHaveLength(1);
  });
});

describe("readSubagentDelegation", () => {
  const stream = childStreamFor("call-1");
  const model = { provider: "mock-provider", modelId: "mock-model" };

  async function prepared(store: MemoryContextLogStore) {
    return store.prepare({
      stream,
      expectedRevision: 0,
      idempotencyKey: "call-0",
      transition: { reason: "initial", parent: null, core: "core", contract: {} },
      append: [{ kind: "user", key: "user:1", message: { role: "user", content: "task" } }],
      manifest: {
        projection: { adapter: "test", version: "1" },
        model,
        inputDigest: "0".repeat(64),
      },
    });
  }

  it("is absent on a stream without a head", async () => {
    expect(await readSubagentDelegation(new MemoryContextLogStore(), stream)).toEqual({
      status: "absent",
    });
  });

  it("is completed by a committed final reply, before or after its outcome is recorded", async () => {
    const store = new MemoryContextLogStore();
    const { manifest } = await prepared(store);
    await store.markDispatched(manifest.id);
    await store.appendOutputs({
      manifestId: manifest.id,
      expectedRevision: 1,
      items: [
        {
          kind: "assistant",
          key: "out:1",
          message: {
            role: "assistant",
            content: [
              { type: "reasoning", text: "thinking" },
              { type: "text", text: "Hello " },
              { type: "text", text: "world" },
            ],
          },
        },
      ],
    });
    expect(await readSubagentDelegation(store, stream)).toMatchObject({
      status: "completed",
      text: "Hello world",
    });
    await store.recordOutcome(manifest.id, { status: "completed" });
    expect(await readSubagentDelegation(store, stream)).toMatchObject({
      status: "completed",
      text: "Hello world",
    });
  });

  it("is unfinished without a final reply", async () => {
    const store = new MemoryContextLogStore();
    const { manifest } = await prepared(store);
    expect((await readSubagentDelegation(store, stream)).status).toBe("unfinished");

    await store.markDispatched(manifest.id);
    await store.appendOutputs({
      manifestId: manifest.id,
      expectedRevision: 1,
      items: [
        {
          kind: "assistant",
          key: "out:1",
          message: {
            role: "assistant",
            content: [{ type: "tool-call", toolCallId: "t1", toolName: "echo", input: {} }],
          },
        },
      ],
    });
    expect((await readSubagentDelegation(store, stream)).status).toBe("unfinished");
  });

  it("is unfinished when the last call failed", async () => {
    const store = new MemoryContextLogStore();
    const { manifest } = await prepared(store);
    await store.markDispatched(manifest.id);
    await store.appendOutputs({
      manifestId: manifest.id,
      expectedRevision: 1,
      items: [
        { kind: "assistant", key: "out:1", message: { role: "assistant", content: "partial" } },
      ],
    });
    await store.recordOutcome(manifest.id, { status: "failed" });
    expect((await readSubagentDelegation(store, stream)).status).toBe("unfinished");
  });
});
