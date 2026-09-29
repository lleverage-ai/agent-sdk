/**
 * `call_tool` result formatting.
 *
 * Proxied results stay in the conversation for every later model call, so
 * object and array results are serialised as compact JSON: indentation adds
 * bytes but no information. Strings pass through unchanged, primitives and
 * `null` keep their `JSON.stringify` form, unserialisable results fall back to
 * `String(result)`, and the error and interrupt paths are untouched.
 */

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { InterruptSignal } from "../src/agent/tool-pipeline.js";
import { createAgent } from "../src/agent.js";
import { MCPManager } from "../src/mcp/manager.js";
import { definePlugin } from "../src/plugins.js";
import { createCallToolTool } from "../src/tools/call-tool.js";
import type { LanguageModel } from "../src/types.js";

const execOpts = {
  toolCallId: "tc-1",
  messages: [],
  abortSignal: undefined as unknown as AbortSignal,
};

const nested = {
  id: "inv_123",
  total: 42.5,
  paid: false,
  customer: null,
  lines: [
    { sku: "A-1", qty: 2, tags: [] },
    { sku: "B-2", qty: 1, tags: ["gift"] },
  ],
  meta: {},
};

const tricky = {
  quote: 'say "hi"',
  backslash: "C:\\temp\\file",
  controls: "line1\nline2\ttab\r\u0000\u001f",
  separators: "a\u2028b\u2029c",
  unicode: "café 日本語 🚀 👩‍👩‍👧",
  loneSurrogate: "\ud800",
  html: "</script><!--",
  "key with spaces": "ok",
};

/** Runs `call_tool` against a deferred tool that returns `value`. */
async function callWithResult(value: unknown): Promise<unknown> {
  const manager = new MCPManager();
  manager.registerPluginTools(
    "fixture",
    {
      get: tool({
        description: "Return a fixed value",
        inputSchema: z.object({}),
        execute: async () => value,
      }),
    },
    { autoLoad: false },
  );
  const callTool = createCallToolTool({ mcpManager: manager });
  return callTool.execute!({ tool_name: "fixture__get", arguments: {} }, execOpts);
}

describe("call_tool result formatting", () => {
  it("serialises objects as compact JSON", async () => {
    const result = await callWithResult(nested);
    expect(result).toBe(
      '{"id":"inv_123","total":42.5,"paid":false,"customer":null,"lines":[{"sku":"A-1","qty":2,"tags":[]},{"sku":"B-2","qty":1,"tags":["gift"]}],"meta":{}}',
    );
    expect(JSON.parse(result as string)).toEqual(nested);
  });

  it("serialises arrays as compact JSON", async () => {
    const value = [1, "two", { three: [3] }, null, true];
    const result = await callWithResult(value);
    expect(result).toBe('[1,"two",{"three":[3]},null,true]');
    expect(JSON.parse(result as string)).toEqual(value);
  });

  it("keeps the same data as the previous pretty-printed output", async () => {
    for (const value of [nested, tricky, [nested, tricky], { deep: { deeper: [[[]]] } }]) {
      const result = (await callWithResult(value)) as string;
      expect(result).not.toContain("\n");
      expect(JSON.parse(result)).toEqual(JSON.parse(JSON.stringify(value, null, 2)));
      expect(JSON.parse(result)).toEqual(value);
    }
  });

  it("escapes and round-trips Unicode, quotes and control characters", async () => {
    const result = (await callWithResult(tricky)) as string;
    // Whitespace inside string values is escaped, so no raw newline survives.
    expect(result).not.toMatch(/[\n\r\t]/);
    expect(result).toContain('\\"hi\\"');
    expect(result).toContain("C:\\\\temp\\\\file");
    expect(result).toContain("\\u0000\\u001f");
    // Non-ASCII text is emitted as-is, not \u-escaped.
    expect(result).toContain("café 日本語 🚀 👩‍👩‍👧");
    // Lone surrogates are escaped, so the output stays well-formed UTF-16.
    expect(result).toContain("\\ud800");
    expect(result.isWellFormed()).toBe(true);
    expect(JSON.parse(result)).toEqual(tricky);
  });

  it("passes string results through unchanged, even when they look like JSON", async () => {
    const pretty = JSON.stringify(nested, null, 2);
    expect(await callWithResult(pretty)).toBe(pretty);
    expect(await callWithResult("plain text\nwith lines")).toBe("plain text\nwith lines");
    expect(await callWithResult("")).toBe("");
  });

  it("keeps the JSON form of primitives and null", async () => {
    expect(await callWithResult(42)).toBe("42");
    expect(await callWithResult(0)).toBe("0");
    expect(await callWithResult(true)).toBe("true");
    expect(await callWithResult(null)).toBe("null");
    expect(await callWithResult(Number.NaN)).toBe("null");
    expect(await callWithResult(undefined)).toBeUndefined();
  });

  it("applies toJSON and omits undefined properties as before", async () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    expect(await callWithResult({ at: date, skip: undefined, fn: () => 1 })).toBe(
      '{"at":"2026-01-02T03:04:05.000Z"}',
    );
  });

  it("falls back to String(result) when serialisation fails", async () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    expect(await callWithResult(circular)).toBe("[object Object]");
    expect(await callWithResult(10n)).toBe("10");
    expect(await callWithResult({ big: 1n, toString: () => "custom" })).toBe("custom");
  });

  it("keeps the exact error text when the proxied tool throws", async () => {
    const manager = new MCPManager();
    manager.registerPluginTools(
      "fixture",
      {
        fail: tool({
          description: "Always fails",
          inputSchema: z.object({}),
          execute: async () => {
            throw new Error("boom");
          },
        }),
      },
      { autoLoad: false },
    );
    const callTool = createCallToolTool({ mcpManager: manager });
    const result = await callTool.execute!({ tool_name: "fixture__fail", arguments: {} }, execOpts);
    expect(result).toBe('Error executing "fixture__fail": boom');
  });

  it("propagates interrupt signals instead of formatting them", async () => {
    const signal = new InterruptSignal({
      id: "int-1",
      threadId: "t",
      type: "approval",
      toolCallId: "tc-1",
      toolName: "fixture__ask",
      request: {},
      step: 0,
      createdAt: new Date().toISOString(),
    } as ConstructorParameters<typeof InterruptSignal>[0]);
    const manager = new MCPManager();
    manager.registerPluginTools(
      "fixture",
      {
        ask: tool({
          description: "Interrupts",
          inputSchema: z.object({}),
          execute: async () => {
            throw signal;
          },
        }),
      },
      { autoLoad: false },
    );
    const callTool = createCallToolTool({ mcpManager: manager });
    await expect(
      callTool.execute!({ tool_name: "fixture__ask", arguments: {} }, execOpts),
    ).rejects.toBe(signal);
  });
});

describe("call_tool result in the next model call", () => {
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };

  it("sends the compact JSON result to the model as the tool output", async () => {
    const prompts: LanguageModelV3CallOptions["prompt"][] = [];
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        prompts.push(options.prompt);
        return prompts.length === 1
          ? {
              content: [
                {
                  type: "tool-call" as const,
                  toolCallId: "call-1",
                  toolName: "call_tool",
                  input: JSON.stringify({ tool_name: "billing__get_invoice", arguments: {} }),
                },
              ],
              finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
              usage,
              warnings: [],
            }
          : {
              content: [{ type: "text" as const, text: "done" }],
              finishReason: { unified: "stop" as const, raw: "stop" },
              usage,
              warnings: [],
            };
      },
    });
    const value = { ...nested, note: tricky };
    const agent = createAgent({
      model: model as LanguageModel,
      systemPrompt: "Result format fixture.",
      pluginLoading: "proxy",
      plugins: [
        definePlugin({
          name: "billing",
          tools: {
            get_invoice: tool({
              description: "Get an invoice",
              inputSchema: z.object({}),
              execute: async () => value,
            }),
          },
        }),
      ],
    });

    const result = await agent.generate({ prompt: "Fetch the invoice." });

    expect(result.status).toBe("complete");
    expect(prompts).toHaveLength(2);
    const toolMessage = prompts[1]?.find((message) => message.role === "tool");
    const toolResult = toolMessage?.content.find((part) => part.type === "tool-result");
    expect(toolResult).toMatchObject({ toolCallId: "call-1", toolName: "call_tool" });
    expect(toolResult?.output).toEqual({ type: "text", value: JSON.stringify(value) });
    const sent = (toolResult?.output as { value: string } | undefined)?.value ?? "";
    expect(sent).not.toContain("\n");
    expect(JSON.parse(sent)).toEqual(value);
  });
});
