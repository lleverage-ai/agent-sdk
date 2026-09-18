import { tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createAgent,
  createSubagent,
  definePlugin,
  type LanguageModel,
  type WorkflowExecutionGateReceipt,
  type WorkflowExecutionGateRequest,
} from "../src/index.js";

/**
 * Consumer characterisation ported from lleverage aed305073c (LLE-12792).
 *
 * Drives the real SDK generation/tool pipeline with a scripted model and fake
 * authority/I/O spies. The model emits calls; it never makes policy decisions.
 * Keep these cases aligned with the unchanged consumer gate suite.
 */

type Gate = NonNullable<Parameters<typeof createAgent>[0]["workflowExecutionGate"]>;

const model = new MockLanguageModelV3({}) as unknown as LanguageModel;

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model that emits one scripted tool call, then stops. */
type Script = { current?: { name: string; input: unknown } };

/** Emits the scripted call exactly once per `run`, then stops. */
function takeCall(script: Script) {
  const call = script.current;
  script.current = undefined;
  return call;
}

function scriptedModel(script: Script) {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const call = takeCall(script);
      if (call) {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "call-1",
              toolName: call.name,
              input: JSON.stringify(call.input),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text" as const, text: "done" }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage,
        warnings: [],
      };
    },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          const call = takeCall(script);
          controller.enqueue({ type: "stream-start", warnings: [] });
          if (call) {
            controller.enqueue({
              type: "tool-call",
              toolCallId: "s-1",
              toolName: call.name,
              input: JSON.stringify(call.input),
            });
          }
          controller.enqueue({
            type: "finish",
            finishReason: call
              ? { unified: "tool-calls", raw: "tool_calls" }
              : { unified: "stop", raw: "stop" },
            usage,
          });
          controller.close();
        },
      }),
    }),
  }) as unknown as LanguageModel;
}

function setup(options: {
  gate?: Gate | undefined;
  hooksOrder: string[];
  canUseTool?: Parameters<typeof createAgent>[0]["canUseTool"];
  needsApproval?: boolean | (() => boolean | Promise<boolean>);
  hookPlugin?: "respondWith" | "transform" | "transform-proxy" | "plain";
}) {
  const script: Script = {};
  const protectedIo = vi.fn();
  const toolBody = vi.fn(async (input: { path: string }) => `read:${input.path}`);
  const pluginBody = vi.fn(async () => "plugin-ran");
  const failureHook = vi.fn();
  /** Every execute() rejection reaching the AI SDK passes through here. */
  const toolErrors: Array<{ toolName: string; error: unknown }> = [];
  const hookPlugin = definePlugin({
    name: "memory-like",
    description: "performs I/O inside PreToolUse like the memory URI resolver",
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (input) => {
              options.hooksOrder.push("protected-hook");
              protectedIo(input.hook_event_name === "PreToolUse" ? input.tool_name : undefined);
              if (options.hookPlugin === "respondWith") {
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse" as const,
                    respondWith: "synthetic-memory",
                  },
                };
              }
              if (options.hookPlugin === "transform-proxy") {
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse" as const,
                    updatedInput: {
                      tool_name: "crm__create_contact",
                      arguments: { name: "changed" },
                    },
                  },
                };
              }
              if (options.hookPlugin === "transform") {
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse" as const,
                    updatedInput: { path: "memory://transformed" },
                  },
                };
              }
              return undefined;
            },
          ],
        },
      ],
      PostToolUseFailure: [{ hooks: [() => void failureHook()] }],
    },
  });
  const proxied = definePlugin({
    name: "crm",
    description: "deferred plugin reached through call_tool",
    deferred: true,
    tools: {
      lookup_contact: tool({
        description: "lookup",
        inputSchema: z.object({ name: z.string() }),
        execute: async () => "looked up",
      }),
      create_contact: tool({
        description: "create",
        inputSchema: z.object({ name: z.string() }),
        execute: pluginBody,
      }),
    },
  });
  const agent = createAgent({
    model: scriptedModel(script),
    canUseTool: options.canUseTool,
    // `read` overlays the SDK core tool of the same name so the fixture's spy
    // body is the one that would perform the protected read.
    tools: {
      read: tool({
        description: "read",
        inputSchema: z.object({ path: z.string() }),
        execute: toolBody,
        needsApproval: options.needsApproval,
      }),
    },
    plugins: [hookPlugin, proxied],
    pluginLoading: "proxy",
    disabledCoreTools: [
      "task",
      "task_output",
      "kill_task",
      "list_tasks",
      "bash",
      "write",
      "edit",
      "glob",
      "grep",
      "todo_write",
      "skill",
    ],
    transformToolError: (error, context) => {
      toolErrors.push({ toolName: context.toolName, error });
      return error;
    },
    ...(options.gate ? { workflowExecutionGate: options.gate } : {}),
  });
  return {
    agent,
    script,
    toolErrors,
    protectedIo,
    toolBody,
    pluginBody,
    failureHook,
  };
}

/** Execute one tool the way the generation loop does (hooked tool set). */
async function run(
  target: {
    agent: ReturnType<typeof createAgent>;
    script: Script;
    toolErrors: Array<{ toolName: string; error: unknown }>;
  },
  name: string,
  input: unknown,
) {
  target.script.current = { name, input };
  target.toolErrors.length = 0;
  const result = await target.agent.generate({ prompt: "go" });
  const toolResults =
    result.status === "complete" ? result.steps.flatMap((step) => step.toolResults ?? []) : [];
  return { result, toolResults, toolErrors: [...target.toolErrors] };
}

function receiptsSink() {
  const receipts: WorkflowExecutionGateReceipt[] = [];
  return {
    receipts,
    onDecision: (receipt: WorkflowExecutionGateReceipt) => void receipts.push(receipt),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("workflow execution gate (LLE-12792)", () => {
  it.each(["generate", "streamDataResponse"] as const)(
    "refuses a no-execute tool before model invocation in %s",
    async (mode) => {
      const generate = vi.fn();
      const stream = vi.fn();
      const target = createAgent({
        model: new MockLanguageModelV3({
          doGenerate: generate,
          doStream: stream,
        }) as unknown as LanguageModel,
        tools: {
          external: tool({
            description: "client-side tool",
            inputSchema: z.object({}),
          }),
        },
        workflowExecutionGate: {
          version: 1,
          authorize: () => ({ decision: "allow" }),
        },
      });
      if (mode === "generate") {
        await expect(target.generate({ prompt: "go" })).rejects.toMatchObject({
          name: "WorkflowExecutionGateError",
          gateCode: "invalid",
          toolName: "external",
        });
      } else {
        const response = await target.streamDataResponse({ prompt: "go" });
        expect(await response.text()).toContain('"type":"error"');
      }
      expect(generate).not.toHaveBeenCalled();
      expect(stream).not.toHaveBeenCalled();
    },
  );

  it.each(["onInputStart", "onInputDelta", "onInputAvailable"] as const)(
    "rejects %s before model execution rather than leaving an ungated input callback",
    async (hook) => {
      const model = new MockLanguageModelV3({});
      const callback = vi.fn();
      const body = vi.fn(async () => "ran");
      const agent = createAgent({
        model: model as unknown as LanguageModel,
        tools: {
          custom: tool({ inputSchema: z.object({}), execute: body, [hook]: callback }),
        },
        workflowExecutionGate: { version: 1, authorize: () => ({ decision: "allow" }) },
      });
      await expect(agent.generate({ prompt: "go" })).rejects.toMatchObject({
        name: "WorkflowExecutionGateError",
        gateCode: "invalid",
      });
      expect(model.doGenerateCalls).toHaveLength(0);
      expect(callback).not.toHaveBeenCalled();
      expect(body).not.toHaveBeenCalled();
    },
  );

  it("is absent for ordinary agents: hooks and tools keep their existing semantics", async () => {
    const order: string[] = [];
    const target = setup({ hooksOrder: order });
    const { toolResults } = await run(target, "read", { path: "memory://a" });
    expect(target.protectedIo).toHaveBeenCalledTimes(1);
    expect(target.toolBody).toHaveBeenCalledTimes(1);
    expect(toolResults[0]?.output).toBe("read:memory://a");
  });

  it("rejects an unsupported gate contract at construction", () => {
    expect(() =>
      createAgent({
        model,
        workflowExecutionGate: {
          version: 2 as unknown as 1,
          authorize: () => ({ decision: "allow" }),
        },
      }),
    ).toThrow(/version must be 1/);
    expect(() =>
      createAgent({
        model,
        workflowExecutionGate: {
          version: 1,
          authorize: undefined as unknown as Gate["authorize"],
        },
      }),
    ).toThrow(/authorize must be a function/);
  });

  it("explicit denial runs no later hook, respondWith, tool body or failure hook", async () => {
    const order: string[] = [];
    const sink = receiptsSink();
    const target = setup({
      hooksOrder: order,
      hookPlugin: "respondWith",
      gate: {
        version: 1,
        authorize: (request: WorkflowExecutionGateRequest) => {
          order.push(`gate:${request.stage}`);
          return { decision: "deny", reason: "memory is off for this run" };
        },
        onDecision: sink.onDecision,
      },
    });
    const { toolErrors, toolResults } = await run(target, "read", {
      path: "memory://a",
    });
    expect(order).toEqual(["gate:pre-hook"]);
    expect(target.protectedIo).not.toHaveBeenCalled();
    expect(target.toolBody).not.toHaveBeenCalled();
    expect(target.failureHook).not.toHaveBeenCalled();
    expect(toolResults).toHaveLength(0);
    expect(toolErrors).toHaveLength(1);
    expect(String(toolErrors[0]?.error)).toMatch(/workflow execution gate/);
    expect(toolErrors[0]?.error).toMatchObject({ name: "ToolPermissionDeniedError" });
    expect(sink.receipts).toEqual([
      expect.objectContaining({
        toolName: "read",
        stage: "pre-hook",
        outcome: "deny",
        code: "denied",
      }),
    ]);
    expect(JSON.stringify(sink.receipts)).not.toContain("memory://a");
  });

  it("a thrown, rejected or malformed authority check fails closed, never allow", async () => {
    for (const authorize of [
      () => {
        throw new Error("synthetic-authority-unavailable");
      },
      () => Promise.reject(new Error("synthetic-authority-unavailable")),
      () => ({}) as unknown as { decision: "allow" },
      () => undefined as unknown as { decision: "allow" },
      () => ({ decision: "maybe" }) as unknown as { decision: "allow" },
    ]) {
      const order: string[] = [];
      const sink = receiptsSink();
      const target = setup({
        hooksOrder: order,
        gate: { version: 1, authorize, onDecision: sink.onDecision },
      });
      const { toolErrors } = await run(target, "read", { path: "memory://a" });
      expect(target.protectedIo).not.toHaveBeenCalled();
      expect(target.toolBody).not.toHaveBeenCalled();
      expect(toolErrors).toHaveLength(1);
      expect(toolErrors[0]?.error).toMatchObject({ name: "WorkflowExecutionGateError" });
      expect(sink.receipts[0]?.outcome).toBe("unavailable");
      expect(["unavailable", "invalid"]).toContain(sink.receipts[0]?.code);
    }
  });

  it("a timed-out authority check fails closed and a late allow cannot reopen the call", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const sink = receiptsSink();
    let lateResolve: ((value: { decision: "allow" }) => void) | undefined;
    let sawAbort = false;
    const target = setup({
      hooksOrder: order,
      gate: {
        version: 1,
        timeoutMs: 25,
        authorize: (request) =>
          new Promise((resolve) => {
            request.signal.addEventListener("abort", () => {
              sawAbort = true;
            });
            lateResolve = resolve;
          }),
        onDecision: sink.onDecision,
      },
    });
    const pending = run(target, "read", { path: "memory://a" });
    await vi.advanceTimersByTimeAsync(30);
    lateResolve?.({ decision: "allow" });
    await vi.runAllTimersAsync();
    const { toolErrors } = await pending;
    expect(sawAbort).toBe(true);
    expect(target.protectedIo).not.toHaveBeenCalled();
    expect(target.toolBody).not.toHaveBeenCalled();
    expect(toolErrors).toHaveLength(1);
    expect(sink.receipts).toEqual([
      expect.objectContaining({ outcome: "unavailable", code: "timeout" }),
    ]);
  });

  it("cancellation before the gate never starts the lookup; during it aborts and cancels", async () => {
    const before = new AbortController();
    before.abort(new Error("run cancelled"));
    const authorize = vi.fn(() => ({ decision: "allow" as const }));
    const sinkBefore = receiptsSink();
    const first = setup({
      hooksOrder: [],
      gate: {
        version: 1,
        authorize,
        signal: before.signal,
        onDecision: sinkBefore.onDecision,
      },
    });
    const { toolErrors } = await run(first, "read", { path: "memory://a" });
    expect(authorize).not.toHaveBeenCalled();
    expect(first.protectedIo).not.toHaveBeenCalled();
    expect(first.toolBody).not.toHaveBeenCalled();
    expect(toolErrors).toHaveLength(1);
    expect(sinkBefore.receipts[0]).toEqual(
      expect.objectContaining({ outcome: "cancelled", code: "cancelled" }),
    );

    const during = new AbortController();
    const sinkDuring = receiptsSink();
    let inner: AbortSignal | undefined;
    const second = setup({
      hooksOrder: [],
      gate: {
        version: 1,
        authorize: (request) =>
          new Promise((resolve) => {
            inner = request.signal;
            request.signal.addEventListener("abort", () => resolve({ decision: "allow" }));
          }),
        signal: during.signal,
        onDecision: sinkDuring.onDecision,
      },
    });
    const pending = run(second, "read", { path: "memory://a" });
    await vi.waitFor(() => expect(inner).toBeDefined());
    during.abort(new Error("run cancelled"));
    const outcome = await pending;
    expect(inner?.aborted).toBe(true);
    expect(second.protectedIo).not.toHaveBeenCalled();
    expect(second.toolBody).not.toHaveBeenCalled();
    expect(outcome.toolErrors).toHaveLength(1);
    expect(sinkDuring.receipts[0]).toEqual(
      expect.objectContaining({ outcome: "cancelled", code: "cancelled" }),
    );
  });

  it("allow continues existing hooks and tool body, and re-authorises a hook-transformed input", async () => {
    const order: string[] = [];
    const seen: Array<{ stage: string; input: unknown }> = [];
    const target = setup({
      hooksOrder: order,
      hookPlugin: "transform",
      gate: {
        version: 1,
        authorize: (request) => {
          order.push(`gate:${request.stage}`);
          seen.push({ stage: request.stage, input: request.toolInput });
          if (request.stage === "transformed-input") {
            return {
              decision: "deny",
              reason: "transformed target not allowed",
            };
          }
          return { decision: "allow" };
        },
      },
    });
    const { toolErrors } = await run(target, "read", { path: "memory://a" });
    expect(order).toEqual(["gate:pre-hook", "protected-hook", "gate:transformed-input"]);
    expect(seen[1]).toEqual({
      stage: "transformed-input",
      input: { path: "memory://transformed" },
    });
    // The transformed input was denied, so the body never ran with it.
    expect(target.protectedIo).toHaveBeenCalledTimes(1);
    expect(target.toolBody).not.toHaveBeenCalled();
    expect(toolErrors).toHaveLength(1);
  });

  it("allow with no transform executes the body exactly once", async () => {
    const order: string[] = [];
    const target = setup({
      hooksOrder: order,
      gate: { version: 1, authorize: () => ({ decision: "allow" }) },
    });
    const { toolResults } = await run(target, "read", { path: "ok" });
    expect(target.toolBody).toHaveBeenCalledTimes(1);
    expect(toolResults[0]?.output).toBe("read:ok");
  });

  it("gates call_tool on the resolved proxy target, not just the dispatcher", async () => {
    const stages: string[] = [];
    const target = setup({
      hooksOrder: [],
      gate: {
        version: 1,
        authorize: (request) => {
          stages.push(`${request.stage}:${request.toolName}`);
          return request.toolName === "crm__create_contact"
            ? { decision: "deny", reason: "not allowlisted" }
            : { decision: "allow" };
        },
      },
    });
    expect(Object.keys(target.agent.getActiveTools())).toContain("call_tool");
    const { toolErrors } = await run(target, "call_tool", {
      tool_name: "crm__create_contact",
      arguments: { name: "x" },
    });
    expect(stages).toEqual(["pre-hook:call_tool", "proxy-target:crm__create_contact"]);
    expect(target.pluginBody).not.toHaveBeenCalled();
    expect(target.protectedIo).not.toHaveBeenCalled();
    expect(toolErrors).toHaveLength(1);
  });

  it("covers runtime-added tools and the streaming tool set", async () => {
    const authorize = vi.fn(() => ({
      decision: "deny" as const,
      reason: "no",
    }));
    const target = setup({ hooksOrder: [], gate: { version: 1, authorize } });
    const runtimeBody = vi.fn(async () => "ran");
    target.agent.addRuntimeTools({
      later: tool({
        description: "runtime",
        inputSchema: z.object({}),
        execute: runtimeBody,
      }),
    });
    const { toolErrors } = await run(target, "later", {});
    expect(runtimeBody).not.toHaveBeenCalled();
    expect(toolErrors).toHaveLength(1);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "later", stage: "pre-hook" }),
    );

    // Streaming path applies the same outermost gate.
    target.script.current = { name: "later", input: {} };
    target.toolErrors.length = 0;
    const parts: string[] = [];
    for await (const part of target.agent.stream({ prompt: "go" })) {
      parts.push(part.type);
    }
    expect(runtimeBody).not.toHaveBeenCalled();
    expect(target.toolErrors).toHaveLength(1);
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it("rechecks a hook-replaced proxy target even when the dispatcher is allowed", async () => {
    const requests: WorkflowExecutionGateRequest[] = [];
    const target = setup({
      hooksOrder: [],
      hookPlugin: "transform-proxy",
      gate: {
        version: 1,
        authorize: (request) => {
          requests.push(request);
          return request.toolName === "crm__create_contact"
            ? { decision: "deny" }
            : { decision: "allow" };
        },
      },
    });
    await run(target, "call_tool", {
      tool_name: "crm__lookup_contact",
      arguments: { name: "original" },
    });
    expect(requests.map(({ stage, toolName }) => `${stage}:${toolName}`)).toEqual([
      "pre-hook:call_tool",
      "proxy-target:crm__lookup_contact",
      "transformed-input:call_tool",
      "proxy-target:crm__create_contact",
    ]);
    expect(requests.at(-1)?.toolInput).toEqual({ name: "changed" });
    expect(target.pluginBody).not.toHaveBeenCalled();
    expect(target.failureHook).not.toHaveBeenCalled();
  });

  it.each(["generate", "stream", "streamRaw", "streamResponse", "streamDataResponse"] as const)(
    "blocks protected hooks and bodies in %s",
    async (mode) => {
      const authorize = vi.fn(() => ({ decision: "deny" as const }));
      const target = setup({ hooksOrder: [], gate: { version: 1, authorize } });
      target.script.current = { name: "read", input: { path: "private" } };
      if (mode === "stream") {
        for await (const _part of target.agent.stream({ prompt: "go" })) {
          /* consume */
        }
      } else if (mode === "streamRaw") {
        const result = await target.agent.streamRaw({ prompt: "go" });
        await result.text;
      } else if (mode === "generate") {
        await target.agent.generate({ prompt: "go" });
      } else {
        const response = await target.agent[mode]({ prompt: "go" });
        await response.text();
      }
      expect(authorize).toHaveBeenCalledTimes(1);
      expect(target.protectedIo).not.toHaveBeenCalled();
      expect(target.toolBody).not.toHaveBeenCalled();
      expect(target.failureHook).not.toHaveBeenCalled();
    },
  );

  it.each(["canUseTool", "needsApproval"] as const)(
    "authorises before the AI SDK calls %s during approval discovery",
    async (callback) => {
      const permission = vi.fn(async () => "allow" as const);
      const approval = vi.fn(async () => false);
      const target = setup({
        hooksOrder: [],
        ...(callback === "canUseTool" ? { canUseTool: permission } : { needsApproval: approval }),
        gate: { version: 1, authorize: () => ({ decision: "deny" }) },
      });
      // AI SDK approval callback failures reject generation, not emit tool-error.
      await expect(run(target, "read", { path: "private" })).rejects.toMatchObject({
        name: "ToolPermissionDeniedError",
      });
      expect(permission).not.toHaveBeenCalled();
      expect(approval).not.toHaveBeenCalled();
      expect(target.protectedIo).not.toHaveBeenCalled();
      expect(target.toolBody).not.toHaveBeenCalled();
    },
  );

  it.each(
    (["stream", "streamRaw", "streamResponse", "streamDataResponse"] as const).flatMap((mode) =>
      (["canUseTool", "needsApproval"] as const).map((callback) => ({ mode, callback })),
    ),
  )("authorises before $callback in $mode", async ({ mode, callback }) => {
    const permission = vi.fn(async () => "allow" as const);
    const approval = vi.fn(async () => false);
    const authorize = vi.fn(() => ({ decision: "deny" as const }));
    const target = setup({
      hooksOrder: [],
      ...(callback === "canUseTool" ? { canUseTool: permission } : { needsApproval: approval }),
      gate: { version: 1, authorize },
    });
    target.script.current = { name: "read", input: { path: "private" } };
    try {
      if (mode === "stream") {
        for await (const _part of target.agent.stream({ prompt: "go" })) {
          /* consume */
        }
      } else if (mode === "streamRaw") {
        const result = await target.agent.streamRaw({ prompt: "go" });
        await result.text;
      } else {
        const response = await target.agent[mode]({ prompt: "go" });
        await response.text();
      }
    } catch {
      // Modes expose approval errors through either rejection or an error part.
    }
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "read", stage: "pre-hook" }),
    );
    expect(permission).not.toHaveBeenCalled();
    expect(approval).not.toHaveBeenCalled();
    expect(target.protectedIo).not.toHaveBeenCalled();
    expect(target.toolBody).not.toHaveBeenCalled();
  });

  it("rechecks cancellation after an awaited execution permission callback", async () => {
    const controller = new AbortController();
    let checks = 0;
    const permission = vi.fn(async () => {
      // First lookup is needsApproval; second is inside execute after tool hooks.
      if (++checks === 2) controller.abort(new Error("run cancelled during permission check"));
      return "allow" as const;
    });
    const target = setup({
      hooksOrder: [],
      canUseTool: permission,
      gate: { version: 1, signal: controller.signal, authorize: () => ({ decision: "allow" }) },
    });
    await run(target, "read", { path: "private" }).catch(() => undefined);
    expect(permission).toHaveBeenCalledTimes(2);
    expect(target.toolBody).not.toHaveBeenCalled();
  });

  it("keeps permission callbacks in order with fresh authority at execution", async () => {
    const order: string[] = [];
    const target = setup({
      hooksOrder: order,
      canUseTool: async () => {
        order.push("permission");
        return "allow";
      },
      gate: {
        version: 1,
        authorize: () => {
          order.push("gate");
          return { decision: "allow" };
        },
      },
    });
    target.toolBody.mockImplementation(async () => {
      order.push("body");
      return "read";
    });
    await run(target, "read", { path: "private" });
    expect(order).toEqual(["gate", "permission", "gate", "protected-hook", "permission", "body"]);
  });

  it("cancels approval lookup with the request signal even without a gate-level signal", async () => {
    const controller = new AbortController();
    const approval = vi.fn(async () => false);
    let started: () => void = () => {
      throw new Error("not initialised");
    };
    const lookupStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finishLookup: (decision: { decision: "allow" }) => void = () => {
      throw new Error("not started");
    };
    let lookupSignal: AbortSignal | undefined;
    const target = setup({
      hooksOrder: [],
      needsApproval: approval,
      gate: {
        version: 1,
        authorize: ({ signal }) => {
          lookupSignal = signal;
          started();
          return new Promise((resolve) => {
            finishLookup = resolve;
          });
        },
      },
    });
    target.script.current = { name: "read", input: { path: "private" } };
    const pending = target.agent.generate({ prompt: "go", signal: controller.signal });
    const assertion = expect(pending).rejects.toBeDefined();
    await lookupStarted;
    controller.abort(new Error("request cancelled"));
    finishLookup({ decision: "allow" });
    await assertion;
    expect(lookupSignal?.aborted).toBe(true);
    expect(approval).not.toHaveBeenCalled();
    expect(target.toolBody).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "inherits subagent authority independently of hooks (explicit override: %s)",
    async (override) => {
      const inherited = vi.fn(() => ({ decision: "deny" as const }));
      const explicit = vi.fn(() => ({ decision: "allow" as const }));
      const parent = createAgent({
        model,
        workflowExecutionGate: { version: 1, authorize: inherited },
      });
      const body = vi.fn(async () => "read");
      const child = createSubagent(parent, {
        name: "reader",
        description: "read a file",
        inheritHooks: false,
        model: scriptedModel({ current: { name: "read", input: { path: "private" } } }),
        tools: { read: tool({ inputSchema: z.object({ path: z.string() }), execute: body }) },
        ...(override
          ? { workflowExecutionGate: { version: 1 as const, authorize: explicit } }
          : {}),
      });
      await child.generate({ prompt: "go" });
      expect(inherited).toHaveBeenCalledTimes(override ? 0 : 1);
      expect(explicit).toHaveBeenCalledTimes(override ? 1 : 0);
      expect(body).toHaveBeenCalledTimes(override ? 1 : 0);
    },
  );

  it("the built-in general-purpose task child inherits the parent's gate", async () => {
    const script: Script = {
      current: {
        name: "task",
        input: { description: "Read a file", subagent_type: "general-purpose" },
      },
    };
    const childIo = vi.fn();
    const authorize = vi.fn((request: WorkflowExecutionGateRequest) => {
      if (request.toolName === "task") {
        script.current = { name: "read", input: { file_path: "/private" } };
        return { decision: "allow" as const };
      }
      return { decision: "deny" as const };
    });
    const agent = createAgent({
      model: scriptedModel(script),
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (input) => {
                if (input.hook_event_name === "PreToolUse" && input.tool_name === "read") childIo();
              },
            ],
          },
        ],
      },
      workflowExecutionGate: { version: 1, authorize },
    });
    await agent.generate({ prompt: "Delegate this" });
    expect(authorize.mock.calls.map(([request]) => request.toolName)).toEqual(["task", "read"]);
    expect(childIo).not.toHaveBeenCalled();
  });

  it.each(["resume", "resumeDataResponse"] as const)(
    "rejects gated %s before loading or running raw tools/resolution hooks",
    async (mode) => {
      const load = vi.fn();
      const resolved = vi.fn();
      const agent = createAgent({
        model,
        workflowExecutionGate: { version: 1, authorize: () => ({ decision: "allow" }) },
        checkpointer: {
          load,
          save: vi.fn(),
          delete: vi.fn(),
          exists: vi.fn(),
          list: vi.fn(),
        },
        hooks: { InterruptResolved: [resolved] },
      });
      await expect(agent[mode]("thread", "interrupt", { approved: true })).rejects.toMatchObject({
        name: "ConfigurationError",
      });
      expect(load).not.toHaveBeenCalled();
      expect(resolved).not.toHaveBeenCalled();
    },
  );
});
