import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../src/agent.js";
import { ConfigurationError } from "../src/errors/index.js";
import { createSubagent, definePlugin } from "../src/index.js";
import type {
  ExtendedToolExecutionOptions,
  LanguageModel,
  StreamingContext,
  StreamingWriter,
} from "../src/types.js";

// Request-local streaming context on the non-data-response modes (M12).
//
// Production hosts run every turn through `agent.stream()`, but until now only
// `streamDataResponse()` handed plugin tools a writer. These tests drive a real
// `MockLanguageModelV3` through the full tool pipeline (no `streamText` mock),
// so the writer a tool sees is the one the wrapped pipeline actually injected.

const usage = {
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokenDetails: { reasoningTokens: 0 },
};

interface ToolCallSpec {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * A model that emits `calls` on its first request and a short text answer on
 * every later one. `gate` (when given) delays the first response until it
 * resolves, so two concurrent generations can be interleaved on purpose.
 */
function toolCallingModel(calls: ToolCallSpec[], gate?: Promise<void>): LanguageModel {
  let requests = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      requests++;
      const first = requests === 1;
      if (first && gate) await gate;
      return {
        content: first
          ? calls.map((call) => ({
              type: "tool-call" as const,
              toolCallId: call.id,
              toolName: call.name,
              input: JSON.stringify(call.input),
            }))
          : [{ type: "text" as const, text: "Finished." }],
        finishReason: {
          unified: first ? "tool-calls" : "stop",
          raw: first ? "tool_calls" : "stop",
        },
        usage,
        warnings: [],
      } as never;
    },
    doStream: async () => {
      requests++;
      const first = requests === 1;
      if (first && gate) await gate;
      const parts: LanguageModelV3StreamPart[] = first
        ? calls.map((call) => ({
            type: "tool-call",
            toolCallId: call.id,
            toolName: call.name,
            input: JSON.stringify(call.input),
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
  return model as unknown as LanguageModel;
}

function recordingWriter(label: string): StreamingWriter & { parts: unknown[]; label: string } {
  const parts: unknown[] = [];
  return {
    label,
    parts,
    write: (part) => {
      parts.push(part);
    },
  };
}

/** A plugin whose factory-built tool writes a widget through `ctx.writer`. */
function widgetPlugin(seen: Array<StreamingWriter | null>) {
  return definePlugin({
    name: "widgets",
    description: "Writes a widget through the request writer",
    tools: (ctx: StreamingContext) => ({
      show: tool({
        description: "Show a widget",
        inputSchema: z.object({ label: z.string() }),
        execute: async ({ label }) => {
          seen.push(ctx.writer);
          ctx.writer?.write({ type: "data-widget", data: { label } });
          return `shown:${label}`;
        },
      }),
    }),
  });
}

async function drain(gen: AsyncIterable<unknown>): Promise<unknown[]> {
  const parts: unknown[] = [];
  for await (const part of gen) parts.push(part);
  return parts;
}

describe("GenerateOptions.streamingContext", () => {
  it("hands the caller's writer to plugin factory tools during stream()", async () => {
    const seen: Array<StreamingWriter | null> = [];
    const writer = recordingWriter("run-a");
    const agent = createAgent({
      model: toolCallingModel([{ id: "c1", name: "widgets__show", input: { label: "hello" } }]),
      plugins: [widgetPlugin(seen)],
    });

    const parts = await drain(agent.stream({ prompt: "show", streamingContext: { writer } }));

    expect(seen).toEqual([writer]);
    expect(writer.parts).toEqual([{ type: "data-widget", data: { label: "hello" } }]);
    expect(parts.some((p) => (p as { type: string }).type === "tool-result")).toBe(true);
  });

  it("gives the same tools a null writer when no context is supplied", async () => {
    const seen: Array<StreamingWriter | null> = [];
    const agent = createAgent({
      model: toolCallingModel([{ id: "c1", name: "widgets__show", input: { label: "x" } }]),
      plugins: [widgetPlugin(seen)],
    });

    await drain(agent.stream({ prompt: "show" }));

    expect(seen).toEqual([null]);
  });

  it("exposes the context to plain tools via ExtendedToolExecutionOptions", async () => {
    const seen: Array<StreamingContext | undefined> = [];
    const writer = recordingWriter("run-a");
    const agent = createAgent({
      model: toolCallingModel([{ id: "c1", name: "plain", input: {} }]),
      tools: {
        plain: tool({
          description: "Plain tool",
          inputSchema: z.object({}),
          execute: async (_input, options) => {
            seen.push((options as ExtendedToolExecutionOptions).streamingContext);
            return "ok";
          },
        }),
      },
    });

    await drain(agent.stream({ prompt: "go", streamingContext: { writer } }));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.writer).toBe(writer);
  });

  it("is absent from plain tools when the request has no context", async () => {
    const seen: Array<boolean> = [];
    const agent = createAgent({
      model: toolCallingModel([{ id: "c1", name: "plain", input: {} }]),
      tools: {
        plain: tool({
          description: "Plain tool",
          inputSchema: z.object({}),
          execute: async (_input, options) => {
            seen.push("streamingContext" in (options as object));
            return "ok";
          },
        }),
      },
    });

    await drain(agent.stream({ prompt: "go" }));

    expect(seen).toEqual([false]);
  });

  it("applies to generate() as well", async () => {
    const seen: Array<StreamingWriter | null> = [];
    const writer = recordingWriter("gen");
    const agent = createAgent({
      model: toolCallingModel([{ id: "c1", name: "widgets__show", input: { label: "g" } }]),
      plugins: [widgetPlugin(seen)],
    });

    const result = await agent.generate({ prompt: "show", streamingContext: { writer } });

    expect(result.status).toBe("complete");
    expect(seen).toEqual([writer]);
    expect(writer.parts).toEqual([{ type: "data-widget", data: { label: "g" } }]);
  });

  it("keeps two concurrent generations on one agent on their own writers", async () => {
    // Both requests are in flight at once; each tool execution must see the
    // writer of its own request, never the other one's. A shared mutable
    // writer slot on the agent would fail this.
    const seen: Array<{ label: string; writer: StreamingWriter | null }> = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const plugin = definePlugin({
      name: "widgets",
      description: "Writes a widget through the request writer",
      tools: (ctx: StreamingContext) => ({
        show: tool({
          description: "Show a widget",
          inputSchema: z.object({ label: z.string() }),
          execute: async ({ label }) => {
            seen.push({ label, writer: ctx.writer });
            ctx.writer?.write({ type: "data-widget", data: { label } });
            return `shown:${label}`;
          },
        }),
      }),
    });
    // One model instance serves both requests; the first two model calls
    // (one per generation) both emit a tool call, then each follow-up answers.
    let requests = 0;
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        requests++;
        const label = JSON.stringify(options.prompt).includes("run-b") ? "run-b" : "run-a";
        const first = requests <= 2;
        if (first) await gate;
        const parts: LanguageModelV3StreamPart[] = first
          ? [
              {
                type: "tool-call",
                toolCallId: `${label}-call`,
                toolName: "widgets__show",
                input: JSON.stringify({ label }),
              },
            ]
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
    const agent = createAgent({ model: model as unknown as LanguageModel, plugins: [plugin] });
    const writerA = recordingWriter("run-a");
    const writerB = recordingWriter("run-b");

    const runA = drain(agent.stream({ prompt: "run-a", streamingContext: { writer: writerA } }));
    const runB = drain(agent.stream({ prompt: "run-b", streamingContext: { writer: writerB } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([runA, runB]);

    expect(seen).toHaveLength(2);
    for (const entry of seen) {
      expect(entry.writer).toBe(entry.label === "run-a" ? writerA : writerB);
    }
    expect(writerA.parts).toEqual([{ type: "data-widget", data: { label: "run-a" } }]);
    expect(writerB.parts).toEqual([{ type: "data-widget", data: { label: "run-b" } }]);
  });

  it("reaches deferred plugin tools invoked through call_tool", async () => {
    const seen: Array<StreamingWriter | null> = [];
    const writer = recordingWriter("deferred");
    const plugin = definePlugin({
      name: "widgets",
      description: "Deferred widget plugin",
      deferred: true,
      tools: (ctx: StreamingContext) => ({
        show: tool({
          description: "Show a widget",
          inputSchema: z.object({ label: z.string() }),
          execute: async ({ label }) => {
            seen.push(ctx.writer);
            ctx.writer?.write({ type: "data-widget", data: { label } });
            return `shown:${label}`;
          },
        }),
      }),
    });
    const agent = createAgent({
      model: toolCallingModel([
        {
          id: "c1",
          name: "call_tool",
          input: { tool_name: "widgets__show", arguments: { label: "via-proxy" } },
        },
      ]),
      plugins: [plugin],
    });

    await drain(agent.stream({ prompt: "show", streamingContext: { writer } }));

    expect(seen).toEqual([writer]);
    expect(writer.parts).toEqual([{ type: "data-widget", data: { label: "via-proxy" } }]);
  });

  it("does not leak the parent's writer into a subagent that is not marked streaming", async () => {
    const childSeen: Array<StreamingWriter | null> = [];
    const parentSeen: Array<StreamingWriter | null> = [];
    const writer = recordingWriter("parent");
    const childPlugin = definePlugin({
      name: "childwidgets",
      description: "Child plugin",
      tools: (ctx: StreamingContext) => ({
        show: tool({
          description: "Child widget",
          inputSchema: z.object({}),
          execute: async () => {
            childSeen.push(ctx.writer);
            return "child-shown";
          },
        }),
      }),
    });
    let childCreateContext: { streamingContext?: StreamingContext } | undefined;
    const agent = createAgent({
      model: toolCallingModel([
        { id: "t1", name: "task", input: { description: "delegate", subagent_type: "helper" } },
        { id: "c1", name: "widgets__show", input: { label: "parent" } },
      ]),
      plugins: [widgetPlugin(parentSeen)],
      includeGeneralPurposeSubagent: false,
      subagents: [
        {
          type: "helper",
          description: "helper",
          // No `streaming: true`: the child must not receive the parent's writer.
          create: (ctx) => {
            childCreateContext = ctx;
            return createSubagent(agent, {
              name: "helper",
              model: toolCallingModel([{ id: "cc1", name: "childwidgets__show", input: {} }]),
              plugins: [childPlugin],
            });
          },
        },
      ],
    });

    await drain(agent.stream({ prompt: "delegate", streamingContext: { writer } }));

    expect(parentSeen).toEqual([writer]);
    expect(childCreateContext?.streamingContext).toBeUndefined();
    expect(childSeen).toEqual([null]);
    expect(writer.parts).toEqual([{ type: "data-widget", data: { label: "parent" } }]);
  });

  it("is rejected by streamDataResponse(), which owns its writer", async () => {
    const agent = createAgent({ model: toolCallingModel([]) });
    const writer = recordingWriter("x");
    await expect(
      agent.streamDataResponse({ prompt: "x", streamingContext: { writer } }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("accepts any object with write(), not only a full UIMessageStreamWriter", () => {
    const minimal: StreamingWriter = { write: vi.fn() };
    const ctx: StreamingContext = { writer: minimal };
    expect(ctx.writer).toBe(minimal);
  });
});
