import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../src/agent.js";
import { chainPostToolUseHooks } from "../src/hooks.js";
import type { HookCallback, HookCallbackContext, HookInput, LanguageModel } from "../src/types.js";

// M13: sequential PostToolUse transform composition. Side-by-side PostToolUse
// hooks all see the original tool_response and only the first updatedResult
// wins; the chain threads each transform into the next.

const usage = {
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokenDetails: { reasoningTokens: 0 },
};

function postToolUse(toolResponse: unknown, overrides: Partial<HookInput> = {}): HookInput {
  return {
    hook_event_name: "PostToolUse",
    session_id: "s",
    cwd: "/",
    tool_name: "bash",
    tool_input: {},
    tool_response: toolResponse,
    ...overrides,
  } as HookInput;
}

const context = { signal: new AbortController().signal } as unknown as HookCallbackContext;

/** A transform that appends `suffix` to the string it is handed. */
function appending(suffix: string, seen?: unknown[]): HookCallback {
  return (input) => {
    if (input.hook_event_name !== "PostToolUse") return undefined;
    seen?.push(input.tool_response);
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedResult: `${String(input.tool_response)}${suffix}`,
      },
    };
  };
}

describe("chainPostToolUseHooks", () => {
  it("threads each transform into the next callback's tool_response", async () => {
    const seenByFirst: unknown[] = [];
    const seenBySecond: unknown[] = [];
    const chain = chainPostToolUseHooks([
      appending("+first", seenByFirst),
      appending("+second", seenBySecond),
    ]);

    const result = await chain(postToolUse("base"), "call-1", context);

    expect(result?.hookSpecificOutput?.updatedResult).toBe("base+first+second");
    expect(seenByFirst).toEqual(["base"]);
    expect(seenBySecond).toEqual(["base+first"]);
  });

  it("skips no-op callbacks without losing earlier transforms", async () => {
    const noop: HookCallback = () => undefined;
    const emptyOutput: HookCallback = () => ({});
    const explicitUndefined: HookCallback = () => ({
      hookSpecificOutput: { hookEventName: "PostToolUse", updatedResult: undefined },
    });
    const chain = chainPostToolUseHooks([
      appending("+a"),
      noop,
      emptyOutput,
      explicitUndefined,
      appending("+b"),
    ]);

    const result = await chain(postToolUse("base"), "call-1", context);

    expect(result?.hookSpecificOutput?.updatedResult).toBe("base+a+b");
  });

  it("returns undefined when no callback transforms", async () => {
    const chain = chainPostToolUseHooks([() => undefined, () => ({})]);
    expect(await chain(postToolUse("out"), "call-1", context)).toBeUndefined();
  });

  it("returns undefined for an empty chain", async () => {
    expect(await chainPostToolUseHooks([])(postToolUse("out"), "call-1", context)).toBeUndefined();
  });

  it("ignores events other than PostToolUse", async () => {
    const inner = vi.fn(() => ({
      hookSpecificOutput: { hookEventName: "PostToolUse" as const, updatedResult: "no" },
    }));
    const chain = chainPostToolUseHooks([inner]);
    const result = await chain({ hook_event_name: "PreGenerate" } as HookInput, null, context);
    expect(result).toBeUndefined();
    expect(inner).not.toHaveBeenCalled();
  });

  it("passes toolUseId, context and every other input field through unchanged", async () => {
    const calls: Array<{ input: HookInput; toolUseId: string | null; context: unknown }> = [];
    const spy: HookCallback = (input, toolUseId, ctx) => {
      calls.push({ input, toolUseId, context: ctx });
      return undefined;
    };
    const chain = chainPostToolUseHooks([spy, appending("+x"), spy]);
    const input = postToolUse("base", { tool_result_synthetic: true } as Partial<HookInput>);

    await chain(input, "call-9", context);

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.toolUseId).toBe("call-9");
      expect(call.context).toBe(context);
      expect(call.input).toMatchObject({
        hook_event_name: "PostToolUse",
        tool_name: "bash",
        tool_result_synthetic: true,
      });
    }
    expect((calls[0]!.input as { tool_response: unknown }).tool_response).toBe("base");
    expect((calls[1]!.input as { tool_response: unknown }).tool_response).toBe("base+x");
  });

  it("awaits async callbacks in order", async () => {
    const order: string[] = [];
    const slow: HookCallback = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("slow");
      return {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          updatedResult: `${String((input as { tool_response: unknown }).tool_response)}+slow`,
        },
      };
    };
    const fast: HookCallback = (input) => {
      order.push("fast");
      return {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          updatedResult: `${String((input as { tool_response: unknown }).tool_response)}+fast`,
        },
      };
    };

    const result = await chainPostToolUseHooks([slow, fast])(postToolUse("b"), "c", context);

    expect(order).toEqual(["slow", "fast"]);
    expect(result?.hookSpecificOutput?.updatedResult).toBe("b+slow+fast");
  });

  it("does not merge other output fields from inner callbacks", async () => {
    const withSystemMessage: HookCallback = () => ({
      systemMessage: "note",
      hookSpecificOutput: { hookEventName: "PostToolUse", updatedResult: "t" },
    });
    const result = await chainPostToolUseHooks([withSystemMessage])(postToolUse("b"), "c", context);
    expect(result).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", updatedResult: "t" },
    });
  });

  it("propagates a callback's rejection", async () => {
    const boom: HookCallback = () => {
      throw new Error("boom");
    };
    await expect(
      chainPostToolUseHooks([appending("+a"), boom])(postToolUse("b"), "c", context),
    ).rejects.toThrow("boom");
  });
});

describe("chainPostToolUseHooks through the agent tool pipeline", () => {
  function fixture(hooks: NonNullable<Parameters<typeof createAgent>[0]["hooks"]>) {
    let requests = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        requests++;
        const first = requests === 1;
        const parts: LanguageModelV3StreamPart[] = first
          ? [{ type: "tool-call", toolCallId: "c1", toolName: "run", input: "{}" }]
          : [
              { type: "text-start", id: "a" },
              { type: "text-delta", id: "a", delta: "Done." },
              { type: "text-end", id: "a" },
            ];
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              for (const part of parts) controller.enqueue(part);
              controller.enqueue({
                type: "finish",
                finishReason: {
                  unified: first ? "tool-calls" : "stop",
                  raw: first ? "tool_calls" : "stop",
                },
                usage,
              });
              controller.close();
            },
          }),
        };
      },
    });
    const agent = createAgent({
      model: model as unknown as LanguageModel,
      tools: {
        run: tool({
          description: "run",
          inputSchema: z.object({}),
          execute: async () => "a".repeat(100),
        }),
      },
      hooks,
    });
    return async () => {
      const outputs: unknown[] = [];
      for await (const part of agent.stream({ prompt: "go" })) {
        if (part.type === "tool-result") outputs.push(part.output);
      }
      return outputs;
    };
  }

  const cap: HookCallback = (input) => {
    if (input.hook_event_name !== "PostToolUse") return undefined;
    const text = String(input.tool_response);
    if (text.length <= 10) return undefined;
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedResult: `${text.slice(0, 10)}…[capped]`,
      },
    };
  };
  const notice: HookCallback = (input) => {
    if (input.hook_event_name !== "PostToolUse") return undefined;
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedResult: `${String(input.tool_response)}\n[notice]`,
      },
    };
  };

  it("delivers both the cap and the notice on one oversized result", async () => {
    const run = fixture({ PostToolUse: [{ callback: chainPostToolUseHooks([cap, notice]) }] });
    const outputs = await run();
    expect(outputs).toEqual([`${"a".repeat(10)}…[capped]\n[notice]`]);
  });

  it("side-by-side registration keeps only the first transform (unchanged SDK behaviour)", async () => {
    // Documents the behaviour the chain exists to work around. Not a target;
    // changing it would alter every existing multi-hook registration.
    const run = fixture({ PostToolUse: [{ callback: cap }, { callback: notice }] });
    const outputs = await run();
    expect(outputs).toEqual([`${"a".repeat(10)}…[capped]`]);
  });

  it("leaves the tool output untouched when no chained callback transforms", async () => {
    const run = fixture({
      PostToolUse: [{ callback: chainPostToolUseHooks([() => undefined, () => ({})]) }],
    });
    const outputs = await run();
    expect(outputs).toEqual(["a".repeat(100)]);
  });
});
