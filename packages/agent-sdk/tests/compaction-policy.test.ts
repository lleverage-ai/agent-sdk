/**
 * Tests for compaction policy with multi-signal triggers
 * @module tests/compaction-policy
 */

import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent.js";
import { type CompactionPolicy, createContextManager } from "../src/context-manager.js";
import { createMockModel } from "./setup.js";

describe("CompactionPolicy", () => {
  let mockModel: ReturnType<typeof createMockModel>;

  beforeEach(() => {
    mockModel = createMockModel({
      text: "Summary of conversation",
    });
  });

  describe("Token Threshold Trigger", () => {
    it("should trigger compaction when usage exceeds tokenThreshold", async () => {
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

      // Create messages that exceed 80% of max tokens (800 tokens)
      // Each message is approximately 200 chars = 50 tokens + 4 overhead = 54 tokens
      // Need 15+ messages to exceed 800 tokens
      const messages: ModelMessage[] = [];
      for (let i = 0; i < 16; i++) {
        messages.push({
          role: "user" as const,
          content: "A".repeat(200), // ~50 tokens + overhead
        });
      }

      const { trigger, reason } = contextManager.shouldCompact(messages);

      expect(trigger).toBe(true);
      expect(reason).toBe("token_threshold");
    });

    it("should not trigger compaction when usage is below tokenThreshold", async () => {
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

      // Create messages that are below 80% (less than 800 tokens)
      const messages: ModelMessage[] = [
        { role: "user" as const, content: "A".repeat(100) }, // ~25 tokens + overhead
        { role: "assistant" as const, content: "B".repeat(100) },
      ];

      const { trigger } = contextManager.shouldCompact(messages);

      expect(trigger).toBe(false);
    });
  });

  describe("Hard Cap Trigger", () => {
    it("should trigger compaction at hardCapThreshold even if below tokenThreshold", async () => {
      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: {
          enabled: true,
          tokenThreshold: 0.99, // Very high threshold
          hardCapThreshold: 0.8, // But lower hard cap
          enableGrowthRatePrediction: false,
          enableErrorFallback: true,
        },
      });

      // Create messages that exceed 80% (hard cap) but below 99% (token threshold)
      const messages: ModelMessage[] = [];
      for (let i = 0; i < 16; i++) {
        messages.push({
          role: "user" as const,
          content: "A".repeat(200),
        });
      }

      const { trigger, reason } = contextManager.shouldCompact(messages);

      expect(trigger).toBe(true);
      expect(reason).toBe("hard_cap");
    });
  });

  describe("Growth Rate Prediction", () => {
    it("should trigger compaction when growth rate prediction enabled and large message detected", async () => {
      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: {
          enabled: true,
          tokenThreshold: 0.8,
          hardCapThreshold: 0.95,
          enableGrowthRatePrediction: true,
          enableErrorFallback: true,
        },
      });

      // Create messages where we're at ~65% capacity
      // and the last message is significantly larger than average
      // so that predicted next would exceed 80%
      const messages: ModelMessage[] = [
        { role: "user" as const, content: "A".repeat(100) }, // ~29 tokens
        { role: "assistant" as const, content: "B".repeat(100) }, // ~29 tokens
        { role: "user" as const, content: "C".repeat(100) }, // ~29 tokens
        // Last message is very large (much more than 2x average)
        { role: "assistant" as const, content: "D".repeat(2000) }, // ~504 tokens
      ];
      // Total: 4 * 4 overhead + 29 + 29 + 29 + 504 = 607 tokens (~60%)
      // Last message: 504 tokens (>> 2x average of ~152)
      // Predicted next: 607 + 504 = 1111 tokens (111% > 80% threshold)

      const { trigger, reason } = contextManager.shouldCompact(messages);

      // With growth prediction, should trigger if next message would exceed threshold
      expect(trigger).toBe(true);
      expect(reason).toBe("growth_rate");
    });

    it("should not trigger on growth rate when disabled", async () => {
      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: {
          enabled: true,
          tokenThreshold: 0.8,
          hardCapThreshold: 0.95,
          enableGrowthRatePrediction: false, // Disabled
          enableErrorFallback: true,
        },
      });

      const messages: ModelMessage[] = [
        { role: "user" as const, content: "A".repeat(50) },
        { role: "assistant" as const, content: "B".repeat(50) },
        { role: "user" as const, content: "C".repeat(50) },
        { role: "assistant" as const, content: "D".repeat(800) },
      ];

      const { trigger } = contextManager.shouldCompact(messages);

      // Should not trigger because growth prediction is disabled and we're below threshold
      expect(trigger).toBe(false);
    });
  });

  describe("Custom shouldCompact Function", () => {
    it("should use custom function when provided", async () => {
      const customShouldCompact = (budget: any, messages: ModelMessage[]) => {
        // Custom logic: trigger if more than 5 messages
        return {
          trigger: messages.length > 5,
          reason: "token_threshold" as const,
        };
      };

      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: {
          enabled: true,
          tokenThreshold: 0.8,
          hardCapThreshold: 0.95,
          enableGrowthRatePrediction: false,
          enableErrorFallback: true,
          shouldCompact: customShouldCompact,
        },
      });

      const messages: ModelMessage[] = [
        { role: "user" as const, content: "1" },
        { role: "assistant" as const, content: "2" },
        { role: "user" as const, content: "3" },
        { role: "assistant" as const, content: "4" },
        { role: "user" as const, content: "5" },
        { role: "assistant" as const, content: "6" }, // 6th message
      ];

      const { trigger, reason } = contextManager.shouldCompact(messages);

      expect(trigger).toBe(true);
      expect(reason).toBe("token_threshold");
    });
  });

  describe("Disabled Policy", () => {
    it("should never trigger compaction when policy is disabled", async () => {
      const contextManager = createContextManager({
        maxTokens: 100, // Very low limit
        policy: {
          enabled: false, // Disabled
          tokenThreshold: 0.5,
          hardCapThreshold: 0.9,
          enableGrowthRatePrediction: true,
          enableErrorFallback: true,
        },
      });

      // Create many large messages that would normally trigger
      const messages: ModelMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push({
          role: "user" as const,
          content: "A".repeat(200),
        });
      }

      const { trigger } = contextManager.shouldCompact(messages);

      expect(trigger).toBe(false);
    });
  });

  describe("Compaction with Trigger Reason", () => {
    it("should include trigger reason in compaction result", async () => {
      const agent = createAgent({
        name: "test-agent",
        model: mockModel,
      });

      const contextManager = createContextManager({
        maxTokens: 1000,
        summarization: {
          keepMessageCount: 2,
          keepToolResultCount: 0,
        },
      });

      const messages: ModelMessage[] = [
        { role: "user" as const, content: "Message 1" },
        { role: "assistant" as const, content: "Response 1" },
        { role: "user" as const, content: "Message 2" },
        { role: "assistant" as const, content: "Response 2" },
        { role: "user" as const, content: "Message 3" },
      ];

      const result = await contextManager.compact(messages, agent, "hard_cap");

      expect(result.trigger).toBe("hard_cap");
      expect(result.messagesBefore).toBe(5);
      expect(result.messagesAfter).toBeLessThan(5);
    });

    it("should default to token_threshold when trigger not specified", async () => {
      const agent = createAgent({
        name: "test-agent",
        model: mockModel,
      });

      const contextManager = createContextManager({
        maxTokens: 1000,
        summarization: {
          keepMessageCount: 2,
          keepToolResultCount: 0,
        },
      });

      const messages: ModelMessage[] = [
        { role: "user" as const, content: "Message 1" },
        { role: "assistant" as const, content: "Response 1" },
        { role: "user" as const, content: "Message 2" },
        { role: "assistant" as const, content: "Response 2" },
      ];

      const result = await contextManager.compact(messages, agent);

      expect(result.trigger).toBe("token_threshold");
    });
  });

  describe("Policy Configuration", () => {
    it("should merge custom policy with defaults", () => {
      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: {
          tokenThreshold: 0.7, // Custom value
          // Other fields should use defaults
        },
      });

      expect(contextManager.policy.enabled).toBe(true);
      expect(contextManager.policy.tokenThreshold).toBe(0.7);
      expect(contextManager.policy.hardCapThreshold).toBe(0.95);
      expect(contextManager.policy.enableGrowthRatePrediction).toBe(false);
      expect(contextManager.policy.enableErrorFallback).toBe(true);
    });

    it("should expose policy via contextManager.policy", () => {
      const customPolicy: Partial<CompactionPolicy> = {
        enabled: true,
        tokenThreshold: 0.6,
        hardCapThreshold: 0.9,
        enableGrowthRatePrediction: true,
        enableErrorFallback: false,
      };

      const contextManager = createContextManager({
        maxTokens: 1000,
        policy: customPolicy,
      });

      expect(contextManager.policy.tokenThreshold).toBe(0.6);
      expect(contextManager.policy.hardCapThreshold).toBe(0.9);
      expect(contextManager.policy.enableGrowthRatePrediction).toBe(true);
      expect(contextManager.policy.enableErrorFallback).toBe(false);
    });
  });
});
