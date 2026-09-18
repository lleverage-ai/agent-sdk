/**
 * Tests for the shared generation lifecycle (`src/agent/generation-runner.ts`).
 *
 * The first half drives the runner directly with hand-built dependencies and
 * pins each lifecycle step's contract. The second half runs the five agent
 * modes against a mocked AI SDK and asserts they observe the same hook
 * inputs, retry decisions and call params — the parity the runner exists to
 * guarantee. Known, deliberate differences are listed in
 * `docs/architecture/generation-modes.md` and are not asserted here.
 */

import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckpointRuntime } from "../src/agent/checkpoint-runtime.js";
import {
  cachedTextResponse,
  createGenerationRunner,
  createToolExecutionContext,
  createToolModelOutput,
  type GenerationRunnerDeps,
  mapSteps,
  projectMessagesForModel,
} from "../src/agent/generation-runner.js";
import { createMessageRuntime } from "../src/agent/messages.js";
import type { ToolPipeline } from "../src/agent/tool-pipeline.js";
import { createAgentState } from "../src/backends/state.js";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";
import { createInterrupt } from "../src/checkpointer/types.js";
import { AgentError } from "../src/errors/index.js";
import { createAgent, TaskManager } from "../src/index.js";
import type {
  Agent,
  AgentOptions,
  GenerateResultComplete,
  HookRegistration,
  PostGenerateFailureInput,
  PostGenerateInput,
  PreGenerateInput,
} from "../src/types.js";
import { createMockModel, resetMocks } from "./setup.js";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
    createUIMessageStream: vi.fn(),
    createUIMessageStreamResponse: vi.fn(),
  };
});

import { createUIMessageStream, createUIMessageStreamResponse, generateText, streamText } from "ai";

// =============================================================================
// Helpers
// =============================================================================

const usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 };

function buildDeps(
  overrides: {
    options?: Partial<AgentOptions>;
    hooks?: HookRegistration;
    buildTools?: ToolPipeline["buildTools"];
  } = {},
): GenerationRunnerDeps & { agent: Agent; state: ReturnType<typeof createAgentState> } {
  const model = createMockModel();
  const options: AgentOptions = { model, ...overrides.options };
  const state = createAgentState();
  const agent = {
    id: "agent-test",
    options,
    state,
    taskManager: new TaskManager(),
  } as unknown as Agent;
  const checkpoints = createCheckpointRuntime({ checkpointer: options.checkpointer, state });
  const messageRuntime = createMessageRuntime({
    contextManager: options.contextManager,
    model,
    hooks: overrides.hooks,
    getAgent: () => agent,
    checkpoints,
  });
  const repair = vi.fn();
  return {
    agent,
    state,
    options,
    hooks: overrides.hooks,
    getAgent: () => agent,
    toolPipeline: {
      buildTools: overrides.buildTools ?? vi.fn(() => ({})),
      getPermissionWrappedTools: vi.fn(() => ({})),
    },
    checkpoints,
    messageRuntime,
    buildPromptContext: vi.fn(() => ({ currentMessages: [] }) as never),
    getSystemPrompt: vi.fn(() => "SYSTEM"),
    repairToolCallOptions: { repairToolCall: repair, experimental_repairToolCall: repair },
    getNextTaskPrompt: vi.fn(async () => null),
  };
}

const user = (content: string): ModelMessage => ({ role: "user", content });

// =============================================================================
// Module-scope helpers
// =============================================================================

describe("projectMessagesForModel", () => {
  const toolMessage: ModelMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "read",
        output: {
          type: "content",
          value: [
            { type: "text", text: "hi" },
            { type: "image-data", data: "…", mediaType: "image/png" },
            { type: "file-data", data: "…", mediaType: "application/pdf" },
          ],
        },
      },
    ],
  };

  it("returns the same array when the model accepts images and files", () => {
    const messages = [user("a"), toolMessage];
    expect(projectMessagesForModel(messages, undefined)).toBe(messages);
    expect(projectMessagesForModel(messages, { imageInput: true, fileInput: true })).toBe(messages);
  });

  it("replaces unsupported media parts with text placeholders", () => {
    const [, projected] = projectMessagesForModel([user("a"), toolMessage], {
      imageInput: false,
      fileInput: false,
    });
    const output = (projected.content as Array<{ output: { value: Array<{ type: string }> } }>)[0]
      .output;
    expect(output.value.map((p) => p.type)).toEqual(["text", "text", "text"]);
    expect(output.value[1]).toEqual({
      type: "text",
      text: "[Image omitted: active model does not support image input.]",
    });
    expect(output.value[2]).toEqual({
      type: "text",
      text: "[File omitted: active model does not support file input.]",
    });
  });

  it("only downgrades the unsupported kind", () => {
    const [, projected] = projectMessagesForModel([user("a"), toolMessage], {
      imageInput: false,
    });
    const output = (projected.content as Array<{ output: { value: Array<{ type: string }> } }>)[0]
      .output;
    expect(output.value.map((p) => p.type)).toEqual(["text", "text", "file-data"]);
  });

  it("descends into json-wrapped content outputs", () => {
    const wrapped: ModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "read",
          output: {
            type: "json",
            value: { type: "content", value: [{ type: "image-url", url: "x" }] },
          },
        },
      ],
    };
    const [projected] = projectMessagesForModel([wrapped], { imageInput: false });
    const output = (projected.content as Array<{ output: { value: { value: unknown[] } } }>)[0]
      .output;
    expect(output.value.value[0]).toMatchObject({ type: "text" });
  });
});

describe("createToolExecutionContext", () => {
  it("resolves capabilities from a function or object and omits the key when absent", () => {
    const model = createMockModel();
    const resolver = vi.fn(() => ({ imageInput: false }));
    expect(createToolExecutionContext({ model, modelCapabilities: resolver }, model)).toEqual({
      agentSdk: { currentModel: model, modelCapabilities: { imageInput: false } },
    });
    expect(resolver).toHaveBeenCalledWith(model);
    expect(
      createToolExecutionContext({ model, modelCapabilities: { fileInput: false } }, model),
    ).toEqual({ agentSdk: { currentModel: model, modelCapabilities: { fileInput: false } } });
    expect(createToolExecutionContext({ model }, model)).toEqual({
      agentSdk: { currentModel: model },
    });
  });
});

describe("createToolModelOutput", () => {
  it("prefers the tool's toModelOutput and falls back to text/json wrappers", async () => {
    const toModelOutput = vi.fn(() => ({ type: "text", value: "custom" }));
    await expect(
      createToolModelOutput({
        tool: { toModelOutput } as never,
        toolCallId: "c1",
        input: { a: 1 },
        output: "raw",
      }),
    ).resolves.toEqual({ type: "text", value: "custom" });
    expect(toModelOutput).toHaveBeenCalledWith({
      toolCallId: "c1",
      input: { a: 1 },
      output: "raw",
    });

    await expect(
      createToolModelOutput({ tool: undefined, toolCallId: "c1", input: {}, output: "s" }),
    ).resolves.toEqual({ type: "text", value: "s" });
    await expect(
      createToolModelOutput({ tool: undefined, toolCallId: "c1", input: {}, output: { k: 1 } }),
    ).resolves.toEqual({ type: "json", value: { k: 1 } });
    await expect(
      createToolModelOutput({ tool: undefined, toolCallId: "c1", input: {}, output: undefined }),
    ).resolves.toEqual({ type: "json", value: null });
  });
});

describe("mapSteps", () => {
  it("maps AI SDK steps to GenerateStep", () => {
    const steps = [
      {
        text: "t",
        toolCalls: [{ toolCallId: "c1", toolName: "read", input: { p: 1 } }],
        toolResults: [{ toolCallId: "c1", toolName: "read", output: "ok" }],
        finishReason: "tool-calls",
        usage,
      },
    ];
    expect(mapSteps(steps as never)).toEqual([
      {
        text: "t",
        toolCalls: [{ toolCallId: "c1", toolName: "read", input: { p: 1 } }],
        toolResults: [{ toolCallId: "c1", toolName: "read", output: "ok" }],
        finishReason: "tool-calls",
        usage,
      },
    ]);
  });
});

describe("cachedTextResponse", () => {
  it("returns the text for complete results and an empty body otherwise", async () => {
    const complete = cachedTextResponse({
      status: "complete",
      text: "cached",
      finishReason: "stop",
      steps: [],
    } as GenerateResultComplete);
    expect(complete.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    await expect(complete.text()).resolves.toBe("cached");

    const interrupted = cachedTextResponse({
      status: "interrupted",
      interrupt: createInterrupt({ type: "custom", toolCallId: "c", toolName: "t", request: {} }),
    });
    await expect(interrupted.text()).resolves.toBe("");
  });
});

// =============================================================================
// Runner
// =============================================================================

describe("createGenerationRunner", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe("beginRun", () => {
    it("mints a run id and applies PreGenerate updatedInput", async () => {
      const preGenerate = vi.fn(async (input: PreGenerateInput) => ({
        hookSpecificOutput: { updatedInput: { ...input.options, prompt: "changed" } },
      }));
      const deps = buildDeps({ hooks: { PreGenerate: [preGenerate] } });
      const runner = createGenerationRunner(deps);

      const run = await runner.beginRun({ prompt: "orig", threadId: "t1" });

      expect(run.runId).toMatch(/^run_/);
      expect(run.effectiveGenOptions).toMatchObject({
        prompt: "changed",
        threadId: "t1",
        _runId: run.runId,
      });
      expect(run.cachedResult).toBeUndefined();
      expect(preGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PreGenerate",
          options: expect.objectContaining({ prompt: "orig", _runId: run.runId }),
        }),
        null,
        expect.objectContaining({ agent: deps.agent }),
      );
    });

    it("keeps a caller-supplied _runId", async () => {
      const runner = createGenerationRunner(buildDeps());
      const run = await runner.beginRun({ prompt: "p", _runId: "run_fixed" });
      expect(run.runId).toBe("run_fixed");
      expect(run.effectiveGenOptions._runId).toBe("run_fixed");
    });

    it("surfaces respondWith as cachedResult without running PostGenerate", async () => {
      const cached: GenerateResultComplete = {
        status: "complete",
        text: "cached",
        finishReason: "stop",
        steps: [],
      };
      const postGenerate = vi.fn(async () => ({}));
      const runner = createGenerationRunner(
        buildDeps({
          hooks: {
            PreGenerate: [async () => ({ hookSpecificOutput: { respondWith: cached } })],
            PostGenerate: [postGenerate],
          },
        }),
      );
      const run = await runner.beginRun({ prompt: "p" });
      expect(run.cachedResult).toBe(cached);
      expect(postGenerate).not.toHaveBeenCalled();
    });
  });

  describe("resolveCachedResult", () => {
    it("attaches telemetry, runs PostGenerate and applies updatedResult", async () => {
      const postGenerate = vi.fn(async (input: PostGenerateInput) => ({
        hookSpecificOutput: { updatedResult: { ...input.result, text: "rewritten" } },
      }));
      const runner = createGenerationRunner(buildDeps({ hooks: { PostGenerate: [postGenerate] } }));
      const cached: GenerateResultComplete = {
        status: "complete",
        text: "cached",
        finishReason: "stop",
        steps: [],
      };

      const result = await runner.resolveCachedResult(cached, {
        prompt: "p",
        threadId: "t1",
        _runId: "run_1",
      });

      expect(result.status).toBe("complete");
      expect((result as GenerateResultComplete).text).toBe("rewritten");
      expect(result.telemetry).toMatchObject({ runId: "run_1", threadId: "t1" });
      expect(postGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PostGenerate",
          session_id: "t1",
          telemetry: expect.objectContaining({ runId: "run_1" }),
          result: expect.objectContaining({ text: "cached" }),
        }),
        null,
        expect.anything(),
      );
    });

    it("returns interrupted results untouched", async () => {
      const runner = createGenerationRunner(buildDeps());
      const interrupted = {
        status: "interrupted" as const,
        interrupt: createInterrupt({ type: "custom", toolCallId: "c", toolName: "t", request: {} }),
      };
      expect(await runner.resolveCachedResult(interrupted, { prompt: "p" })).toBe(interrupted);
    });
  });

  describe("beginAttempt / prepareRequest", () => {
    it("selects the checkpoint thread per strategy", async () => {
      const checkpointer = new MemorySaver();
      const deps = buildDeps({ options: { checkpointer } });
      const runner = createGenerationRunner(deps);
      await deps.checkpoints.save("base", [user("history")], 3, "run_prev");

      const forkAware = await runner.beginAttempt(
        { prompt: "p", threadId: "base", forkSession: true, _runId: "run_1" },
        deps.options.model,
        "fork-aware",
      );
      expect(forkAware.forkedSessionId).toBeDefined();
      expect(forkAware.checkpointThreadId).toBe(forkAware.forkedSessionId);
      expect(forkAware.executionBaseTelemetry.threadId).toBe(forkAware.forkedSessionId);
      expect(forkAware.startStep).toBe(3);
      expect(forkAware.messages).toEqual([user("history"), user("p")]);

      const request = await runner.beginAttempt(
        { prompt: "p", threadId: "base", forkSession: true, _runId: "run_1" },
        deps.options.model,
        "request",
      );
      expect(request.forkedSessionId).toBeDefined();
      expect(request.checkpointThreadId).toBe("base");
      expect(request.executionBaseTelemetry.threadId).toBe("base");
    });

    it("defaults maxSteps to 10 and startStep to 0 without a checkpoint", async () => {
      const deps = buildDeps();
      const runner = createGenerationRunner(deps);
      const attempt = await runner.beginAttempt({ prompt: "p" }, deps.options.model, "request");
      expect(attempt).toMatchObject({ maxSteps: 10, startStep: 0, checkpoint: undefined });
      expect(attempt.executionBaseTelemetry.runId).toMatch(/^run_/);
    });

    it("builds tools through the pipeline with the attempt's telemetry and signal state", async () => {
      const tools = { read: { description: "r" } as never };
      const buildTools = vi.fn(() => tools);
      const deps = buildDeps({ options: { maxSteps: 4 }, buildTools });
      const runner = createGenerationRunner(deps);
      const streamingContext = { writer: null };

      const attempt = await runner.beginAttempt(
        { prompt: "p", threadId: "t1", _runId: "run_1", maxTokens: 5, temperature: 0.1 },
        deps.options.model,
        "request",
      );
      const prepared = runner.prepareRequest(attempt, { streamingContext });

      expect(buildTools).toHaveBeenCalledWith({
        threadId: "t1",
        telemetry: attempt.executionBaseTelemetry,
        signalState: prepared.signalState,
        streamingContext,
      });
      expect(prepared.activeTools).toBe(tools);
      expect(prepared.systemPrompt).toBe("SYSTEM");
      expect(deps.buildPromptContext).toHaveBeenCalledWith(
        attempt.effectiveGenOptions,
        attempt.messages,
        "t1",
      );
      expect(prepared.initialParams).toMatchObject({
        system: "SYSTEM",
        messages: attempt.messages,
        tools,
        maxTokens: 5,
        temperature: 0.1,
      });
      expect(prepared.toolExecutionContext.agentSdk.currentModel).toBe(deps.options.model);
    });

    it("prefers `telemetry` over `experimental_telemetry`", async () => {
      const deps = buildDeps();
      const runner = createGenerationRunner(deps);
      const both = await runner.prepareAttempt(
        {
          prompt: "p",
          telemetry: { isEnabled: true },
          experimental_telemetry: { isEnabled: false },
        },
        deps.options.model,
        "request",
      );
      expect(both.initialParams.telemetry).toEqual({ isEnabled: true });
      const legacy = await runner.prepareAttempt(
        { prompt: "p", experimental_telemetry: { isEnabled: false } },
        deps.options.model,
        "request",
      );
      expect(legacy.initialParams.telemetry).toEqual({ isEnabled: false });
    });
  });

  describe("buildModelCallParams", () => {
    it("assembles the AI SDK call from the prepared attempt", async () => {
      const execute = vi.fn(async () => "ok");
      const tools = { read: { description: "r", execute } as never };
      const deps = buildDeps({
        options: { maxSteps: 2, modelCapabilities: { imageInput: false } },
        buildTools: vi.fn(() => tools),
      });
      const runner = createGenerationRunner(deps);
      const attempt = await runner.prepareAttempt(
        { prompt: "p", headers: { h: "1" }, providerOptions: { x: 1 } },
        deps.options.model,
        "request",
      );

      const params = runner.buildModelCallParams(attempt);

      expect(params.model).toBe(deps.options.model);
      expect(params.repairToolCall).toBe(deps.repairToolCallOptions.repairToolCall);
      expect(params.experimental_repairToolCall).toBe(deps.repairToolCallOptions.repairToolCall);
      expect(params.system).toBe("SYSTEM");
      expect(params.messages).toEqual(attempt.messages);
      expect(params.allowSystemInMessages).toBe(true);
      expect(params.headers).toEqual({ h: "1" });
      expect(params.providerOptions).toEqual({ x: 1 });
      expect(params.stopWhen).toHaveLength(3);

      // Tools are wrapped with the execution context.
      expect(params.tools.read).not.toBe(tools.read);
      await (params.tools.read.execute as (i: unknown, o: unknown) => Promise<unknown>)(
        {},
        { toolCallId: "c1", messages: [] },
      );
      expect(execute).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          experimental_context: {
            agentSdk: {
              currentModel: deps.options.model,
              modelCapabilities: { imageInput: false },
            },
          },
        }),
      );
    });

    it("stops after the current step when the signal state is set", async () => {
      const deps = buildDeps({ options: { maxSteps: 5 } });
      const runner = createGenerationRunner(deps);
      const attempt = await runner.prepareAttempt({ prompt: "p" }, deps.options.model, "request");
      const [signalStop, userStop] = runner.buildModelCallParams(attempt).stopWhen;

      expect((signalStop as () => boolean)()).toBe(false);
      attempt.signalState.stop = true;
      expect((signalStop as () => boolean)()).toBe(true);
      expect((userStop as () => boolean)()).toBe(false);
    });
  });

  describe("post-run helpers", () => {
    it("updateContextUsage forwards usage only when the manager tracks it", () => {
      const updateUsage = vi.fn();
      const deps = buildDeps({
        options: { contextManager: { updateUsage } as never },
      });
      const runner = createGenerationRunner(deps);
      runner.updateContextUsage(undefined);
      expect(updateUsage).not.toHaveBeenCalled();
      runner.updateContextUsage(usage, { _skipCompaction: true });
      expect(updateUsage).not.toHaveBeenCalled();
      runner.updateContextUsage(usage);
      expect(updateUsage).toHaveBeenCalledWith(usage);

      expect(() => createGenerationRunner(buildDeps()).updateContextUsage(usage)).not.toThrow();
    });

    it("emitInterruptRequested builds the hook input from the interrupt", async () => {
      const hook = vi.fn(async () => ({}));
      const deps = buildDeps({ hooks: { InterruptRequested: [hook] } });
      const runner = createGenerationRunner(deps);
      const interrupt = createInterrupt({
        type: "custom",
        toolCallId: "call-1",
        toolName: "ask",
        request: { q: "?" },
      });
      const telemetry = { runId: "run_1", threadId: "t1" } as never;

      await runner.emitInterruptRequested("t1", telemetry, interrupt);

      expect(hook).toHaveBeenCalledWith(
        {
          hook_event_name: "InterruptRequested",
          session_id: "t1",
          cwd: process.cwd(),
          telemetry,
          interrupt_id: interrupt.id,
          interrupt_type: "custom",
          tool_call_id: "call-1",
          tool_name: "ask",
          request: { q: "?" },
        },
        null,
        expect.objectContaining({ agent: deps.agent }),
      );
    });

    it("invokePostGenerate returns the hook's updatedResult or undefined", async () => {
      const result: GenerateResultComplete = {
        status: "complete",
        text: "t",
        finishReason: "stop",
        steps: [],
      };
      const telemetry = { runId: "run_1" } as never;

      expect(
        await createGenerationRunner(buildDeps()).invokePostGenerate(
          { prompt: "p" },
          telemetry,
          result,
        ),
      ).toBeUndefined();

      const observe = vi.fn(async () => undefined);
      const rewrite = vi.fn(async () => ({
        hookSpecificOutput: { updatedResult: { ...result, text: "new" } },
      }));
      const runner = createGenerationRunner(
        buildDeps({ hooks: { PostGenerate: [observe, rewrite] } }),
      );
      const updated = await runner.invokePostGenerate(
        { prompt: "p", threadId: "t1" },
        telemetry,
        result,
      );
      expect(updated).toMatchObject({ text: "new" });
      expect(observe).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PostGenerate",
          session_id: "t1",
          telemetry,
          options: { prompt: "p", threadId: "t1" },
          result,
        }),
        null,
        expect.anything(),
      );
    });
  });

  describe("createStreamLifecycleCallbacks", () => {
    it("saves per-step checkpoints only with checkpointAfterToolCall, then finalizes", async () => {
      const checkpointer = new MemorySaver();
      const updateUsage = vi.fn();
      const postGenerate = vi.fn(async () => ({}));
      const deps = buildDeps({
        options: {
          checkpointer,
          contextManager: {
            updateUsage,
            shouldCompact: () => ({ trigger: false }),
          } as never,
        },
        hooks: { PostGenerate: [postGenerate] },
      });
      const runner = createGenerationRunner(deps);
      const saveSpy = vi.spyOn(checkpointer, "save");

      const run = async (checkpointAfterToolCall: boolean) => {
        saveSpy.mockClear();
        const attempt = await runner.prepareAttempt(
          { prompt: "p", threadId: "t1", _runId: "run_1", checkpointAfterToolCall },
          deps.options.model,
          "request",
        );
        const compaction = deps.messageRuntime.createStreamingCompactionState(
          attempt.messages,
          attempt.effectiveGenOptions,
          "t1",
        );
        const callbacks = runner.createStreamLifecycleCallbacks(attempt, compaction);
        const step = {
          text: "step",
          toolCalls: [],
          toolResults: [],
          finishReason: "stop",
          usage,
          response: { messages: [{ role: "assistant", content: "step" }] },
        } as never;
        await callbacks.onStepFinish(step);
        await callbacks.onStepFinish(step);
        return { attempt, callbacks, step };
      };

      const { callbacks, step } = await run(false);
      expect(saveSpy).not.toHaveBeenCalled();

      await callbacks.onFinish({
        text: "done",
        usage: { inputTokens: 99_000, outputTokens: 100, totalTokens: 99_100 } as never,
        finishReason: "stop" as never,
        steps: [step, step],
        response: { modelId: "resp-model" },
      });
      expect(updateUsage).toHaveBeenCalledWith(usage);
      expect(saveSpy).toHaveBeenCalledTimes(1);
      const saved = await checkpointer.load("t1");
      expect(saved?.step).toBe(2);
      expect(saved?.messages).toHaveLength(3);
      expect(postGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: "t1",
          options: expect.objectContaining({ threadId: "t1" }),
          telemetry: expect.objectContaining({ runId: "run_1", modelId: "resp-model" }),
          result: expect.objectContaining({
            status: "complete",
            text: "done",
            finishReason: "stop",
            output: undefined,
          }),
        }),
        null,
        expect.anything(),
      );

      await run(true);
      expect(saveSpy).toHaveBeenCalledTimes(2);
      expect(saveSpy.mock.calls.map(([cp]) => cp.step)).toEqual([3, 4]);
    });
  });

  describe("retryOrThrow", () => {
    it("throws the normalized error when no retry is decided", async () => {
      const runner = createGenerationRunner(buildDeps());
      const error = new AgentError("boom");
      await expect(
        runner.retryOrThrow(error, { prompt: "p" }, runner.createRetryState()),
      ).rejects.toBe(error);
    });

    it("applies hook-updated options, keeps the run id and advances the retry state", async () => {
      const failure = vi.fn(async (input: PostGenerateFailureInput) => ({
        hookSpecificOutput: {
          retry: true,
          retryDelayMs: 0,
          updatedInput: { ...input.options, prompt: "retry", _runId: undefined },
        },
      }));
      const runner = createGenerationRunner(
        buildDeps({ hooks: { PostGenerateFailure: [failure] } }),
      );
      const retryState = runner.createRetryState();

      const next = await runner.retryOrThrow(
        new AgentError("boom"),
        { prompt: "p", _runId: "run_1" },
        retryState,
      );

      expect(next).toEqual({ prompt: "retry", _runId: "run_1" });
      expect(retryState.retryAttempt).toBe(1);
    });

    it("switches to the fallback model on overload", async () => {
      const fallbackModel = createMockModel({ text: "fallback" });
      const runner = createGenerationRunner(buildDeps({ options: { fallbackModel } }));
      const retryState = runner.createRetryState();

      const next = await runner.retryOrThrow(
        new AgentError("rate limit exceeded"),
        { prompt: "p", _runId: "run_1" },
        retryState,
      );

      expect(next).toEqual({ prompt: "p", _runId: "run_1" });
      expect(retryState.currentModel).toBe(fallbackModel);
      expect(retryState.usedFallback).toBe(true);
    });
  });

  describe("runUIStreamFollowUps", () => {
    it.each([false, true])(
      "streams follow-ups, persists the transcript, and isolates summariser usage (skip=%s)",
      async (_skipCompaction) => {
        const checkpointer = new MemorySaver();
        const postGenerate = vi.fn(async () => ({}));
        const prompts = ["task one done", "task two done"];
        const updateUsage = vi.fn();
        const deps = buildDeps({
          options: {
            checkpointer,
            contextManager: { updateUsage, shouldCompact: () => ({ trigger: false }) } as never,
          },
          hooks: { PostGenerate: [postGenerate] },
        });
        deps.getNextTaskPrompt = vi.fn(async () => prompts.shift() ?? null);
        const runner = createGenerationRunner(deps);

        const makeStream = (text: string, steps: number) => ({
          toUIMessageStream: vi.fn(() => `ui:${text}`),
          text: Promise.resolve(text),
          response: Promise.resolve({ modelId: "m" }),
          steps: Promise.resolve(
            Array.from({ length: steps }, () => ({
              text,
              toolCalls: [],
              toolResults: [],
              finishReason: "stop",
              usage,
              response: { messages: [{ role: "assistant", content: text }] },
            })),
          ),
          usage: Promise.resolve({ inputTokens: 99_000, outputTokens: 100, totalTokens: 99_100 }),
          finishReason: Promise.resolve("stop"),
        });
        vi.mocked(streamText)
          .mockReturnValueOnce(makeStream("follow-1", 1) as never)
          .mockReturnValueOnce(makeStream("follow-2", 2) as never);

        const attempt = await runner.prepareAttempt(
          { prompt: "p", threadId: "t1", _runId: "run_1", _skipCompaction },
          deps.options.model,
          "request",
        );
        const streamingCompaction = deps.messageRuntime.createStreamingCompactionState(
          attempt.messages,
          attempt.effectiveGenOptions,
          "t1",
        );
        const writer = { merge: vi.fn(), write: vi.fn() };
        const streamingContext = { writer: writer as never };

        await runner.runUIStreamFollowUps({
          writer: writer as never,
          attempt,
          result: makeStream("initial", 1) as never,
          streamingCompaction,
          signalState: attempt.signalState,
          streamingContext,
        });

        expect(writer.merge.mock.calls.map(([s]) => s)).toEqual(["ui:follow-1", "ui:follow-2"]);
        expect(updateUsage.mock.calls).toEqual(_skipCompaction ? [] : [[usage], [usage]]);

        // Each follow-up request carries the transcript so far plus the prompt.
        const calls = vi.mocked(streamText).mock.calls.map(([params]) => params);
        expect(calls[0]).toMatchObject({
          model: deps.options.model,
          system: "SYSTEM",
          allowSystemInMessages: true,
        });
        expect(calls[0].messages).toEqual([
          user("p"),
          { role: "assistant", content: "initial" },
          user("task one done"),
        ]);
        expect(calls[1].messages).toEqual([
          user("p"),
          { role: "assistant", content: "initial" },
          user("task one done"),
          { role: "assistant", content: "follow-1" },
          user("task two done"),
        ]);
        expect(deps.toolPipeline.buildTools).toHaveBeenLastCalledWith(
          expect.objectContaining({ threadId: "t1", streamingContext }),
        );

        // Checkpoint step counts accumulate: 1 initial + 1 + 2. The transcript
        // is the second request's messages plus one assistant reply per step.
        const saved = await checkpointer.load("t1");
        expect(saved?.step).toBe(4);
        expect(saved?.messages).toEqual([
          ...calls[1].messages,
          { role: "assistant", content: "follow-2" },
          { role: "assistant", content: "follow-2" },
        ]);

        expect(postGenerate).toHaveBeenCalledTimes(2);
        expect(
          postGenerate.mock.calls.map(([input]) => (input as PostGenerateInput).result.text),
        ).toEqual(["follow-1", "follow-2"]);
        expect(
          postGenerate.mock.calls.map(
            ([input]) => (input as PostGenerateInput).options.requestClass,
          ),
        ).toEqual(["background", "background"]);
      },
    );

    it("does not save a UI follow-up that settles after cancellation", async () => {
      const controller = new AbortController();
      const reason = new Error("cancelled follow-up");
      const checkpointer = new MemorySaver();
      const save = vi.spyOn(checkpointer, "save");
      const postGenerate = vi.fn();
      const deps = buildDeps({
        options: { checkpointer },
        hooks: { PostGenerate: [postGenerate] },
      });
      deps.getNextTaskPrompt = vi.fn().mockResolvedValueOnce("child done").mockResolvedValue(null);
      const runner = createGenerationRunner(deps);
      const stream = {
        toUIMessageStream: vi.fn(),
        text: Promise.resolve("done"),
        response: Promise.resolve({}),
        steps: Promise.resolve([]),
        usage: Promise.resolve(usage),
        finishReason: Promise.resolve("stop"),
      };
      vi.mocked(streamText).mockImplementation(() => {
        controller.abort(reason);
        return stream as never;
      });
      const attempt = await runner.prepareAttempt(
        { prompt: "p", threadId: "t1", signal: controller.signal },
        deps.options.model,
        "request",
      );
      const result = runner.runUIStreamFollowUps({
        writer: { merge: vi.fn() } as never,
        attempt,
        result: stream as never,
        streamingCompaction: deps.messageRuntime.createStreamingCompactionState(
          attempt.messages,
          attempt.effectiveGenOptions,
          "t1",
        ),
        signalState: attempt.signalState,
      });
      await expect(result).rejects.toBe(reason);
      expect(save).not.toHaveBeenCalled();
      expect(postGenerate).not.toHaveBeenCalled();
    });

    it("is a no-op when the task queue is empty", async () => {
      const deps = buildDeps();
      const runner = createGenerationRunner(deps);
      const attempt = await runner.prepareAttempt({ prompt: "p" }, deps.options.model, "request");
      const writer = { merge: vi.fn() };

      await runner.runUIStreamFollowUps({
        writer: writer as never,
        attempt,
        result: {
          steps: Promise.resolve([]),
          text: Promise.resolve("initial"),
        } as never,
        streamingCompaction: deps.messageRuntime.createStreamingCompactionState(
          attempt.messages,
          attempt.effectiveGenOptions,
          undefined,
        ),
        signalState: attempt.signalState,
      });

      expect(writer.merge).not.toHaveBeenCalled();
      expect(streamText).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Mode parity through createAgent()
// =============================================================================

describe("generation mode parity", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  const generateResponse = {
    text: "done",
    usage,
    finishReason: "stop",
    steps: [],
    response: { modelId: "resp-model", messages: [{ role: "assistant", content: "done" }] },
  };

  function mockStreamText(
    onCreate?: (params: Record<string, unknown>) => void,
    observeFinish?: (pending: Promise<void>) => void,
  ) {
    vi.mocked(streamText).mockImplementation(((params: Record<string, unknown>) => {
      onCreate?.(params);
      const finish = params.onFinish as ((r: unknown) => Promise<void>) | undefined;
      const finished = finish
        ? finish({ ...generateResponse, response: { modelId: "resp-model" } })
        : Promise.resolve();
      observeFinish?.(finished);
      const text = finished.then(() => "done");
      // Mock the AI SDK's observation of completion failures even in modes
      // which never request `.text` (the assertion still observes `finished`).
      void text.catch(() => {});
      return {
        toUIMessageStream: vi.fn(() => "ui"),
        fullStream: (async function* () {
          await finished;
        })(),
        text,
        usage: Promise.resolve(usage),
        finishReason: Promise.resolve("stop"),
        steps: Promise.resolve([]),
        response: Promise.resolve({ modelId: "resp-model" }),
        output: Promise.resolve(undefined),
      };
    }) as never);
    vi.mocked(createUIMessageStream).mockImplementation((({
      execute,
    }: {
      execute: (o: unknown) => Promise<void>;
    }) => {
      const done = execute({ writer: { merge: vi.fn(), write: vi.fn() } });
      return { done };
    }) as never);
    vi.mocked(createUIMessageStreamResponse).mockImplementation((({
      stream,
    }: {
      stream: { done: Promise<void> };
    }) => stream.done.then(() => new Response("ok"))) as never);
  }

  type Mode = "generate" | "stream" | "streamResponse" | "streamRaw" | "streamDataResponse";
  const modes: Mode[] = ["generate", "stream", "streamResponse", "streamRaw", "streamDataResponse"];

  async function runMode(agent: Agent, mode: Mode, options: Parameters<Agent["generate"]>[0]) {
    switch (mode) {
      case "generate":
        return agent.generate(options);
      case "stream": {
        for await (const _ of agent.stream(options)) {
          // drain
        }
        return;
      }
      case "streamResponse":
        return agent.streamResponse(options);
      case "streamRaw": {
        const result = await agent.streamRaw(options);
        await result.text;
        return;
      }
      case "streamDataResponse":
        return agent.streamDataResponse(options);
    }
  }

  it.each(
    modes.flatMap((mode) =>
      (["provider", "checkpoint"] as const).map((phase) => ({ mode, phase })),
    ),
  )("$mode fences completion when cancelled during $phase", async ({ mode, phase }) => {
    const controller = new AbortController();
    const reason = new Error("cancelled generation");
    const checkpointer = new MemorySaver();
    const save = vi.spyOn(checkpointer, "save");
    if (phase === "checkpoint")
      save.mockImplementation(async () => {
        controller.abort(reason);
      });
    const postGenerate = vi.fn();
    const cancelProvider = () => {
      if (phase === "provider") controller.abort(reason);
    };
    vi.mocked(generateText).mockImplementation((async () => {
      cancelProvider();
      return generateResponse;
    }) as never);
    const finishes: Promise<void>[] = [];
    mockStreamText(cancelProvider, (pending) => {
      finishes.push(pending);
      void pending.catch(() => {});
    });
    const agent = createAgent({
      model: createMockModel(),
      checkpointer,
      hooks: { PostGenerate: [postGenerate] },
    });
    await Promise.allSettled([
      runMode(agent, mode, { prompt: "p", threadId: "t1", signal: controller.signal }),
    ]);
    await Promise.allSettled(finishes);
    expect(save).toHaveBeenCalledTimes(phase === "checkpoint" ? 1 : 0);
    expect(postGenerate).not.toHaveBeenCalled();
  });

  it.each(modes)("%s passes the same call params to the AI SDK", async (mode) => {
    const model = createMockModel();
    vi.mocked(generateText).mockResolvedValue(generateResponse as never);
    const captured: Record<string, unknown>[] = [];
    mockStreamText((p) => captured.push(p));

    const agent = createAgent({
      model,
      systemPrompt: "SYS",
      maxSteps: 3,
      hooks: {
        PreGenerate: [
          async (input: PreGenerateInput) => ({
            hookSpecificOutput: { updatedInput: { ...input.options, temperature: 0.5 } },
          }),
        ],
      },
    });

    await runMode(agent, mode, { prompt: "hello", threadId: "t1", headers: { a: "b" } });

    const params =
      mode === "generate"
        ? (vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>)
        : captured[0];
    expect(params).toMatchObject({
      model,
      system: "SYS",
      temperature: 0.5,
      headers: { a: "b" },
      allowSystemInMessages: true,
    });
    expect(params.messages).toEqual([user("hello")]);
    expect(typeof params.repairToolCall).toBe("function");
    expect(params.experimental_repairToolCall).toBe(params.repairToolCall);
    expect(params.stopWhen).toHaveLength(3);
  });

  it.each(modes)("%s runs PreGenerate and PostGenerate with the same shape", async (mode) => {
    const model = createMockModel();
    vi.mocked(generateText).mockResolvedValue(generateResponse as never);
    mockStreamText();
    const preGenerate = vi.fn(async () => ({}));
    const postGenerate = vi.fn(async () => ({}));

    const agent = createAgent({
      model,
      hooks: { PreGenerate: [preGenerate], PostGenerate: [postGenerate] },
    });

    await runMode(agent, mode, { prompt: "hello", threadId: "t1", _runId: "run_fixed" });

    expect(preGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        hook_event_name: "PreGenerate",
        session_id: "t1",
        options: expect.objectContaining({ prompt: "hello", threadId: "t1", _runId: "run_fixed" }),
      }),
      null,
      expect.anything(),
    );
    expect(postGenerate).toHaveBeenCalledTimes(1);
    expect(postGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        hook_event_name: "PostGenerate",
        session_id: "t1",
        options: expect.objectContaining({ prompt: "hello", _runId: "run_fixed" }),
        telemetry: expect.objectContaining({
          runId: "run_fixed",
          threadId: "t1",
          modelId: "resp-model",
        }),
        result: expect.objectContaining({
          status: "complete",
          text: "done",
          finishReason: "stop",
          steps: [],
        }),
      }),
      null,
      expect.anything(),
    );
  });

  // streamDataResponse() creates its stream inside createUIMessageStream's
  // execute(), so stream-creation errors surface through the UI stream rather
  // than the retry loop. See docs/architecture/generation-modes.md.
  const retryingModes = modes.filter((mode) => mode !== "streamDataResponse");

  it.each(retryingModes)(
    "%s retries through PostGenerateFailure with the same input",
    async (mode) => {
      const model = createMockModel();
      const failure = vi.fn(async () => ({
        hookSpecificOutput: { retry: true, retryDelayMs: 0 },
      }));
      let attempts = 0;
      vi.mocked(generateText).mockImplementation((async () => {
        attempts++;
        if (attempts === 1) throw new Error("transient");
        return generateResponse;
      }) as never);
      mockStreamText(() => {
        attempts++;
        if (attempts === 1) throw new Error("transient");
      });

      const agent = createAgent({ model, hooks: { PostGenerateFailure: [failure] } });

      await runMode(agent, mode, { prompt: "hello", threadId: "t1", _runId: "run_fixed" });

      expect(attempts).toBe(2);
      expect(failure).toHaveBeenCalledTimes(1);
      expect(failure).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PostGenerateFailure",
          session_id: "t1",
          options: expect.objectContaining({ prompt: "hello", _runId: "run_fixed" }),
          telemetry: expect.objectContaining({ runId: "run_fixed", threadId: "t1" }),
          error: expect.objectContaining({ message: "transient" }),
        }),
        null,
        expect.objectContaining({ retryAttempt: 0 }),
      );
      // The second attempt is still tagged with the original run id.
      const secondCall =
        mode === "generate"
          ? (vi.mocked(generateText).mock.calls[1][0] as Record<string, unknown>)
          : (vi.mocked(streamText).mock.calls[1][0] as Record<string, unknown>);
      expect(secondCall.model).toBe(model);
    },
  );

  it.each(retryingModes)(
    "%s throws the normalized error once retries are exhausted",
    async (mode) => {
      const model = createMockModel();
      vi.mocked(generateText).mockRejectedValue(new Error("fatal"));
      mockStreamText(() => {
        throw new Error("fatal");
      });
      const agent = createAgent({ model });

      await expect(runMode(agent, mode, { prompt: "hello" })).rejects.toMatchObject({
        message: "fatal",
      });
    },
  );
});
