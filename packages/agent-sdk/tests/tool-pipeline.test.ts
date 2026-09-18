/**
 * Tests for the tool pipeline (`src/agent/tool-pipeline.ts`).
 *
 * Behavioural coverage for the individual wrappers lives in the agent tests
 * (permission mode, hooks, interrupts, streaming context). This file pins the
 * *composition*: which layers `buildTools()` applies, in what order, and what
 * each one injects. The order is load-bearing — see the module docs.
 */

import { type ToolExecutionOptions, tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  type BuildToolsOptions,
  createToolPipeline,
  filterToolsByAllowed,
  type GenerateSignalState,
  InterruptSignal,
  type ToolPipelineDeps,
  wrapToolsWithExecutionContext,
} from "../src/agent/tool-pipeline.js";
import { createInterrupt } from "../src/checkpointer/types.js";
import { ToolExecutionError, ToolPermissionDeniedError } from "../src/errors/index.js";
import { MCPManager } from "../src/mcp/manager.js";
import { TaskManager } from "../src/task-manager.js";
import type { Agent, AgentOptions, HookRegistration, PermissionMode } from "../src/types.js";

/**
 * A tool that records the execution options it receives.
 */
function createProbeTool(
  onExecute?: (input: unknown, options: ToolExecutionOptions<unknown>) => unknown,
) {
  const calls: Array<{ input: unknown; options: ToolExecutionOptions<unknown> }> = [];
  const probe = tool({
    description: "probe",
    inputSchema: z.object({ value: z.string() }),
    execute: async (input, options) => {
      calls.push({ input, options: options as ToolExecutionOptions<unknown> });
      return onExecute
        ? await onExecute(input, options as ToolExecutionOptions<unknown>)
        : `ok:${input.value}`;
    },
  });
  return { probe, calls };
}

function execOptions(
  overrides: Partial<ToolExecutionOptions<unknown>> = {},
): ToolExecutionOptions<unknown> {
  return {
    toolCallId: "call-1",
    messages: [],
    ...overrides,
  } as ToolExecutionOptions<unknown>;
}

interface Harness {
  deps: ToolPipelineDeps;
  agent: Agent;
  hooks: HookRegistration;
  permissionMode: { current: PermissionMode };
}

function createHarness(
  coreTools: ToolPipelineDeps["coreTools"],
  overrides: {
    options?: Partial<AgentOptions>;
    hooks?: HookRegistration;
    permissionMode?: PermissionMode;
  } = {},
): Harness {
  const agent = { id: "agent-test" } as unknown as Agent;
  const hooks: HookRegistration = overrides.hooks ?? {};
  const permissionMode = { current: overrides.permissionMode ?? "default" };
  const deps: ToolPipelineDeps = {
    options: {
      model: "test-model",
      // Keep the surface minimal: no task tools unless a test opts in.
      disabledCoreTools: ["task", "task_output"],
      ...overrides.options,
    } as AgentOptions,
    getAgent: () => agent,
    coreTools,
    runtimeTools: {},
    mcpManager: new MCPManager(),
    taskManager: new TaskManager(),
    hooks,
    getPermissionMode: () => permissionMode.current,
    approvalDecisions: new Map(),
    pendingResponses: new Map(),
    subagents: [],
  };
  return { deps, agent, hooks, permissionMode };
}

function buildOptions(overrides: Partial<BuildToolsOptions> = {}): BuildToolsOptions {
  return { threadId: "thread-1", signalState: {}, ...overrides };
}

describe("filterToolsByAllowed", () => {
  const tools = {
    a: tool({ description: "a", inputSchema: z.object({}), execute: async () => "a" }),
    b: tool({ description: "b", inputSchema: z.object({}), execute: async () => "b" }),
    c: tool({ description: "c", inputSchema: z.object({}), execute: async () => "c" }),
  };

  it("returns the same object when neither list is set", () => {
    expect(filterToolsByAllowed(tools, undefined, undefined)).toBe(tools);
    expect(filterToolsByAllowed(tools, [], [])).toBe(tools);
  });

  it("keeps only allowedTools", () => {
    expect(Object.keys(filterToolsByAllowed(tools, ["a", "c"], undefined))).toEqual(["a", "c"]);
  });

  it("removes disallowedTools", () => {
    expect(Object.keys(filterToolsByAllowed(tools, undefined, ["b"]))).toEqual(["a", "c"]);
  });

  it("gives disallowedTools precedence over allowedTools", () => {
    expect(Object.keys(filterToolsByAllowed(tools, ["a", "b"], ["b"]))).toEqual(["a"]);
  });
});

describe("createToolPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildTools()", () => {
    it("injects task manager, interrupt() and stop() into execution options", async () => {
      const { probe, calls } = createProbeTool();
      const { deps } = createHarness({ probe });
      const pipeline = createToolPipeline(deps);

      const tools = pipeline.buildTools(buildOptions());
      const result = await tools.probe.execute?.({ value: "x" }, execOptions());

      expect(result).toBe("ok:x");
      expect(calls).toHaveLength(1);
      const options = calls[0].options as ToolExecutionOptions<unknown> & Record<string, unknown>;
      // [2] task manager injection
      expect(options.taskManager).toBe(deps.taskManager);
      // [1] permission layer injects interrupt()
      expect(typeof options.interrupt).toBe("function");
      // [5] signal layer injects stop()
      expect(typeof options.stop).toBe("function");
      // [4] is not applied without a streaming context
      expect(options.streamingContext).toBeUndefined();
    });

    it.each(
      (["hook", "transformed-hook", "permission"] as const).flatMap((stage) =>
        (
          [
            { callSignal: "missing", cancel: "request" },
            { callSignal: "different", cancel: "request" },
            { callSignal: "different", cancel: "call" },
          ] as const
        ).map((signals) => ({ stage, ...signals })),
      ),
    )(
      "retains $cancel cancellation after $stage with a $callSignal call signal",
      async ({ stage, callSignal, cancel }) => {
        const request = new AbortController();
        const other = new AbortController();
        const cancellation = cancel === "request" ? request : other;
        const reason = new Error("cancelled while callback awaited");
        const { probe, calls } = createProbeTool();
        const authorize = vi.fn(() => ({ decision: "allow" as const }));
        const { deps } = createHarness(
          { probe },
          {
            options: {
              workflowExecutionGate: { version: 1, authorize },
              canUseTool: async () => {
                await Promise.resolve();
                if (stage === "permission") cancellation.abort(reason);
                return "allow";
              },
            },
            hooks: {
              PreToolUse: [
                {
                  hooks: [
                    async () => {
                      await Promise.resolve();
                      if (stage !== "permission") cancellation.abort(reason);
                      return stage === "transformed-hook"
                        ? {
                            hookSpecificOutput: {
                              hookEventName: "PreToolUse" as const,
                              updatedInput: { value: "changed" },
                            },
                          }
                        : undefined;
                    },
                  ],
                },
              ],
            },
          },
        );
        const tools = createToolPipeline(deps).buildTools(buildOptions({ signal: request.signal }));
        const result = tools.probe.execute?.(
          { value: "x" },
          execOptions(callSignal === "different" ? { abortSignal: other.signal } : {}),
        );
        await expect(result).rejects.toBe(reason);
        expect(calls).toHaveLength(0);
        expect(authorize).toHaveBeenCalledTimes(1);
      },
    );

    it("forwards telemetry to the task-manager layer and to hooks", async () => {
      const { probe } = createProbeTool();
      const preToolUse = vi.fn(async () => ({}));
      const { deps } = createHarness(
        { probe },
        { hooks: { PreToolUse: [{ hooks: [preToolUse] }] } },
      );
      const pipeline = createToolPipeline(deps);
      const telemetry = { runId: "run-1", threadId: "thread-1" };

      const tools = pipeline.buildTools(buildOptions({ telemetry }));
      await tools.probe.execute?.({ value: "x" }, execOptions());

      expect(preToolUse).toHaveBeenCalledTimes(1);
      expect(preToolUse.mock.calls[0][0]).toEqual(
        expect.objectContaining({ hook_event_name: "PreToolUse", telemetry, tool_name: "probe" }),
      );
    });

    it("applies the streaming-context layer only when a streaming context is given", async () => {
      const { probe, calls } = createProbeTool();
      const { deps } = createHarness({ probe });
      const pipeline = createToolPipeline(deps);
      const streamingContext = { writer: null };

      const tools = pipeline.buildTools(buildOptions({ streamingContext }));
      await tools.probe.execute?.({ value: "x" }, execOptions());

      const options = calls[0].options as ToolExecutionOptions<unknown> & Record<string, unknown>;
      expect(options.streamingContext).toBe(streamingContext);
    });

    it("adds task and task_output after permission wrapping, inside the hook layer", async () => {
      const { probe } = createProbeTool();
      const preToolUse = vi.fn(async () => ({}));
      const { deps } = createHarness(
        { probe },
        {
          options: { disabledCoreTools: [] },
          hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
          permissionMode: "plan",
        },
      );
      const pipeline = createToolPipeline(deps);

      const tools = pipeline.buildTools(buildOptions());

      expect(Object.keys(tools)).toEqual(["probe", "task", "task_output"]);
      // Plan mode denies everything that went through [1] ...
      await expect(tools.probe.execute?.({ value: "x" }, execOptions())).rejects.toThrow(
        ToolExecutionError,
      );
      // ... but task_output was added after [1], so it is not blocked by plan mode.
      // It is still hooked ([3]): PreToolUse sees the call.
      await tools.task_output.execute?.({ taskId: "missing" }, execOptions());
      expect(preToolUse.mock.calls.map((call) => call[0].tool_name)).toEqual([
        "probe",
        "task_output",
      ]);
    });

    it("respects disabledCoreTools for task and task_output independently", () => {
      const { probe } = createProbeTool();
      const pipelineNoTask = createToolPipeline(
        createHarness({ probe }, { options: { disabledCoreTools: ["task"] } }).deps,
      );
      expect(Object.keys(pipelineNoTask.buildTools(buildOptions()))).toEqual(["probe"]);

      const pipelineNoOutput = createToolPipeline(
        createHarness({ probe }, { options: { disabledCoreTools: ["task_output"] } }).deps,
      );
      expect(Object.keys(pipelineNoOutput.buildTools(buildOptions()))).toEqual(["probe", "task"]);
    });

    it("lets PreToolUse hooks observe calls that permission mode then denies", async () => {
      const { probe, calls } = createProbeTool();
      const preToolUse = vi.fn(async () => ({}));
      const postToolUseFailure = vi.fn(async () => ({}));
      const { deps } = createHarness(
        { probe },
        {
          hooks: {
            PreToolUse: [{ hooks: [preToolUse] }],
            PostToolUseFailure: [{ hooks: [postToolUseFailure] }],
          },
          permissionMode: "plan",
        },
      );
      const pipeline = createToolPipeline(deps);

      const tools = pipeline.buildTools(buildOptions());
      await expect(tools.probe.execute?.({ value: "x" }, execOptions())).rejects.toThrow(
        /blocked in plan mode/,
      );

      // Hooks ([3]) wrap permission mode ([1]): the hook ran, the tool did not,
      // and the denial surfaced to PostToolUseFailure.
      expect(preToolUse).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(0);
      expect(postToolUseFailure).toHaveBeenCalledTimes(1);
      expect(postToolUseFailure.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          hook_event_name: "PostToolUseFailure",
          tool_name: "probe",
          error: expect.any(ToolExecutionError),
        }),
      );
    });

    it("routes hook denials through transformToolError (signal layer is outermost)", async () => {
      const { probe } = createProbeTool();
      const transformToolError = vi.fn(
        (error: unknown, ctx: { toolName: string }) =>
          new Error(`transformed:${ctx.toolName}:${(error as Error).constructor.name}`),
      );
      const { deps } = createHarness(
        { probe },
        {
          options: { transformToolError },
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  async () => ({
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse" as const,
                      permissionDecision: "deny" as const,
                    },
                  }),
                ],
              },
            ],
          },
        },
      );
      const pipeline = createToolPipeline(deps);

      const tools = pipeline.buildTools(buildOptions());
      await expect(tools.probe.execute?.({ value: "x" }, execOptions())).rejects.toThrow(
        "transformed:probe:ToolPermissionDeniedError",
      );
      expect(transformToolError).toHaveBeenCalledWith(expect.any(ToolPermissionDeniedError), {
        toolName: "probe",
      });
    });

    it("converts InterruptSignal into a placeholder result without firing PostToolUseFailure", async () => {
      const interrupt = createInterrupt({
        id: "int_call-1",
        threadId: "thread-1",
        type: "custom",
        toolCallId: "call-1",
        toolName: "probe",
        request: { q: 1 },
        step: 0,
      });
      const { probe } = createProbeTool(() => {
        throw new InterruptSignal(interrupt);
      });
      const postToolUseFailure = vi.fn(async () => ({}));
      const transformToolError = vi.fn((error: unknown) => error as Error);
      const { deps } = createHarness(
        { probe },
        {
          options: { transformToolError },
          hooks: { PostToolUseFailure: [{ hooks: [postToolUseFailure] }] },
        },
      );
      const pipeline = createToolPipeline(deps);
      const signalState: GenerateSignalState = {};

      const tools = pipeline.buildTools(buildOptions({ signalState }));
      const result = await tools.probe.execute?.({ value: "x" }, execOptions());

      expect(result).toBe("[Interrupt requested]");
      expect(signalState.interrupt?.interrupt).toBe(interrupt);
      // [3] re-throws interrupts untouched; [5] never hands them to transformToolError.
      expect(postToolUseFailure).not.toHaveBeenCalled();
      expect(transformToolError).not.toHaveBeenCalled();
    });

    it("reads permission mode and runtime tools live, not at creation time", async () => {
      const { probe } = createProbeTool();
      const { deps, permissionMode } = createHarness({ probe });
      const pipeline = createToolPipeline(deps);

      // Permission mode is read through the getter on every call.
      const before = pipeline.buildTools(buildOptions());
      await expect(before.probe.execute?.({ value: "x" }, execOptions())).resolves.toBe("ok:x");
      permissionMode.current = "plan";
      await expect(before.probe.execute?.({ value: "x" }, execOptions())).rejects.toThrow(
        /plan mode/,
      );

      // Runtime tools are read from the shared object on every build.
      const { probe: late } = createProbeTool();
      deps.runtimeTools.late = late;
      expect(Object.keys(pipeline.buildTools(buildOptions()))).toEqual(["probe", "late"]);
    });

    it("applies allowedTools / disallowedTools before wrapping", () => {
      const { probe: a } = createProbeTool();
      const { probe: b } = createProbeTool();
      const { deps } = createHarness({ a, b }, { options: { disallowedTools: ["b"] } });
      const pipeline = createToolPipeline(deps);

      expect(Object.keys(pipeline.buildTools(buildOptions()))).toEqual(["a"]);
    });
  });

  describe("getPermissionWrappedTools()", () => {
    it("returns permission-wrapped base tools without task tools, hooks, or signal catching", async () => {
      const { probe, calls } = createProbeTool();
      const preToolUse = vi.fn(async () => ({}));
      const { deps } = createHarness(
        { probe },
        { options: { disabledCoreTools: [] }, hooks: { PreToolUse: [{ hooks: [preToolUse] }] } },
      );
      const pipeline = createToolPipeline(deps);

      const tools = pipeline.getPermissionWrappedTools("thread-1");
      expect(Object.keys(tools)).toEqual(["probe"]);

      await tools.probe.execute?.({ value: "x" }, execOptions());
      const options = calls[0].options as ToolExecutionOptions<unknown> & Record<string, unknown>;
      expect(typeof options.interrupt).toBe("function"); // [1] applied
      expect(options.taskManager).toBeUndefined(); // [2] not applied
      expect(preToolUse).not.toHaveBeenCalled(); // [3] not applied
      expect(options.stop).toBeUndefined(); // [5] not applied
    });
  });
});

describe("wrapToolsWithExecutionContext", () => {
  it("injects experimental_context and leaves execute-less tools untouched", async () => {
    const { probe, calls } = createProbeTool();
    const clientOnly = tool({ description: "client", inputSchema: z.object({}) });
    const context = { model: "m" };

    const wrapped = wrapToolsWithExecutionContext({ probe, clientOnly }, context);

    expect(wrapped.clientOnly).toBe(clientOnly);
    await wrapped.probe.execute?.({ value: "x" }, execOptions());
    const options = calls[0].options as ToolExecutionOptions<unknown> & Record<string, unknown>;
    expect(options.experimental_context).toBe(context);
  });
});
