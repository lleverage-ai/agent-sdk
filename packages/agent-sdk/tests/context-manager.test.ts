/**
 * Tests for context management module.
 */

import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CompactionResult,
  type ContextManager,
  countMessagesByRole,
  createApproximateTokenCounter,
  createContextManager,
  createCustomTokenCounter,
  createTokenBudget,
  DEFAULT_SUMMARIZATION_CONFIG,
  extractToolResults,
  findLastUserMessage,
  type TokenBudget,
  type TokenCounter,
} from "../src/context-manager.js";
import type { Agent } from "../src/types.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockAgent(overrides?: Partial<Agent>): Agent {
  return {
    id: "test-agent",
    options: {
      model: {} as Agent["options"]["model"],
      systemPrompt: "You are a test assistant.",
    },
    backend: {} as Agent["backend"],
    state: { todos: [], files: {} },
    generate: vi.fn().mockResolvedValue({
      status: "complete",
      text: "## Conversation Summary\n\nThis is a test summary of the conversation.",
      usage: { inputTokens: 100, outputTokens: 50 },
      finishReason: "stop",
      steps: [],
    }),
    stream: vi.fn(),
    streamResponse: vi.fn(),
    streamRaw: vi.fn(),
    getSkills: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as Agent;
}

function createTestMessages(count: number): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i + 1}: ${"x".repeat(100)}`, // ~100 chars each
    });
  }
  return messages;
}

// =============================================================================
// createApproximateTokenCounter Tests
// =============================================================================

describe("createApproximateTokenCounter", () => {
  let counter: TokenCounter;

  beforeEach(() => {
    counter = createApproximateTokenCounter();
  });

  describe("count", () => {
    it("should count tokens using 4 chars per token approximation", () => {
      expect(counter.count("")).toBe(0);
      expect(counter.count("a")).toBe(1); // 1 char = 1 token (ceil)
      expect(counter.count("abcd")).toBe(1); // 4 chars = 1 token
      expect(counter.count("abcde")).toBe(2); // 5 chars = 2 tokens (ceil)
      expect(counter.count("a".repeat(100))).toBe(25); // 100 chars = 25 tokens
    });

    it("should handle unicode characters", () => {
      const text = "Hello, 世界!";
      const tokens = counter.count(text);
      expect(tokens).toBeGreaterThan(0);
    });

    it("should handle whitespace", () => {
      expect(counter.count("   ")).toBe(1); // 3 spaces
      expect(counter.count("\n\n\n\n")).toBe(1); // 4 newlines
    });
  });

  describe("countMessages", () => {
    it("should count tokens in simple text messages", () => {
      const messages: ModelMessage[] = [
        { role: "user", content: "Hello" }, // ~5 chars + overhead
        { role: "assistant", content: "Hi there" }, // ~8 chars + overhead
      ];
      const tokens = counter.countMessages(messages);
      // Each message: 4 (overhead) + ceil(length/4)
      // Message 1: 4 + 2 = 6
      // Message 2: 4 + 2 = 6
      expect(tokens).toBe(12);
    });

    it("should count tokens in multi-part messages", () => {
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ];
      const tokens = counter.countMessages(messages);
      expect(tokens).toBeGreaterThan(4); // At least overhead
    });

    it("should count tool calls", () => {
      const messages: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search",
              args: { query: "test" },
            },
          ],
        },
      ];
      const tokens = counter.countMessages(messages);
      expect(tokens).toBeGreaterThan(4);
    });

    it("should count tool results", () => {
      const messages: ModelMessage[] = [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "search",
              result: { data: "result" },
            },
          ],
        },
      ];
      const tokens = counter.countMessages(messages);
      expect(tokens).toBeGreaterThan(4);
    });

    it("should handle empty message array", () => {
      expect(counter.countMessages([])).toBe(0);
    });
  });
});

// =============================================================================
// createCustomTokenCounter Tests
// =============================================================================

describe("createCustomTokenCounter", () => {
  it("should use custom count function", () => {
    const customFn = vi.fn().mockReturnValue(10);
    const counter = createCustomTokenCounter({ countFn: customFn });

    const result = counter.count("test");
    expect(customFn).toHaveBeenCalledWith("test");
    expect(result).toBe(10);
  });

  it("should use default message overhead", () => {
    const customFn = vi.fn().mockReturnValue(5);
    const counter = createCustomTokenCounter({ countFn: customFn });

    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];
    const tokens = counter.countMessages(messages);
    // 4 (default overhead) + 5 (content)
    expect(tokens).toBe(9);
  });

  it("should use custom message overhead", () => {
    const customFn = vi.fn().mockReturnValue(5);
    const counter = createCustomTokenCounter({
      countFn: customFn,
      messageOverhead: 10,
    });

    const messages: ModelMessage[] = [{ role: "user", content: "hello" }];
    const tokens = counter.countMessages(messages);
    // 10 (custom overhead) + 5 (content)
    expect(tokens).toBe(15);
  });
});

// =============================================================================
// createTokenBudget Tests
// =============================================================================

describe("createTokenBudget", () => {
  it("should calculate budget correctly", () => {
    const budget = createTokenBudget(1000, 500);
    expect(budget.maxTokens).toBe(1000);
    expect(budget.currentTokens).toBe(500);
    expect(budget.usage).toBe(0.5);
    expect(budget.remaining).toBe(500);
  });

  it("should handle zero current tokens", () => {
    const budget = createTokenBudget(1000, 0);
    expect(budget.usage).toBe(0);
    expect(budget.remaining).toBe(1000);
  });

  it("should handle full budget", () => {
    const budget = createTokenBudget(1000, 1000);
    expect(budget.usage).toBe(1);
    expect(budget.remaining).toBe(0);
  });

  it("should handle over-budget gracefully", () => {
    const budget = createTokenBudget(1000, 1500);
    expect(budget.usage).toBe(1.5);
    expect(budget.remaining).toBe(0); // Clamped to 0
  });
});

// =============================================================================
// DEFAULT_SUMMARIZATION_CONFIG Tests
// =============================================================================

describe("DEFAULT_SUMMARIZATION_CONFIG", () => {
  it("should have expected default values", () => {
    // Note: enabled and tokenThreshold are now in CompactionPolicy, not SummarizationConfig
    expect(DEFAULT_SUMMARIZATION_CONFIG.keepMessageCount).toBe(10);
    expect(DEFAULT_SUMMARIZATION_CONFIG.keepToolResultCount).toBe(5);
    expect(DEFAULT_SUMMARIZATION_CONFIG.strategy).toBe("rollup");
    expect(DEFAULT_SUMMARIZATION_CONFIG.enableTieredSummaries).toBe(false);
    expect(DEFAULT_SUMMARIZATION_CONFIG.maxSummaryTiers).toBe(3);
    expect(DEFAULT_SUMMARIZATION_CONFIG.messagesPerTier).toBe(5);
    expect(DEFAULT_SUMMARIZATION_CONFIG.enableStructuredSummary).toBe(false);
  });
});

// =============================================================================
// createContextManager Tests
// =============================================================================

describe("createContextManager", () => {
  let contextManager: ContextManager;
  let mockAgent: Agent;

  beforeEach(() => {
    mockAgent = createMockAgent();
    contextManager = createContextManager({
      maxTokens: 1000,
    });
  });

  describe("tokenCounter", () => {
    it("should use approximate counter by default", () => {
      expect(contextManager.tokenCounter).toBeDefined();
      expect(contextManager.tokenCounter.count("test")).toBe(1);
    });

    it("should use custom counter when provided", () => {
      const customCounter = createCustomTokenCounter({
        countFn: () => 99,
      });
      const manager = createContextManager({
        maxTokens: 1000,
        tokenCounter: customCounter,
      });
      expect(manager.tokenCounter.count("anything")).toBe(99);
    });
  });

  describe("summarizationConfig", () => {
    it("should use defaults when not specified", () => {
      // Note: enabled and tokenThreshold are now in policy, not summarizationConfig
      expect(contextManager.policy.enabled).toBe(true);
      expect(contextManager.policy.tokenThreshold).toBe(0.8);
    });

    it("should merge custom config with defaults", () => {
      const manager = createContextManager({
        maxTokens: 1000,
        summarization: {
          tokenThreshold: 0.9,
        },
      });
      expect(manager.summarizationConfig.tokenThreshold).toBe(0.9);
      expect(manager.summarizationConfig.keepMessageCount).toBe(10); // Default
    });
  });

  describe("getBudget", () => {
    it("should return token budget for messages", () => {
      const messages = createTestMessages(5);
      const budget = contextManager.getBudget(messages);

      expect(budget.maxTokens).toBe(1000);
      expect(budget.currentTokens).toBeGreaterThan(0);
      expect(budget.usage).toBeGreaterThanOrEqual(0);
      expect(budget.usage).toBeLessThanOrEqual(1);
      expect(budget.remaining).toBeGreaterThanOrEqual(0);
    });

    it("should call onBudgetUpdate callback", () => {
      const onBudgetUpdate = vi.fn();
      const manager = createContextManager({
        maxTokens: 1000,
        onBudgetUpdate,
      });

      const messages = createTestMessages(2);
      manager.getBudget(messages);

      expect(onBudgetUpdate).toHaveBeenCalled();
      expect(onBudgetUpdate.mock.calls[0][0]).toHaveProperty("maxTokens");
    });
  });

  describe("shouldCompact", () => {
    it("should return false when under threshold", () => {
      const messages = createTestMessages(2); // Small message set
      expect(contextManager.shouldCompact(messages).trigger).toBe(false);
    });

    it("should return true when over threshold", () => {
      // Create many messages to exceed 80% of 1000 token budget
      const messages = createTestMessages(50);
      const result = contextManager.shouldCompact(messages);
      expect(result.trigger).toBe(true);
      expect(result.reason).toBeDefined();
    });

    it("should return false when compaction is disabled", () => {
      const manager = createContextManager({
        maxTokens: 100, // Very low limit
        policy: { enabled: false },
      });
      const messages = createTestMessages(50); // Would exceed limit
      expect(manager.shouldCompact(messages).trigger).toBe(false);
    });

    it("should respect custom threshold", () => {
      const manager = createContextManager({
        maxTokens: 1000,
        policy: { tokenThreshold: 0.1 }, // Very low threshold
      });
      const messages = createTestMessages(5);
      expect(manager.shouldCompact(messages).trigger).toBe(true);
    });
  });

  describe("compact", () => {
    it("should return unchanged when nothing to compact", async () => {
      const messages = createTestMessages(2);
      const result = await contextManager.compact(messages, mockAgent);

      expect(result.summary).toBe("");
      expect(result.compactedMessages).toHaveLength(0);
      expect(result.newMessages).toEqual(messages);
    });

    it("should compact old messages and keep recent ones", async () => {
      // Create manager with low keepMessageCount
      const manager = createContextManager({
        maxTokens: 1000,
        summarization: { keepMessageCount: 2 },
      });

      const messages = createTestMessages(10);
      const result = await manager.compact(messages, mockAgent);

      // Should have compacted the older messages
      expect(result.compactedMessages.length).toBeGreaterThan(0);
      expect(result.messagesAfter).toBeLessThan(result.messagesBefore);
      expect(result.summary).toContain("Summary");
    });

    it("should call agent.generate for summarization", async () => {
      const manager = createContextManager({
        maxTokens: 1000,
        summarization: { keepMessageCount: 2 },
      });

      const messages = createTestMessages(10);
      await manager.compact(messages, mockAgent);

      expect(mockAgent.generate).toHaveBeenCalled();
    });

    it("should preserve system messages", async () => {
      const manager = createContextManager({
        maxTokens: 1000,
        summarization: { keepMessageCount: 2 },
      });

      const messages: ModelMessage[] = [
        { role: "system", content: "You are a test assistant." },
        ...createTestMessages(10),
      ];

      const result = await manager.compact(messages, mockAgent);

      // System message should be preserved
      const systemMessages = result.newMessages.filter((m) => m.role === "system");
      expect(systemMessages).toHaveLength(1);
    });

    it("should call onCompact callback", async () => {
      const onCompact = vi.fn();
      const manager = createContextManager({
        maxTokens: 1000,
        summarization: { keepMessageCount: 2 },
        onCompact,
      });

      const messages = createTestMessages(10);
      await manager.compact(messages, mockAgent);

      expect(onCompact).toHaveBeenCalled();
    });
  });

  describe("process", () => {
    it("should return unchanged messages when compaction not needed", async () => {
      const messages = createTestMessages(2);
      const result = await contextManager.process(messages, mockAgent);
      expect(result).toEqual(messages);
    });

    it("should compact when threshold exceeded", async () => {
      const manager = createContextManager({
        maxTokens: 100, // Very low limit
        summarization: { keepMessageCount: 2 },
      });

      const messages = createTestMessages(10);
      const result = await manager.process(messages, mockAgent);

      expect(result.length).toBeLessThan(messages.length);
    });
  });
});

// =============================================================================
// Helper Functions Tests
// =============================================================================

describe("extractToolResults", () => {
  it("should extract tool results from messages", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Search for test" },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "search",
            result: { data: "found" },
          },
        ],
      },
    ];

    const results = extractToolResults(messages);
    expect(results).toHaveLength(1);
    expect(results[0].toolName).toBe("search");
    expect(results[0].messageIndex).toBe(1);
  });

  it("should handle messages with no tool results", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];

    const results = extractToolResults(messages);
    expect(results).toHaveLength(0);
  });

  it("should extract multiple tool results", () => {
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "tool1",
            result: "result1",
          },
          {
            type: "tool-result",
            toolCallId: "call-2",
            toolName: "tool2",
            result: "result2",
          },
        ],
      },
    ];

    const results = extractToolResults(messages);
    expect(results).toHaveLength(2);
  });
});

describe("findLastUserMessage", () => {
  it("should find the last user message", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "First message" },
      { role: "assistant", content: "Response" },
      { role: "user", content: "Second message" },
      { role: "assistant", content: "Another response" },
    ];

    expect(findLastUserMessage(messages)).toBe("Second message");
  });

  it("should return undefined for no user messages", () => {
    const messages: ModelMessage[] = [
      { role: "assistant", content: "Response" },
      { role: "system", content: "System message" },
    ];

    expect(findLastUserMessage(messages)).toBeUndefined();
  });

  it("should handle multi-part user messages", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Multi-part message" }],
      },
    ];

    expect(findLastUserMessage(messages)).toBe("Multi-part message");
  });

  it("should return undefined for empty messages", () => {
    expect(findLastUserMessage([])).toBeUndefined();
  });
});

describe("countMessagesByRole", () => {
  it("should count messages by role", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "1" },
      { role: "user", content: "2" },
      { role: "assistant", content: "1" },
      { role: "system", content: "1" },
    ];

    const counts = countMessagesByRole(messages);
    expect(counts.user).toBe(2);
    expect(counts.assistant).toBe(1);
    expect(counts.system).toBe(1);
  });

  it("should return empty object for no messages", () => {
    expect(countMessagesByRole([])).toEqual({});
  });

  it("should handle tool role", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "1" },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "1", toolName: "test", result: "result" }],
      },
    ];

    const counts = countMessagesByRole(messages);
    expect(counts.tool).toBe(1);
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Context Manager Integration", () => {
  it("should track budget updates during processing", async () => {
    const budgetUpdates: TokenBudget[] = [];
    const manager = createContextManager({
      maxTokens: 1000,
      onBudgetUpdate: (budget) => budgetUpdates.push(budget),
    });

    const messages = createTestMessages(5);
    manager.getBudget(messages);

    expect(budgetUpdates).toHaveLength(1);
  });

  it("should work with custom token counter", async () => {
    // Custom counter that counts words
    const wordCounter = createCustomTokenCounter({
      countFn: (text) => text.split(/\s+/).filter(Boolean).length,
    });

    const manager = createContextManager({
      maxTokens: 100,
      tokenCounter: wordCounter,
    });

    const messages: ModelMessage[] = [
      { role: "user", content: "hello world" }, // 2 words
      { role: "assistant", content: "hi there friend" }, // 3 words
    ];

    const budget = manager.getBudget(messages);
    // 4 (overhead) + 2 + 4 (overhead) + 3 = 13
    expect(budget.currentTokens).toBe(13);
  });

  it("should handle real-world conversation pattern", async () => {
    const mockAgent = createMockAgent();
    const compactions: CompactionResult[] = [];

    const manager = createContextManager({
      maxTokens: 500, // Low limit to trigger compaction
      policy: {
        tokenThreshold: 0.5,
      },
      summarization: {
        keepMessageCount: 3,
      },
      onCompact: (result) => compactions.push(result),
    });

    // Simulate a conversation
    const messages: ModelMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello, I need help with my project." },
      { role: "assistant", content: "Of course! What do you need help with?" },
      { role: "user", content: "I want to build a web app with React." },
      {
        role: "assistant",
        content: "Great choice! React is a popular library for building user interfaces.",
      },
      { role: "user", content: "How do I set up routing?" },
      {
        role: "assistant",
        content: "You can use React Router. Install it with: npm install react-router-dom",
      },
      { role: "user", content: "What about state management?" },
      {
        role: "assistant",
        content:
          "For state management, you have several options: Context API, Redux, Zustand, or Jotai.",
      },
    ];

    // Process the conversation
    const processed = await manager.process(messages, mockAgent);

    // Should have triggered compaction due to low token limit
    if (manager.shouldCompact(messages).trigger) {
      expect(compactions).toHaveLength(1);
      expect(processed.length).toBeLessThan(messages.length);
    }
  });
});
