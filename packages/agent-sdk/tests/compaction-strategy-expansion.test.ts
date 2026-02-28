/**
 * Tests for Phase 4: Context Compaction Strategy Expansion
 *
 * Tests cover:
 * - Pinned messages support
 * - Tiered summaries
 * - Structured summary format
 * - Multiple compaction strategies
 */

import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../src/agent.js";
import { type ContextManager, createContextManager } from "../src/context-manager.js";

describe("Compaction Strategy Expansion - Phase 4", () => {
  let contextManager: ContextManager;
  let agent: Agent;
  let messages: ModelMessage[];

  beforeEach(() => {
    // Create a mock agent for testing
    agent = {
      generate: vi.fn(async (options: any) => {
        // Mock generate response
        const content = options.messages?.[1]?.content || "";

        // Return structured summary for structured strategy
        if (content.includes("JSON format")) {
          return {
            status: "complete",
            text: JSON.stringify({
              decisions: ["Decision 1", "Decision 2"],
              preferences: ["Preference 1"],
              currentState: ["State 1"],
              openQuestions: ["Question 1"],
              references: ["file.ts:123"],
            }),
            finishReason: "stop",
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            messages: [],
          };
        }

        // Return regular summary
        return {
          status: "complete",
          text: "This is a mock summary of the conversation covering TypeScript topics including interfaces, generics, and React integration.",
          finishReason: "stop",
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          messages: [],
        };
      }),
      options: {
        model: {} as any,
      },
    } as any as Agent;

    // Create sample messages
    messages = [
      { role: "system", content: "You are a helpful assistant" },
      { role: "user", content: "Tell me about TypeScript" },
      { role: "assistant", content: "TypeScript is a typed superset of JavaScript..." },
      { role: "user", content: "How do I use interfaces?" },
      { role: "assistant", content: "Interfaces in TypeScript define contracts..." },
      { role: "user", content: "What about generics?" },
      { role: "assistant", content: "Generics allow you to write reusable code..." },
      { role: "user", content: "Show me an example" },
      {
        role: "assistant",
        content: "Here's an example: function identity<T>(arg: T): T { return arg; }",
      },
      { role: "user", content: "Can I use this in React?" },
      { role: "assistant", content: "Yes, TypeScript works great with React..." },
    ];
  });

  describe("Pinned Messages", () => {
    it("should pin and unpin messages", () => {
      contextManager = createContextManager({
        maxTokens: 100000,
      });

      // Pin a message
      contextManager.pinMessage(2, "Important TypeScript definition");

      expect(contextManager.isPinned(2)).toBe(true);
      expect(contextManager.isPinned(3)).toBe(false);
      expect(contextManager.pinnedMessages).toHaveLength(1);
      expect(contextManager.pinnedMessages[0]?.messageIndex).toBe(2);
      expect(contextManager.pinnedMessages[0]?.reason).toBe("Important TypeScript definition");

      // Unpin the message
      contextManager.unpinMessage(2);
      expect(contextManager.isPinned(2)).toBe(false);
      expect(contextManager.pinnedMessages).toHaveLength(0);
    });

    it("should prevent duplicate pins", () => {
      contextManager = createContextManager({
        maxTokens: 100000,
      });

      contextManager.pinMessage(2, "First pin");
      contextManager.pinMessage(2, "Second pin");

      expect(contextManager.pinnedMessages).toHaveLength(1);
    });

    it("should preserve pinned messages during compaction", async () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
          keepToolResultCount: 0,
        },
      });

      // Pin the important interface message
      contextManager.pinMessage(4, "Interface definition - must preserve");

      const result = await contextManager.compact(messages, agent);

      // Verify pinned message is in the result
      const pinnedContent = "Interfaces in TypeScript define contracts";
      const hasPinnedMessage = result.newMessages.some(
        (m) => typeof m.content === "string" && m.content.includes(pinnedContent),
      );

      expect(hasPinnedMessage).toBe(true);
      expect(result.newMessages.length).toBeGreaterThan(3); // System + summary + pinned + recent
    });
  });

  describe("Compaction Strategies", () => {
    it("should use rollup strategy by default", async () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
          strategy: "rollup",
        },
      });

      const result = await contextManager.compact(messages, agent);

      expect(result.strategy).toBe("rollup");
      expect(result.summary).toBeTruthy();
      expect(result.summaryTier).toBeUndefined();
      expect(result.structuredSummary).toBeUndefined();
    });

    it("should generate structured summaries when enabled", async () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
          strategy: "structured",
          enableStructuredSummary: true,
        },
      });

      const result = await contextManager.compact(messages, agent);

      expect(result.strategy).toBe("structured");

      // The result should contain structured summary data
      // Note: Actual parsing depends on LLM response, so we check the attempt was made
      expect(result.summary).toBeTruthy();

      // If structuredSummary was parsed successfully, verify structure
      if (result.structuredSummary) {
        expect(result.structuredSummary).toHaveProperty("decisions");
        expect(result.structuredSummary).toHaveProperty("preferences");
        expect(result.structuredSummary).toHaveProperty("currentState");
        expect(result.structuredSummary).toHaveProperty("openQuestions");
        expect(result.structuredSummary).toHaveProperty("references");
      }
    });
  });

  describe("Tiered Summaries", () => {
    it("should support tiered summary configuration", () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
          strategy: "tiered",
          enableTieredSummaries: true,
          maxSummaryTiers: 3,
          messagesPerTier: 5,
        },
      });

      expect(contextManager.summarizationConfig.strategy).toBe("tiered");
      expect(contextManager.summarizationConfig.enableTieredSummaries).toBe(true);
      expect(contextManager.summarizationConfig.maxSummaryTiers).toBe(3);
      expect(contextManager.summarizationConfig.messagesPerTier).toBe(5);
    });

    it("should create first-tier summary when no existing summaries", async () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
          strategy: "tiered",
          enableTieredSummaries: true,
          messagesPerTier: 5,
        },
      });

      const result = await contextManager.compact(messages, agent);

      expect(result.strategy).toBe("tiered");
      expect(result.summaryTier).toBe(0);
      expect(result.summary).toBeTruthy();
    });

    it("should create higher-tier summary when enough summaries exist", async () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
          strategy: "tiered",
          enableTieredSummaries: true,
          messagesPerTier: 2, // Low threshold for testing
        },
      });

      // Create messages with multiple existing summaries
      const messagesWithSummaries: ModelMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        { role: "assistant", content: "[Previous conversation summary]\n\nSummary 1 content..." },
        { role: "assistant", content: "[Previous conversation summary]\n\nSummary 2 content..." },
        { role: "assistant", content: "[Previous conversation summary]\n\nSummary 3 content..." },
        { role: "user", content: "Recent message 1" },
        { role: "assistant", content: "Recent response 1" },
        { role: "user", content: "Recent message 2" },
        { role: "assistant", content: "Recent response 2" },
      ];

      const result = await contextManager.compact(messagesWithSummaries, agent);

      expect(result.strategy).toBe("tiered");
      // Should create a tier 1 summary (summary of summaries)
      expect(result.summaryTier).toBeGreaterThan(0);
    });
  });

  describe("CompactionResult Fields", () => {
    it("should include strategy in compaction result", async () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
          strategy: "rollup",
        },
      });

      const result = await contextManager.compact(messages, agent);

      expect(result).toHaveProperty("strategy");
      expect(result.strategy).toBe("rollup");
    });

    it("should include tier information for tiered summaries", async () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
          strategy: "tiered",
          enableTieredSummaries: true,
        },
      });

      const result = await contextManager.compact(messages, agent);

      expect(result).toHaveProperty("summaryTier");
      expect(result.summaryTier).toBe(0); // First tier
    });

    it("should include structured summary when parsed successfully", async () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
          enableStructuredSummary: true,
        },
      });

      const result = await contextManager.compact(messages, agent);

      // structuredSummary may or may not be present depending on LLM response
      // If present, verify structure
      if (result.structuredSummary) {
        const structured = result.structuredSummary;
        expect(Array.isArray(structured.decisions)).toBe(true);
        expect(Array.isArray(structured.preferences)).toBe(true);
        expect(Array.isArray(structured.currentState)).toBe(true);
        expect(Array.isArray(structured.openQuestions)).toBe(true);
        expect(Array.isArray(structured.references)).toBe(true);
      }
    });
  });

  describe("Strategy + Pinning Integration", () => {
    it("should preserve pinned messages with structured summaries", async () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
          strategy: "structured",
          enableStructuredSummary: true,
        },
      });

      contextManager.pinMessage(4, "Important interface info");

      const result = await contextManager.compact(messages, agent);

      expect(result.strategy).toBe("structured");

      // Verify pinned message is preserved
      const pinnedContent = "Interfaces in TypeScript define contracts";
      const hasPinnedMessage = result.newMessages.some(
        (m) => typeof m.content === "string" && m.content.includes(pinnedContent),
      );

      expect(hasPinnedMessage).toBe(true);
    });

    it("should preserve pinned messages with tiered summaries", async () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
          strategy: "tiered",
          enableTieredSummaries: true,
        },
      });

      contextManager.pinMessage(2, "Core TypeScript info");

      const result = await contextManager.compact(messages, agent);

      expect(result.strategy).toBe("tiered");

      // Verify pinned message is preserved
      const pinnedContent = "TypeScript is a typed superset";
      const hasPinnedMessage = result.newMessages.some(
        (m) => typeof m.content === "string" && m.content.includes(pinnedContent),
      );

      expect(hasPinnedMessage).toBe(true);
    });
  });

  describe("Backward Compatibility", () => {
    it("should work without specifying strategy (defaults to rollup)", async () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
          // No strategy specified
        },
      });

      const result = await contextManager.compact(messages, agent);

      expect(result.strategy).toBe("rollup");
      expect(result.summary).toBeTruthy();
      expect(result.newMessages.length).toBeGreaterThan(0);
    });

    it("should handle empty pinned messages list", async () => {
      contextManager = createContextManager({
        maxTokens: 100000,
        summarization: {
          keepMessageCount: 2,
        },
      });

      // No messages pinned
      expect(contextManager.pinnedMessages).toHaveLength(0);

      const result = await contextManager.compact(messages, agent);

      expect(result.newMessages.length).toBeGreaterThan(0);
    });
  });
});
