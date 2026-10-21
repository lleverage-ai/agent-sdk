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
  wrapToolsWithCallWrapper,
  wrapToolsWithExecutionContext,
} from "../src/agent/tool-pipeline.js";
import { createAgentState, StateBackend } from "../src/backends/state.js";
import { createInterrupt } from "../src/checkpointer/types.js";
import { ToolExecutionError, ToolPermissionDeniedError } from "../src/errors/index.js";
import { MCPManager } from "../src/mcp/manager.js";
import { TaskManager } from "../src/task-manager.js";
import { createWriteTool } from "../src/tools/filesystem.js";
import type {
  Agent,
  AgentOptions,
  HookRegistration,
  PermissionMode,
  ToolCallWrapper,
} from "../src/types.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs calls one at a time, in the order they reach the wrapper. */
function createFifoWrapper(): ToolCallWrapper {
  let tail: Promise<unknown> = Promise.resolve();
  return (_call, run) => {
    const result = tail.then(run, run);
    tail = result.catch(() => undefined);
    return result;
  };
}

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

  describe("wrapToolCall ([W])", () => {
    /**
     * The LLE-16111 race: bash has a slow PreToolUse hook (a session-service
     * write in agent-service), so a read sent just after it in the same step
     * reaches its tool body first unless the host can order the calls outside
     * the hooks.
     */
    async function runSameStepBashThenRead(wrapToolCall?: ToolCallWrapper) {
      const bodies: string[] = [];
      const bash = tool({
        description: "bash",
        inputSchema: z.object({ command: z.string() }),
        execute: async () => {
          bodies.push("bash");
          return "ran";
        },
      });
      const read = tool({
        description: "read",
        inputSchema: z.object({ path: z.string() }),
        execute: async () => {
          bodies.push("read");
          return "contents";
        },
      });
      const { deps } = createHarness(
        { bash, read },
        {
          options: { wrapToolCall },
          hooks: {
            PreToolUse: [{ matcher: "bash", hooks: [async () => sleep(30).then(() => ({}))] }],
          },
        },
      );
      const tools = createToolPipeline(deps).buildTools(buildOptions());

      const bashResult = tools.bash.execute?.(
        { command: "echo > /out.txt" },
        execOptions({ toolCallId: "call-bash" }),
      );
      await sleep(10);
      const readResult = tools.read.execute?.(
        { path: "/out.txt" },
        execOptions({ toolCallId: "call-read" }),
      );
      await expect(Promise.all([bashResult, readResult])).resolves.toEqual(["ran", "contents"]);
      return bodies;
    }

    it("lets a FIFO wrapper run a same-step read after the bash sent before it", async () => {
      expect(await runSameStepBashThenRead(createFifoWrapper())).toEqual(["bash", "read"]);
    });

    it("without a wrapper, the read overtakes the bash held by its PreToolUse hook", async () => {
      expect(await runSameStepBashThenRead()).toEqual(["read", "bash"]);
    });

    it("enters the wrapper synchronously, once per call, before the gate and PreToolUse hooks", async () => {
      const events: string[] = [];
      const { probe } = createProbeTool((input) => {
        events.push("body");
        return `ok:${(input as { value: string }).value}`;
      });
      const wrapToolCall = vi.fn<ToolCallWrapper>(async (call, run) => {
        events.push(`wrapper:${call.toolName}:${call.toolCallId}`);
        const result = await run();
        events.push("wrapper:settled");
        return result;
      });
      const authorize = vi.fn(() => {
        events.push("gate");
        return { decision: "allow" as const };
      });
      const { deps } = createHarness(
        { probe },
        {
          options: { wrapToolCall, workflowExecutionGate: { version: 1, authorize } },
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  async () => {
                    events.push("hook");
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse" as const,
                        updatedInput: { value: "rewritten" },
                      },
                    };
                  },
                ],
              },
            ],
          },
        },
      );
      const tools = createToolPipeline(deps).buildTools(buildOptions());

      const result = tools.probe.execute?.({ value: "x" }, execOptions({ toolCallId: "call-42" }));
      // No await between the AI SDK calling execute and the host wrapper.
      expect(wrapToolCall).toHaveBeenCalledTimes(1);
      expect(events[0]).toBe("wrapper:probe:call-42");
      await expect(result).resolves.toBe("ok:rewritten");

      expect(wrapToolCall).toHaveBeenCalledTimes(1);
      expect(wrapToolCall.mock.calls[0][0]).toEqual({
        toolName: "probe",
        toolCallId: "call-42",
        input: { value: "x" },
      });
      // The rewritten input is re-authorised by the gate after the hook.
      expect(events).toEqual([
        "wrapper:probe:call-42",
        "gate",
        "hook",
        "gate",
        "body",
        "wrapper:settled",
      ]);
    });

    it("passes an InterruptSignal to the wrapper as a rejection; [5] still returns the placeholder", async () => {
      const interrupt = createInterrupt({
        id: "int_call-1",
        threadId: "thread-1",
        type: "custom",
        toolCallId: "call-1",
        toolName: "probe",
        request: { q: 1 },
        step: 0,
      });
      const signal = new InterruptSignal(interrupt);
      const { probe } = createProbeTool(() => {
        throw signal;
      });
      const seen: { rejection?: unknown; released: boolean } = { released: false };
      const wrapToolCall: ToolCallWrapper = async (_call, run) => {
        try {
          return await run();
        } catch (error) {
          seen.rejection = error;
          throw error;
        } finally {
          seen.released = true;
        }
      };
      const transformToolError = vi.fn((error: unknown) => error as Error);
      const { deps } = createHarness({ probe }, { options: { wrapToolCall, transformToolError } });
      const signalState: GenerateSignalState = {};
      const tools = createToolPipeline(deps).buildTools(buildOptions({ signalState }));

      await expect(tools.probe.execute?.({ value: "x" }, execOptions())).resolves.toBe(
        "[Interrupt requested]",
      );
      expect(seen.rejection).toBe(signal);
      expect(seen.released).toBe(true);
      expect(signalState.interrupt).toBe(signal);
      expect(transformToolError).not.toHaveBeenCalled();
    });

    it("passes other rejections through unchanged to transformToolError", async () => {
      const failure = new Error("boom");
      const { probe } = createProbeTool(() => {
        throw failure;
      });
      let rejection: unknown;
      const wrapToolCall: ToolCallWrapper = (_call, run) =>
        run().catch((error) => {
          rejection = error;
          throw error;
        });
      const transformToolError = vi.fn((error: unknown) => error as Error);
      const { deps } = createHarness({ probe }, { options: { wrapToolCall, transformToolError } });
      const tools = createToolPipeline(deps).buildTools(buildOptions());

      await expect(tools.probe.execute?.({ value: "x" }, execOptions())).rejects.toBe(failure);
      expect(rejection).toBe(failure);
      expect(transformToolError).toHaveBeenCalledWith(failure, { toolName: "probe" });
    });

    describe("a call cancelled while the wrapper holds it", () => {
      /**
       * Holds the first call (`hold`) in a FIFO wrapper, queues a real write
       * behind it, optionally cancels, then releases the hold.
       */
      async function queueWriteBehindHeldCall(cancel?: "request" | "call") {
        const state = createAgentState();
        const backend = new StateBackend(state);
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        let markStarted!: () => void;
        const holdStarted = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const hold = tool({
          description: "hold",
          inputSchema: z.object({}),
          execute: async () => {
            markStarted();
            await held;
            return "held";
          },
        });
        const fifo = createFifoWrapper();
        const runs: Promise<unknown>[] = [];
        const wrapToolCall: ToolCallWrapper = (call, run) => {
          const result = fifo(call, run);
          if (call.toolName === "write") {
            // Once the write's turn comes, a later run() must reuse the outcome.
            runs.push(result.then(run, run));
          }
          return result;
        };
        const request = new AbortController();
        const callSignal = new AbortController();
        const { deps } = createHarness(
          { hold, write: createWriteTool(backend) },
          { options: { wrapToolCall } },
        );
        const tools = createToolPipeline(deps).buildTools(buildOptions({ signal: request.signal }));

        const holdResult = tools.hold.execute?.({}, execOptions({ toolCallId: "call-hold" }));
        const writeResult = tools.write.execute?.(
          { file_path: "/out.txt", content: "late" },
          execOptions({ toolCallId: "call-write", abortSignal: callSignal.signal }),
        );
        // Cancel only once the first call is running and the write is queued.
        await holdStarted;
        const reason = new Error("generation cancelled");
        if (cancel === "request") request.abort(reason);
        if (cancel === "call") callSignal.abort(reason);
        release();

        await expect(holdResult).resolves.toBe("held");
        const settled = await Promise.allSettled([writeResult, ...runs]);
        return { state, settled, reason };
      }

      it.each(["request", "call"] as const)(
        "rejects without writing when the %s signal is aborted before run()",
        async (cancel) => {
          const { state, settled, reason } = await queueWriteBehindHeldCall(cancel);

          expect(state.files["/out.txt"]).toBeUndefined();
          expect(settled).toEqual([
            { status: "rejected", reason },
            { status: "rejected", reason },
          ]);
        },
      );

      it("writes when nothing is cancelled", async () => {
        const { state, settled } = await queueWriteBehindHeldCall();

        expect(state.files["/out.txt"]?.content).toEqual(["late"]);
        expect(settled.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
      });

      it("names the tool when the abort reason is not an Error", async () => {
        const { probe, calls } = createProbeTool();
        const request = new AbortController();
        request.abort("stopped");
        const { deps } = createHarness(
          { probe },
          { options: { wrapToolCall: (_call, run) => run() } },
        );
        const tools = createToolPipeline(deps).buildTools(buildOptions({ signal: request.signal }));

        await expect(tools.probe.execute?.({ value: "x" }, execOptions())).rejects.toThrow(
          "Tool 'probe' was cancelled before it started",
        );
        expect(calls).toHaveLength(0);
      });
    });

    it("runs the tool body once however often the wrapper calls run()", async () => {
      const { probe, calls } = createProbeTool();
      const wrapToolCall: ToolCallWrapper = async (_call, run) => {
        const [first, second] = await Promise.all([run(), run()]);
        expect(second).toBe(first);
        return run();
      };
      const { deps } = createHarness({ probe }, { options: { wrapToolCall } });
      const tools = createToolPipeline(deps).buildTools(buildOptions());

      await expect(tools.probe.execute?.({ value: "x" }, execOptions())).resolves.toBe("ok:x");
      expect(calls).toHaveLength(1);
    });

    it("leaves the tool set unchanged without a wrapper, and execute-less tools always", () => {
      const { probe } = createProbeTool();
      const clientOnly = tool({ description: "client", inputSchema: z.object({}) });
      const tools = { probe, clientOnly };

      expect(wrapToolsWithCallWrapper(tools, undefined)).toBe(tools);
      const wrapped = wrapToolsWithCallWrapper(tools, (_call, run) => run());
      expect(wrapped.clientOnly).toBe(clientOnly);
      expect(wrapped.probe).not.toBe(probe);
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
