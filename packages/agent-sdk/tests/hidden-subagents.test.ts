/**
 * Hidden subagent types (LLE-14266): accepted and dispatched under the exact
 * type string, but absent from the task tool's description and provider schema.
 */

import type { LanguageModelV4CallOptions, LanguageModelV4FunctionTool } from "@ai-sdk/provider";
import { asSchema, type LanguageModel, type Tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent } from "../src/agent.js";
import { ConfigurationError } from "../src/errors/index.js";
import { createSubagent } from "../src/index.js";
import { clearCompletedTasks, createTaskTool, getBackgroundTask } from "../src/tools/task.js";
import type { Agent, SubagentDefinition, SubagentStartInput } from "../src/types.js";

function mockAgent(): Agent {
  return {
    id: "mock-agent",
    options: { model: {} as LanguageModel },
    backend: {} as never,
    state: { todos: [], files: {} },
    generate: vi.fn().mockResolvedValue({
      status: "complete",
      text: "child done",
      steps: [],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }),
    stream: vi.fn() as never,
    streamRaw: vi.fn() as never,
    getSkills: vi.fn().mockReturnValue([]),
  } as unknown as Agent;
}

function definition(type: string, overrides: Partial<SubagentDefinition> = {}) {
  const create = vi.fn(() => mockAgent());
  return { type, description: `${type} description`, create, ...overrides };
}

function taskTool(subagents: SubagentDefinition[]): Tool {
  return createTaskTool({
    subagents,
    defaultModel: { modelId: "default" } as LanguageModel,
    parentAgent: mockAgent(),
    includeGeneralPurpose: false,
  });
}

const providerSchema = (tool: Tool) => asSchema(tool.inputSchema).jsonSchema;
const validate = (tool: Tool, value: unknown) => asSchema(tool.inputSchema).validate!(value);

describe("hidden subagent types", () => {
  beforeEach(async () => {
    await clearCompletedTasks();
  });

  it("leaves the description and provider schema exactly as without the hidden type", async () => {
    const visibleOnly = taskTool([definition("coder")]);
    const withHidden = taskTool([definition("coder"), definition("retired", { hidden: true })]);

    expect(withHidden.description).toBe(visibleOnly.description);
    expect(withHidden.description).not.toContain("retired");
    expect(await providerSchema(withHidden)).toEqual(await providerSchema(visibleOnly));
    expect(JSON.stringify(await providerSchema(withHidden))).not.toContain("retired");
    expect(
      (await providerSchema(withHidden)).properties?.subagent_type as { enum?: string[] },
    ).toMatchObject({ enum: ["coder"] });
  });

  it("accepts a hidden type and dispatches it under the exact type string", async () => {
    const retired = definition("claude-sonnet-4-5", { hidden: true });
    const tool = taskTool([definition("coder"), retired]);
    const input = { description: "Old work", subagent_type: "claude-sonnet-4-5" };

    expect(await validate(tool, input)).toEqual({ success: true, value: input });
    const result = await tool.execute!(input, {
      toolCallId: "tc-1",
      messages: [],
      abortSignal: undefined as never,
    });

    expect(retired.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, text: "child done" });
  });

  it("keeps the hidden type on background task records", async () => {
    const tool = taskTool([definition("coder"), definition("retired", { hidden: true })]);
    const started = (await tool.execute!(
      { description: "Old work", subagent_type: "retired", run_in_background: true },
      { toolCallId: "tc-1", messages: [], abortSignal: undefined as never },
    )) as { taskId: string };

    await vi.waitFor(async () => {
      expect((await getBackgroundTask(started.taskId))?.status).toBe("completed");
    });
    expect((await getBackgroundTask(started.taskId))?.subagentType).toBe("retired");
  });

  it("still rejects an unknown type", async () => {
    const tool = taskTool([definition("coder"), definition("retired", { hidden: true })]);
    const result = await validate(tool, { description: "x", subagent_type: "unknown" });
    expect(result.success).toBe(false);
    // Other fields are still validated for hidden types.
    expect((await validate(tool, { subagent_type: "retired" })).success).toBe(false);
  });

  it("requires a visible subagent when any is hidden", () => {
    expect(() => taskTool([definition("retired", { hidden: true })])).toThrow(ConfigurationError);
  });
});

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

describe("hidden subagent types through an agent call", () => {
  it("dispatches a model's call to a hidden type it was never offered", async () => {
    const calls: LanguageModelV4CallOptions[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        calls.push(options);
        const first = calls.length === 1;
        return {
          content: first
            ? [
                {
                  type: "tool-call" as const,
                  toolCallId: "t1",
                  toolName: "task",
                  input: JSON.stringify({ description: "replay", subagent_type: "retired" }),
                },
              ]
            : [{ type: "text" as const, text: "Finished." }],
          finishReason: first
            ? { unified: "tool-calls" as const, raw: "tool_calls" }
            : { unified: "stop" as const, raw: "stop" },
          usage,
          warnings: [],
        };
      },
    });
    const childModel = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: "Retired child result" }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage,
        warnings: [],
      }),
    });
    const starts: SubagentStartInput[] = [];
    const agent = createAgent({
      model,
      subagents: [
        definition("coder"),
        {
          type: "retired",
          description: "Retired",
          hidden: true,
          create: () =>
            createSubagent(agent, { name: "retired", description: "r", model: childModel }),
        },
      ],
      hooks: {
        SubagentStart: [
          async (input) => {
            starts.push(input as SubagentStartInput);
            return {};
          },
        ],
      },
    });

    const result = await agent.generate({ prompt: "go" });

    expect(result.status).toBe("complete");
    const taskTool = calls[0]!.tools?.find(
      (candidate): candidate is LanguageModelV4FunctionTool => candidate.name === "task",
    );
    expect(JSON.stringify(taskTool)).not.toContain("retired");
    expect(starts.map((input) => input.agent_type)).toEqual(["retired"]);
    expect(JSON.stringify(calls[1]!.prompt)).toContain("Retired child result");
  });
});
