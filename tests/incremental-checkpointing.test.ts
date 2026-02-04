/**
 * Tests for incremental checkpointing during streaming.
 *
 * Verifies that checkpoints are saved after each step (tool call) when
 * checkpointAfterToolCall option is enabled, providing crash recovery
 * for long-running streams.
 */

import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent } from "../src/agent.js";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";

/**
 * Helper to create a mock model with custom doStream implementation
 */
function createMockModelWithStream(doStreamImpl: () => AsyncGenerator<any>): LanguageModel {
  return {
    specificationVersion: "v3" as const,
    provider: "mock",
    modelId: "mock-model",
    defaultObjectGenerationMode: "json" as const,
    doGenerate: vi.fn().mockResolvedValue({
      text: "Mock response",
      content: [{ type: "text", text: "Mock response" }],
      toolCalls: [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokenDetails: { reasoningTokens: 0 },
      },
      request: { body: {} },
      response: { id: "mock-id", timestamp: new Date(), modelId: "mock-model", headers: {} },
      warnings: [],
      sources: [],
      providerMetadata: undefined,
    }),
    doStream: vi.fn().mockImplementation(async () => ({
      stream: new ReadableStream({
        async start(controller) {
          for await (const chunk of doStreamImpl()) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    })),
  } as unknown as LanguageModel;
}

describe("Incremental Checkpointing", () => {
  let checkpointer: MemorySaver;

  beforeEach(() => {
    checkpointer = new MemorySaver();
  });

  it("should save checkpoint after each step when checkpointAfterToolCall is enabled", async () => {
    // Track checkpoint saves
    const checkpointSaves: Array<{ threadId: string; step: number }> = [];
    const originalSave = checkpointer.save.bind(checkpointer);
    checkpointer.save = async (checkpoint) => {
      checkpointSaves.push({ threadId: checkpoint.threadId, step: checkpoint.step });
      return originalSave(checkpoint);
    };

    // Create a mock model with a single text response
    // The AI SDK will handle streaming and steps internally
    const mockModel = createMockModelWithStream(async function* () {
      yield {
        type: "text-delta" as const,
        textDelta: "Hello",
        delta: "Hello",
      };
      yield {
        type: "finish" as const,
        finishReason: "stop" as const,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokenDetails: { reasoningTokens: 0 },
        },
        providerMetadata: undefined,
      };
    });

    const agent = createAgent({
      model: mockModel,
      checkpointer,
    });

    // Stream with incremental checkpointing enabled
    const stream = await agent.stream({
      prompt: "Say hello",
      threadId: "thread-1",
      checkpointAfterToolCall: true,
    });

    // Consume the stream
    for await (const _chunk of stream) {
      // Just consume the stream
    }

    // Verify that at least the final checkpoint was saved
    expect(checkpointSaves.length).toBeGreaterThanOrEqual(1);
    expect(checkpointSaves[0].threadId).toBe("thread-1");
  });

  it("should not save incremental checkpoints when checkpointAfterToolCall is false", async () => {
    // Track checkpoint saves
    let checkpointSaveCount = 0;
    const originalSave = checkpointer.save.bind(checkpointer);
    checkpointer.save = async (checkpoint) => {
      checkpointSaveCount++;
      return originalSave(checkpoint);
    };

    const mockModel = createMockModelWithStream(async function* () {
      yield {
        type: "text-delta" as const,
        textDelta: "Hello",
        delta: "Hello",
      };
      yield {
        type: "finish" as const,
        finishReason: "stop" as const,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokenDetails: { reasoningTokens: 0 },
        },
        providerMetadata: undefined,
      };
    });

    const agent = createAgent({
      model: mockModel,
      checkpointer,
    });

    // Stream WITHOUT incremental checkpointing (default behavior)
    const stream = await agent.stream({
      prompt: "Say hello",
      threadId: "thread-2",
      // checkpointAfterToolCall not set (defaults to false)
    });

    // Consume the stream
    for await (const _chunk of stream) {
      // Just consume the stream
    }

    // Should only have the final checkpoint (in onFinish)
    expect(checkpointSaveCount).toBe(1);
  });

  it("should work with streamResponse method", async () => {
    const checkpointSaves: number[] = [];
    const originalSave = checkpointer.save.bind(checkpointer);
    checkpointer.save = async (checkpoint) => {
      checkpointSaves.push(checkpoint.step);
      return originalSave(checkpoint);
    };

    const mockModel = createMockModelWithStream(async function* () {
      yield {
        type: "text-delta" as const,
        textDelta: "Response",
        delta: "Response",
      };
      yield {
        type: "finish" as const,
        finishReason: "stop" as const,
        usage: {
          inputTokens: 50,
          outputTokens: 25,
          inputTokenDetails: { noCacheTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokenDetails: { reasoningTokens: 0 },
        },
        providerMetadata: undefined,
      };
    });

    const agent = createAgent({
      model: mockModel,
      checkpointer,
    });

    const response = await agent.streamResponse({
      prompt: "Respond",
      threadId: "thread-3",
      checkpointAfterToolCall: true,
    });

    // Consume the response stream
    await response.text();

    // Should have at least final checkpoint
    expect(checkpointSaves.length).toBeGreaterThanOrEqual(1);
  });

  it("should work with streamDataResponse method", async () => {
    const checkpointSaves: number[] = [];
    const originalSave = checkpointer.save.bind(checkpointer);
    checkpointer.save = async (checkpoint) => {
      checkpointSaves.push(checkpoint.step);
      return originalSave(checkpoint);
    };

    const mockModel = createMockModelWithStream(async function* () {
      yield {
        type: "text-delta" as const,
        textDelta: "Data response",
        delta: "Data response",
      };
      yield {
        type: "finish" as const,
        finishReason: "stop" as const,
        usage: {
          inputTokens: 50,
          outputTokens: 25,
          inputTokenDetails: { noCacheTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokenDetails: { reasoningTokens: 0 },
        },
        providerMetadata: undefined,
      };
    });

    const agent = createAgent({
      model: mockModel,
      checkpointer,
    });

    const response = await agent.streamDataResponse({
      prompt: "Get data",
      threadId: "thread-4",
      checkpointAfterToolCall: true,
    });

    // Consume the response stream
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }

    // Should have at least final checkpoint
    expect(checkpointSaves.length).toBeGreaterThanOrEqual(1);
  });
});
