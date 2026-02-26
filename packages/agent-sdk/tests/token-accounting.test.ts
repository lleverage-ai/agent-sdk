/**
 * Tests for token accounting improvements (Phase 2).
 *
 * Covers:
 * - Message token caching to avoid re-counting
 * - Usage-based tracking from AI SDK responses
 * - Hybrid approach: estimates + actuals
 */

import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  createApproximateTokenCounter,
  createContextManager,
  createCustomTokenCounter,
} from "../src/context-manager.js";

describe("Token Accounting Improvements", () => {
  describe("Message Token Caching", () => {
    it("should cache token counts for identical messages", () => {
      const counter = createApproximateTokenCounter();

      const message: ModelMessage = {
        role: "user",
        content: "Hello, world! This is a test message.",
      };

      // First count - should calculate
      const count1 = counter.countMessages([message]);

      // Second count with same message - should use cache
      const count2 = counter.countMessages([message]);

      expect(count1).toBe(count2);
      expect(count1).toBeGreaterThan(0);
    });

    it("should handle cache invalidation", () => {
      const counter = createApproximateTokenCounter();

      const message: ModelMessage = {
        role: "user",
        content: "Test message",
      };

      // Count before invalidation
      const count1 = counter.countMessages([message]);

      // Invalidate cache
      counter.invalidateCache?.();

      // Count after invalidation - should recalculate
      const count2 = counter.countMessages([message]);

      expect(count1).toBe(count2);
    });

    it("should cache counts for custom token counter", () => {
      let callCount = 0;
      const counter = createCustomTokenCounter({
        countFn: (text: string) => {
          callCount++;
          return Math.ceil(text.length / 4);
        },
      });

      const message: ModelMessage = {
        role: "user",
        content: "Hello",
      };

      // First count
      counter.countMessages([message]);
      const firstCallCount = callCount;

      // Second count with same message - should use cache, not call countFn again
      counter.countMessages([message]);
      const secondCallCount = callCount;

      // Should only call countFn once for the content
      expect(secondCallCount).toBe(firstCallCount);
    });

    it("should cache different messages separately", () => {
      const counter = createApproximateTokenCounter();

      const message1: ModelMessage = {
        role: "user",
        content: "First message",
      };

      const message2: ModelMessage = {
        role: "assistant",
        content: "Second message",
      };

      const count1 = counter.countMessages([message1]);
      const count2 = counter.countMessages([message2]);
      const countBoth = counter.countMessages([message1, message2]);

      expect(countBoth).toBe(count1 + count2);
    });
  });

  describe("Usage-Based Tracking", () => {
    it("should update token budget with actual usage", () => {
      const contextManager = createContextManager({
        maxTokens: 10000,
      });

      const messages: ModelMessage[] = [{ role: "user", content: "Hello" }];

      // Get initial budget (estimated)
      const budget1 = contextManager.getBudget(messages);
      expect(budget1.isActual).toBe(false);

      // Update with actual usage
      contextManager.updateUsage?.({
        inputTokens: 500,
        outputTokens: 300,
        totalTokens: 800,
      });

      // Get budget again (should use actual)
      const budget2 = contextManager.getBudget(messages);
      expect(budget2.isActual).toBe(true);
      expect(budget2.currentTokens).toBe(800);
      expect(budget2.usage).toBe(0.08); // 800 / 10000
      expect(budget2.remaining).toBe(9200);
    });

    it("should fallback to estimation if no usage data available", () => {
      const contextManager = createContextManager({
        maxTokens: 10000,
      });

      const messages: ModelMessage[] = [
        { role: "user", content: "Hello, this is a test message!" },
      ];

      const budget = contextManager.getBudget(messages);

      // Should be estimated, not actual
      expect(budget.isActual).toBe(false);
      expect(budget.currentTokens).toBeGreaterThan(0);
    });

    it("should use most recent actual usage", () => {
      const contextManager = createContextManager({
        maxTokens: 10000,
      });

      const messages: ModelMessage[] = [{ role: "user", content: "Test" }];

      // First usage update
      contextManager.updateUsage?.({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      const budget1 = contextManager.getBudget(messages);
      expect(budget1.currentTokens).toBe(150);

      // Second usage update
      contextManager.updateUsage?.({
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
      });

      const budget2 = contextManager.getBudget(messages);
      expect(budget2.currentTokens).toBe(300);
    });
  });

  describe("Hybrid Token Tracking", () => {
    it("should use actual usage when available for compaction decisions", () => {
      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: {
          enabled: true,
          tokenThreshold: 0.8,
          hardCapThreshold: 0.95,
          enableGrowthRatePrediction: false,
          enableErrorFallback: true,
        },
      });

      const messages: ModelMessage[] = [{ role: "user", content: "Hello" }];

      // Update with usage that exceeds threshold (850 tokens > 80% of 1000)
      contextManager.updateUsage?.({
        inputTokens: 600,
        outputTokens: 250,
        totalTokens: 850,
      });

      const { trigger, reason } = contextManager.shouldCompact(messages);

      expect(trigger).toBe(true);
      expect(reason).toBe("token_threshold");
    });

    it("should respect hard cap threshold with actual usage", () => {
      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: {
          enabled: true,
          tokenThreshold: 0.8,
          hardCapThreshold: 0.95,
          enableGrowthRatePrediction: false,
          enableErrorFallback: true,
        },
      });

      const messages: ModelMessage[] = [{ role: "user", content: "Hello" }];

      // Update with usage at hard cap (960 tokens > 95% of 1000)
      contextManager.updateUsage?.({
        inputTokens: 700,
        outputTokens: 260,
        totalTokens: 960,
      });

      const { trigger, reason } = contextManager.shouldCompact(messages);

      expect(trigger).toBe(true);
      expect(reason).toBe("hard_cap");
    });

    it("should work without updateUsage method (backward compatibility)", () => {
      const contextManager = createContextManager({
        maxTokens: 10000,
      });

      // Should not crash if updateUsage is not called
      const messages: ModelMessage[] = [{ role: "user", content: "Test" }];

      const budget = contextManager.getBudget(messages);
      expect(budget.isActual).toBe(false);
      expect(budget.currentTokens).toBeGreaterThan(0);
    });
  });

  describe("Token Counter Integration", () => {
    it("should work with custom token counter and caching", () => {
      let callCount = 0;
      const customCounter = createCustomTokenCounter({
        countFn: (text: string) => {
          callCount++;
          return Math.ceil(text.length / 3); // Different ratio for testing
        },
      });

      const contextManager = createContextManager({
        maxTokens: 10000,
        tokenCounter: customCounter,
      });

      const messages: ModelMessage[] = [{ role: "user", content: "Hello, world!" }];

      // Count messages multiple times
      contextManager.getBudget(messages);
      contextManager.getBudget(messages);

      // Should use cache, not call countFn multiple times for same message
      // Only called once per unique text content
      expect(callCount).toBeLessThan(3);
    });

    it("should handle complex messages with tool calls", () => {
      const counter = createApproximateTokenCounter();

      const messages: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me help you" },
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "search",
              args: { query: "test query" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "search",
              result: "Search results here",
            },
          ],
        },
      ];

      const count = counter.countMessages(messages);
      expect(count).toBeGreaterThan(0);

      // Counting again should use cache
      const count2 = counter.countMessages(messages);
      expect(count2).toBe(count);
    });
  });
});
