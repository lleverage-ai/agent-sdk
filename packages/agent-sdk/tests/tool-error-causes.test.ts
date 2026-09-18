import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { InvalidToolInputError, NoSuchToolError, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../src/agent.js";
import type { LanguageModel, StreamPart } from "../src/types.js";

/**
 * AI SDK 7 emits an invalid `tool-call` (unparsable input / unknown tool) that
 * carries the structured cause, immediately followed by a `tool-error` whose
 * `error` has been flattened to a string. These tests pin the SDK's restoration
 * of the structured cause for that adjacent, identity-matched pair only.
 */

const usage = {
  inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

interface Call {
  id: string;
  name: string;
  input: string;
}

async function runFixture(calls: Call[], crash?: unknown, transform = true) {
  let modelCalls = 0;
  const execute = vi.fn(async () => {
    if (crash !== undefined) throw crash;
    return "stored";
  });
  const model = new MockLanguageModelV3({
    doStream: async () => {
      modelCalls++;
      const first = modelCalls === 1;
      const parts: LanguageModelV3StreamPart[] = first
        ? calls.map((call) => ({
            type: "tool-call",
            toolCallId: call.id,
            toolName: call.name,
            input: call.input,
          }))
        : [
            { type: "text-start", id: "answer" },
            { type: "text-delta", id: "answer", delta: "Finished." },
            { type: "text-end", id: "answer" },
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
    model: model as LanguageModel,
    systemPrompt: "Synthetic tool-error fixture.",
    transformToolError: transform ? (error) => new Error("sanitised", { cause: error }) : undefined,
    tools: {
      remember: tool({
        description: "Stores a synthetic memory",
        inputSchema: z.object({ content: z.string() }),
        execute,
      }),
    },
  });
  const parts: StreamPart[] = [];
  for await (const part of agent.stream({ prompt: "Run the synthetic tool calls." })) {
    parts.push(part);
  }
  const errors = parts.filter(
    (part): part is Extract<StreamPart, { type: "tool-error" }> => part.type === "tool-error",
  );
  return { execute, errors, parts, modelCalls };
}

const malformedInput = '{"content":"He said "hello" today"}';

/** Walk `.cause` (bounded) looking for an instance of `cls`. */
function findCause<T>(error: unknown, cls: new (...args: never[]) => T): T | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (current instanceof cls) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

describe("tool-error cause restoration", () => {
  it.each([
    ["malformed JSON", malformedInput, InvalidToolInputError],
    ["schema-invalid input", '{"content":42}', InvalidToolInputError],
  ])("restores the structured cause for %s without executing the tool", async (_n, input, cls) => {
    const result = await runFixture([{ id: "invalid", name: "remember", input }]);
    expect(result.execute).not.toHaveBeenCalled();
    expect(result.errors).toHaveLength(1);
    // The structured cause survives as the stream part's error. It is wrapped
    // by the AI SDK's repair error and the host's transformToolError result,
    // so the class is found on the cause chain rather than the top level.
    expect(typeof result.errors[0]?.error).not.toBe("string");
    expect(findCause(result.errors[0]?.error, cls)).toBeDefined();
    expect(result.modelCalls).toBe(2);
  });

  it("restores NoSuchToolError for an unknown tool", async () => {
    const result = await runFixture([{ id: "unknown", name: "missing_tool", input: "{}" }]);
    expect(result.execute).not.toHaveBeenCalled();
    expect(findCause(result.errors[0]?.error, NoSuchToolError)).toBeDefined();
  });

  it("restores the raw AI SDK error when no transformToolError is configured", async () => {
    const result = await runFixture(
      [{ id: "invalid", name: "remember", input: malformedInput }],
      undefined,
      false,
    );
    expect(result.errors[0]?.error).toBeInstanceOf(InvalidToolInputError);
  });

  it("keeps separate validation failures distinct around a successful call", async () => {
    const result = await runFixture([
      { id: "json", name: "remember", input: malformedInput },
      { id: "valid", name: "remember", input: '{"content":"Synthetic fact"}' },
      { id: "schema", name: "remember", input: '{"content":42}' },
    ]);
    expect(result.execute).toHaveBeenCalledTimes(1);
    expect(result.errors.map((part) => part.toolCallId)).toEqual(["json", "schema"]);
    for (const part of result.errors) {
      expect(findCause(part.error, InvalidToolInputError)).toBeDefined();
    }
    expect(result.parts.filter((part) => part.type === "tool-result")).toHaveLength(1);
  });

  it("does not replace a later execution failure with an earlier validation cause", async () => {
    const crash = new TypeError("Unexpected synthetic database failure");
    const result = await runFixture(
      [
        { id: "invalid", name: "remember", input: malformedInput },
        { id: "crash", name: "remember", input: '{"content":"Synthetic fact"}' },
      ],
      crash,
    );
    expect(result.execute).toHaveBeenCalledTimes(1);
    expect(result.errors.map((part) => part.toolCallId)).toEqual(["invalid", "crash"]);
    expect(findCause(result.errors[0]?.error, InvalidToolInputError)).toBeDefined();
    // Execution rejections pass through transformToolError; the cause must be
    // the real crash, never the earlier validation error.
    const executionError = result.errors[1]?.error as Error;
    expect(findCause(executionError, InvalidToolInputError)).toBeUndefined();
    expect(findCause(executionError, TypeError)).toBe(crash);
  });

  it("does not trust an execution error string that impersonates a validation error", async () => {
    const result = await runFixture(
      [{ id: "spoof", name: "remember", input: '{"content":"Synthetic fact"}' }],
      "AI_InvalidToolInputError: secret=synthetic-private-value",
      false,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error).not.toBeInstanceOf(InvalidToolInputError);
    expect(result.errors[0]?.error).toBe(
      "AI_InvalidToolInputError: secret=synthetic-private-value",
    );
  });

  it("isolates concurrent streams even when call identifiers are reused", async () => {
    const [invalid, crash] = await Promise.all([
      runFixture([{ id: "same", name: "remember", input: malformedInput }]),
      runFixture(
        [{ id: "same", name: "remember", input: '{"content":"Synthetic fact"}' }],
        new Error("Unknown crash"),
      ),
    ]);
    expect(findCause(invalid.errors[0]?.error, InvalidToolInputError)).toBeDefined();
    expect(findCause(crash.errors[0]?.error, InvalidToolInputError)).toBeUndefined();
  });
});
