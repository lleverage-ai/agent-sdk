/**
 * Per-subagent call settings (reasoning, provider options) and inheritance of
 * the parent call's resolved settings (LLE-14248).
 */

import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent } from "../src/agent.js";
import { ConfigurationError } from "../src/errors/index.js";
import { createSubagent } from "../src/index.js";
import { clearCompletedTasks, createTaskTool } from "../src/tools/task.js";
import type { Agent, SubagentCreateContext, SubagentDefinition } from "../src/types.js";

// =============================================================================
// Task tool (unit)
// =============================================================================

function mockAgent(): Agent {
  return {
    id: "mock-agent",
    options: { model: {} as LanguageModel },
    backend: {} as never,
    state: { todos: [], files: {} },
    generate: vi.fn().mockResolvedValue({
      status: "complete",
      text: "done",
      steps: [],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }),
    stream: vi.fn() as never,
    streamRaw: vi.fn() as never,
    getSkills: vi.fn().mockReturnValue([]),
  } as unknown as Agent;
}

function definition(
  overrides: Partial<SubagentDefinition>,
): SubagentDefinition & { child: Agent; contexts: SubagentCreateContext[] } {
  const child = mockAgent();
  const contexts: SubagentCreateContext[] = [];
  return {
    type: "worker",
    description: "Does work",
    create: (ctx) => {
      contexts.push(ctx);
      return child;
    },
    ...overrides,
    child,
    contexts,
  };
}

const defaultModel = { modelId: "default-model" } as LanguageModel;
const parentModel = { modelId: "parent-serving-model" } as LanguageModel;
const parentProviderOptions = { anthropic: { thinking: { type: "enabled", budgetTokens: 4096 } } };

/** Tool execution options as the agent's tool pipeline passes them. */
function parentCallOptions(callSettings: Record<string, unknown> = {}) {
  return {
    toolCallId: "tc-1",
    messages: [],
    abortSignal: undefined as never,
    experimental_context: { agentSdk: { currentModel: parentModel, callSettings } },
  };
}

async function run(def: SubagentDefinition, toolOptions: object = parentCallOptions()) {
  const tool = createTaskTool({
    subagents: [def],
    defaultModel,
    parentAgent: mockAgent(),
    includeGeneralPurpose: false,
  });
  return tool.execute!({ description: "Do work", subagent_type: def.type }, toolOptions as never);
}

describe("subagent call settings", () => {
  beforeEach(async () => {
    await clearCompletedTasks();
  });

  it("leaves a definition without settings exactly as before", async () => {
    for (const model of [undefined, "inherit" as const]) {
      const def = definition({ model });
      await run(
        def,
        parentCallOptions({ reasoning: "high", providerOptions: parentProviderOptions }),
      );

      expect(def.contexts[0]!.model).toBe(defaultModel);
      expect(def.contexts[0]!.callSettings).toEqual({});
      const generateOptions = vi.mocked(def.child.generate).mock.calls[0]![0];
      expect(generateOptions).not.toHaveProperty("reasoning");
      expect(generateOptions).not.toHaveProperty("providerOptions");
    }
  });

  it("applies a definition's own reasoning and provider options", async () => {
    const explicitModel = { modelId: "explore-model" } as LanguageModel;
    const providerOptions = { openai: { reasoningEffort: "low" } };
    const def = definition({ model: explicitModel, reasoning: "low", providerOptions });
    await run(
      def,
      parentCallOptions({ reasoning: "high", providerOptions: parentProviderOptions }),
    );

    expect(def.contexts[0]!.model).toBe(explicitModel);
    expect(def.contexts[0]!.callSettings).toEqual({ reasoning: "low", providerOptions });
    expect(def.child.generate).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: "low", providerOptions }),
    );
  });

  it("inherits the parent call's model, reasoning and provider options", async () => {
    const def = definition({ model: "inherit", inheritCallSettings: true });
    await run(
      def,
      parentCallOptions({ reasoning: "high", providerOptions: parentProviderOptions }),
    );

    expect(def.contexts[0]!.model).toBe(parentModel);
    expect(def.contexts[0]!.callSettings).toEqual({
      reasoning: "high",
      providerOptions: parentProviderOptions,
    });
    expect(def.child.generate).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: "high", providerOptions: parentProviderOptions }),
    );
  });

  it("lets a definition's own settings replace the inherited ones field by field", async () => {
    const def = definition({ inheritCallSettings: true, reasoning: "low" });
    await run(
      def,
      parentCallOptions({ reasoning: "high", providerOptions: parentProviderOptions }),
    );

    expect(def.contexts[0]!.model).toBe(parentModel);
    expect(def.contexts[0]!.callSettings).toEqual({
      reasoning: "low",
      providerOptions: parentProviderOptions,
    });
  });

  it("falls back to the default model and own settings outside an agent call", async () => {
    const def = definition({ inheritCallSettings: true, reasoning: "medium" });
    await run(def, { toolCallId: "tc-1", messages: [], abortSignal: undefined });

    expect(def.contexts[0]!.model).toBe(defaultModel);
    expect(def.contexts[0]!.callSettings).toEqual({ reasoning: "medium" });
  });

  it("rejects inheritCallSettings with an explicit model", () => {
    expect(() =>
      createTaskTool({
        subagents: [definition({ model: parentModel, inheritCallSettings: true })],
        defaultModel,
        parentAgent: mockAgent(),
      }),
    ).toThrow(ConfigurationError);
  });

  it("passes the settings on a streaming subagent's call", async () => {
    const def = definition({ streaming: true, reasoning: "low" });
    vi.mocked(def.child.streamRaw).mockResolvedValue({
      textStream: (async function* () {
        yield "done";
      })(),
    } as never);
    const tool = createTaskTool({
      subagents: [def],
      defaultModel,
      parentAgent: mockAgent(),
      includeGeneralPurpose: false,
      streamingContext: { writer: { write: vi.fn() } as never },
    });
    await tool.execute!(
      { description: "Do work", subagent_type: "worker" },
      parentCallOptions() as never,
    );

    expect(def.child.streamRaw).toHaveBeenCalledWith(expect.objectContaining({ reasoning: "low" }));
  });
});

// =============================================================================
// Through a real agent call
// =============================================================================

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/** A model that records each call's options and calls `task` once, then answers. */
function recordingModel(calls: LanguageModelV4CallOptions[], delegate?: object): LanguageModel {
  const finish = (toolCall: boolean) => ({
    unified: toolCall ? ("tool-calls" as const) : ("stop" as const),
    raw: toolCall ? "tool_calls" : "stop",
  });
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      calls.push(options);
      const toolCall = delegate !== undefined && calls.length === 1;
      return {
        content: toolCall
          ? [
              {
                type: "tool-call" as const,
                toolCallId: "t1",
                toolName: "task",
                input: JSON.stringify(delegate),
              },
            ]
          : [{ type: "text" as const, text: "Finished." }],
        finishReason: finish(toolCall),
        usage,
        warnings: [],
      };
    },
    doStream: async (options) => {
      calls.push(options);
      const toolCall = delegate !== undefined && calls.length === 1;
      const parts: LanguageModelV4StreamPart[] = toolCall
        ? [
            {
              type: "tool-call",
              toolCallId: "t1",
              toolName: "task",
              input: JSON.stringify(delegate),
            },
          ]
        : [
            { type: "text-start", id: "a" },
            { type: "text-delta", id: "a", delta: "Finished." },
            { type: "text-end", id: "a" },
          ];
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.enqueue({ type: "finish", finishReason: finish(toolCall), usage });
            controller.close();
          },
        }),
      };
    },
  });
}

describe("subagent call settings through an agent call", () => {
  const delegate = { description: "delegate", subagent_type: "helper" };

  for (const mode of ["generate", "stream"] as const) {
    it(`a child that inherits runs with the parent call's settings (${mode})`, async () => {
      const parentCalls: LanguageModelV4CallOptions[] = [];
      let childModel: LanguageModel | undefined;
      const childCalls: LanguageModelV4CallOptions[] = [];
      const agent = createAgent({
        model: recordingModel(parentCalls, delegate),
        includeGeneralPurposeSubagent: false,
        subagents: [
          {
            type: "helper",
            description: "helper",
            model: "inherit",
            inheritCallSettings: true,
            create: (ctx) => {
              childModel = ctx.model;
              return createSubagent(agent, {
                name: "helper",
                description: "helper",
                model: recordingModel(childCalls),
              });
            },
          },
        ],
      });

      const callOptions = {
        prompt: "go",
        reasoning: "high" as const,
        providerOptions: { test: { effort: "high" } },
      };
      if (mode === "generate") {
        await agent.generate(callOptions);
      } else {
        for await (const _part of agent.stream(callOptions)) {
          // drain
        }
      }

      // The parent's own call carries its settings...
      expect(parentCalls[0]).toMatchObject({
        reasoning: "high",
        providerOptions: { test: { effort: "high" } },
      });
      // ...the child is offered the model serving the parent call...
      expect(childModel).toBe(agent.options.model);
      // ...and the child's own model calls carry the same settings.
      expect(childCalls.length).toBeGreaterThan(0);
      for (const call of childCalls) {
        expect(call).toMatchObject({
          reasoning: "high",
          providerOptions: { test: { effort: "high" } },
        });
      }
    });
  }

  it("a child without settings sends neither reasoning nor provider options", async () => {
    const childCalls: LanguageModelV4CallOptions[] = [];
    const agent = createAgent({
      model: recordingModel([], delegate),
      includeGeneralPurposeSubagent: false,
      subagents: [
        {
          type: "helper",
          description: "helper",
          model: "inherit",
          create: () =>
            createSubagent(agent, {
              name: "helper",
              description: "helper",
              model: recordingModel(childCalls),
            }),
        },
      ],
    });

    await agent.generate({
      prompt: "go",
      reasoning: "high",
      providerOptions: { test: { effort: "high" } },
    });

    expect(childCalls.length).toBeGreaterThan(0);
    for (const call of childCalls) {
      expect(call.reasoning).toBeUndefined();
      expect(call.providerOptions).toBeUndefined();
    }
  });

  it("an agent call without reasoning sends none, as before", async () => {
    const calls: LanguageModelV4CallOptions[] = [];
    const agent = createAgent({ model: recordingModel(calls) });
    await agent.generate({ prompt: "go" });
    expect(calls[0]!.reasoning).toBeUndefined();
  });
});
