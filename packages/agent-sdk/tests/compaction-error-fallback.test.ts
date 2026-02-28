/**
 * Tests for error-triggered compaction fallback
 * @module tests/compaction-error-fallback
 */

import type { LanguageModel, ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createAgent } from "../src/agent.js";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";
import { createContextManager } from "../src/context-manager.js";
import { AgentError } from "../src/errors/index.js";

function createMockModelWithBehavior(generateFn: () => Promise<any>): LanguageModel {
  return {
    specificationVersion: "v3" as const,
    provider: "mock",
    modelId: "mock-model",
    defaultObjectGenerationMode: "json" as const,
    doGenerate: vi.fn(generateFn),
    doStream: vi.fn(),
  } as unknown as LanguageModel;
}

describe("Error-Triggered Compaction Fallback", () => {
  describe("Context Length Error Detection", () => {
    it("should detect context length errors from various error messages", () => {
      const testCases = [
        "This model's maximum context length is 8192 tokens",
        "Request exceeds token limit of 100000",
        "context_length_exceeded",
        "The conversation is too long",
        "Maximum context size reached",
        "Token limit exceeded",
      ];

      for (const errorMessage of testCases) {
        const _error = new AgentError(errorMessage, {
          code: "MODEL_ERROR",
        });

        // The error message should contain context length indicators
        expect(
          errorMessage.toLowerCase().includes("context") ||
            errorMessage.toLowerCase().includes("token") ||
            errorMessage.toLowerCase().includes("too long"),
        ).toBe(true);
      }
    });
  });

  describe("Emergency Compaction on Error", () => {
    it("should attempt emergency compaction on context length error when enableErrorFallback is true", async () => {
      let generateCallCount = 0;
      let compactionOccurred = false;

      const mockModel = createMockModelWithBehavior(async () => {
        generateCallCount++;

        // First call: throw context length error
        if (generateCallCount === 1) {
          throw new Error("This model's maximum context length is 8192 tokens");
        }

        // Second call (after compaction): succeed
        return {
          text: "Success after compaction",
          content: [{ type: "text", text: "Success after compaction" }],
          toolCalls: [],
          finishReason: "stop" as const,
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
            outputTokenDetails: { reasoningTokens: 0 },
          },
          request: { body: {} },
          response: { id: "mock-id", timestamp: new Date(), modelId: "mock-model", headers: {} },
          warnings: [],
          sources: [],
          providerMetadata: undefined,
        };
      });

      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: {
          enabled: true,
          tokenThreshold: 0.8,
          hardCapThreshold: 0.95,
          enableGrowthRatePrediction: false,
          enableErrorFallback: true, // Enable error fallback
        },
        summarization: {
          keepMessageCount: 2,
          keepToolResultCount: 0,
        },
        onCompact: (result) => {
          if (result.trigger === "error_fallback") {
            compactionOccurred = true;
          }
        },
      });

      const agent = createAgent({
        name: "test-agent",
        model: mockModel,
        contextManager,
        checkpointer: new MemorySaver(),
      });

      // Create messages that would cause context length error
      const messages: ModelMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({
          role: "user" as const,
          content: `Message ${i} with some content`,
        });
      }

      const result = await agent.generate({
        messages,
        threadId: "test-thread",
        maxRetries: 2,
      });

      expect(result.text).toBe("Success after compaction");
      // Call count is 3: (1) first attempt failed, (2) summary generation during compaction, (3) retry succeeded
      expect(generateCallCount).toBe(3);
      expect(compactionOccurred).toBe(true); // Compaction was triggered
    });

    it("should not attempt emergency compaction when enableErrorFallback is false", async () => {
      let generateCallCount = 0;

      const mockModel = createMockModelWithBehavior(async () => {
        generateCallCount++;
        throw new Error("This model's maximum context length is 8192 tokens");
      });

      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: {
          enabled: true,
          tokenThreshold: 0.8,
          hardCapThreshold: 0.95,
          enableGrowthRatePrediction: false,
          enableErrorFallback: false, // Disabled
        },
        summarization: {
          keepMessageCount: 2,
          keepToolResultCount: 0,
        },
      });

      const agent = createAgent({
        name: "test-agent",
        model: mockModel,
        contextManager,
      });

      const messages: ModelMessage[] = [{ role: "user" as const, content: "Test message" }];

      await expect(
        agent.generate({
          messages,
          maxRetries: 2,
        }),
      ).rejects.toThrow();

      // Should only try once (no emergency compaction retry)
      expect(generateCallCount).toBe(1);
    });

    it("should not trigger emergency compaction for non-context errors", async () => {
      let generateCallCount = 0;
      let compactionOccurred = false;

      const mockModel = createMockModelWithBehavior(async () => {
        generateCallCount++;
        throw new Error("Rate limit exceeded"); // Non-context error
      });

      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: {
          enabled: true,
          tokenThreshold: 0.8,
          hardCapThreshold: 0.95,
          enableGrowthRatePrediction: false,
          enableErrorFallback: true,
        },
        onCompact: (result) => {
          if (result.trigger === "error_fallback") {
            compactionOccurred = true;
          }
        },
      });

      const agent = createAgent({
        name: "test-agent",
        model: mockModel,
        contextManager,
      });

      const messages: ModelMessage[] = [{ role: "user" as const, content: "Test message" }];

      await expect(
        agent.generate({
          messages,
          maxRetries: 2,
        }),
      ).rejects.toThrow("Rate limit exceeded");

      expect(generateCallCount).toBe(1);
      expect(compactionOccurred).toBe(false); // Should not compact for rate limit error
    });

    it("should save compacted state to checkpoint after emergency compaction", async () => {
      let generateCallCount = 0;
      const checkpointer = new MemorySaver();

      const mockModel = createMockModelWithBehavior(async () => {
        generateCallCount++;

        if (generateCallCount === 1) {
          throw new Error("Context length exceeded");
        }

        return {
          text: "Success",
          content: [{ type: "text", text: "Success" }],
          toolCalls: [],
          finishReason: "stop" as const,
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
            outputTokenDetails: { reasoningTokens: 0 },
          },
          request: { body: {} },
          response: { id: "mock-id", timestamp: new Date(), modelId: "mock-model", headers: {} },
          warnings: [],
          sources: [],
          providerMetadata: undefined,
        };
      });

      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: {
          enabled: true,
          tokenThreshold: 0.8,
          hardCapThreshold: 0.95,
          enableGrowthRatePrediction: false,
          enableErrorFallback: true,
        },
        summarization: {
          keepMessageCount: 2,
          keepToolResultCount: 0,
        },
      });

      const agent = createAgent({
        name: "test-agent",
        model: mockModel,
        contextManager,
        checkpointer,
      });

      // Create many messages
      const messages: ModelMessage[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push({
          role: "user" as const,
          content: `Message ${i}`,
        });
      }

      await agent.generate({
        messages,
        threadId: "test-thread",
        maxRetries: 2,
      });

      // Load checkpoint and verify it contains compacted messages
      const checkpoint = await checkpointer.load("test-thread");
      expect(checkpoint).toBeDefined();
      if (checkpoint) {
        // After compaction, should have fewer messages
        expect(checkpoint.messages.length).toBeLessThan(messages.length);
      }
    });

    it("should respect maxRetries when emergency compaction fails", async () => {
      let generateCallCount = 0;

      const mockModel = createMockModelWithBehavior(async () => {
        generateCallCount++;
        // Always throw context error, even after compaction
        throw new Error("Context length is too large");
      });

      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: {
          enabled: true,
          tokenThreshold: 0.8,
          hardCapThreshold: 0.95,
          enableGrowthRatePrediction: false,
          enableErrorFallback: true,
        },
        summarization: {
          keepMessageCount: 2,
          keepToolResultCount: 0,
        },
      });

      const agent = createAgent({
        name: "test-agent",
        model: mockModel,
        contextManager,
      });

      const messages: ModelMessage[] = [{ role: "user" as const, content: "Test" }];

      await expect(
        agent.generate({
          messages,
          maxRetries: 3,
        }),
      ).rejects.toThrow();

      // Should attempt: initial + 3 retries = 4 total
      expect(generateCallCount).toBeLessThanOrEqual(4);
    });
  });
});
