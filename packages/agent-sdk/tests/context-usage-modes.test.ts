import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../src/agent.js";
import { createContextManager, type UsageUpdateContext } from "../src/context-manager.js";
import type { LanguageModel, PostGenerateInput } from "../src/types.js";

const providerUsage = {
  inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
const modes = ["generate", "stream", "streamDataResponse", "streamRaw"] as const;

describe("per-request usage through real AI SDK loops", () => {
  it.each(modes)(
    "%s records measured inputs before outputs, without changing public usage",
    async (mode) => {
      const cm = createContextManager({
        maxTokens: 100_000,
        policy: { enableGrowthRatePrediction: false },
      });
      const updates: Array<{ inputTokens?: number; context?: UsageUpdateContext }> = [];
      const update = cm.updateUsage!.bind(cm);
      cm.updateUsage = (usage, context) => {
        updates.push({
          inputTokens: usage.inputTokens,
          context: context ? structuredClone(context) : undefined,
        });
        update(usage, context);
      };
      let calls = 0;
      const next = () => {
        const n = ++calls;
        return {
          content:
            n < 3
              ? [
                  {
                    type: "tool-call" as const,
                    toolCallId: `call-${n}`,
                    toolName: "lookup",
                    input: "{}",
                  },
                ]
              : [{ type: "text" as const, text: "done" }],
          finishReason: {
            unified: n < 3 ? ("tool-calls" as const) : ("stop" as const),
            raw: "stop",
          },
          usage: providerUsage,
          warnings: [],
        };
      };
      const model = new MockLanguageModelV3({
        doGenerate: async () => next(),
        doStream: async () => {
          const result = next();
          const parts: LanguageModelV3StreamPart[] = [{ type: "stream-start", warnings: [] }];
          for (const part of result.content) {
            if (part.type === "tool-call") parts.push(part);
            else
              parts.push(
                { type: "text-start", id: "t" },
                { type: "text-delta", id: "t", delta: part.text },
                { type: "text-end", id: "t" },
              );
          }
          parts.push({ type: "finish", finishReason: result.finishReason, usage: providerUsage });
          return {
            stream: new ReadableStream({
              start(controller) {
                for (const part of parts) controller.enqueue(part);
                controller.close();
              },
            }),
          };
        },
      });
      const postGenerate = vi.fn(async (_input: PostGenerateInput) => ({}));
      const agent = createAgent({
        model: model as LanguageModel,
        contextManager: cm,
        maxSteps: 4,
        hooks: { PostGenerate: [postGenerate] },
        tools: {
          lookup: tool({ inputSchema: z.object({}), execute: async () => `RESULT-${calls}` }),
        },
      });
      const options = { prompt: "Look up twice, then finish" };
      if (mode === "generate") {
        const result = await agent.generate(options);
        expect(result.status).toBe("complete");
        if (result.status === "complete") {
          expect(result.steps).toHaveLength(3);
          expect(postGenerate.mock.calls[0][0].result.usage).toEqual(result.usage);
        }
      } else if (mode === "stream") {
        for await (const _part of agent.stream(options)) {
          /* consume */
        }
      } else if (mode === "streamRaw") {
        const result = await agent.streamRaw(options);
        await result.consumeStream();
        await result.steps;
      } else {
        const response = await agent[mode](options);
        await response.text();
      }
      expect(calls).toBe(3);
      expect(cm.getBudget([{ role: "user", content: "probe" }]).currentTokens).toBe(910);
      const boundaries = updates.filter((u) => u.context);
      if (mode === "generate") {
        expect(boundaries).toHaveLength(0); // Retain generate's existing boundary timing.
        expect(updates).toEqual([{ inputTokens: 900, context: undefined }]);
      } else {
        expect(boundaries).toHaveLength(3);
        for (const [i, boundary] of boundaries.entries()) {
          const input = JSON.stringify(boundary.context!.messages);
          expect(boundary.inputTokens).toBe(900);
          expect(input).not.toContain(`RESULT-${i + 1}`);
          if (i > 0) expect(input).toContain(`RESULT-${i}`);
        }
        expect(cm.getUsageAnchor?.()?.inputTokens).toBe(900);
      }
    },
  );

  it.each(modes)("%s excludes isolated summariser usage", async (mode) => {
    const cm = createContextManager({ maxTokens: 100_000 });
    const update = vi.spyOn(cm, "updateUsage");
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "S" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: providerUsage,
        warnings: [],
      }),
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: providerUsage,
            });
            controller.close();
          },
        }),
      }),
    });
    const agent = createAgent({ model: model as LanguageModel, contextManager: cm });
    const options = { prompt: "Summarise", _skipCompaction: true };
    if (mode === "generate") await agent.generate(options);
    else if (mode === "stream") {
      for await (const _part of agent.stream(options)) {
        /* consume */
      }
    } else if (mode === "streamRaw") {
      const result = await agent.streamRaw(options);
      await result.consumeStream();
      await result.steps;
    } else await (await agent[mode](options)).text();
    expect(update).not.toHaveBeenCalled();
    expect(cm.getUsageAnchor?.()).toBeNull();
  });
});
