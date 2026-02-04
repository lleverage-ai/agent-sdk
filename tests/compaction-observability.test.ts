import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent } from "../src/agent.js";
import { MemorySaver } from "../src/checkpointer/memory-saver.js";
import { createContextManager } from "../src/context-manager.js";
import type { HookCallback } from "../src/types.js";
import { createMockModel } from "./setup.js";

describe("Context Compaction Observability", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("should emit PreCompact hook before compaction", async () => {
    const preCompactHook: HookCallback = vi.fn();

    const contextManager = createContextManager({
      maxTokens: 5000, // High enough that summary generation (2 messages) won't trigger compaction
      policy: {
        enabled: true,
        tokenThreshold: 0.02, // 2% = 100 tokens threshold for outer conversation
      },
      summarization: {
        keepMessageCount: 1,
      },
    });

    const checkpointer = new MemorySaver();
    const agent = createAgent({
      model: createMockModel(),
      hooks: {
        PreCompact: [preCompactHook],
      },
      contextManager,
      checkpointer,
    });

    // Create messages that exceed the threshold by doing multiple generations
    // With 200 max tokens and 0.4 threshold (80 tokens), we need several messages
    for (let i = 0; i < 8; i++) {
      await agent.generate({
        threadId: "test-thread",
        prompt: `message ${i}: this is a longer message to help exceed the token threshold`,
      });
    }

    // PreCompact hook should have been called
    expect(preCompactHook).toHaveBeenCalled();

    const preCompactInput = preCompactHook.mock.calls[0][0];
    expect(preCompactInput).toMatchObject({
      hook_event_name: "PreCompact",
      session_id: "test-thread",
    });
    expect(preCompactInput.message_count).toBeGreaterThan(0);
    expect(preCompactInput.tokens_before).toBeGreaterThan(0);
  });

  it("should emit PostCompact hook after compaction with metrics", async () => {
    const postCompactHook: HookCallback = vi.fn();

    const contextManager = createContextManager({
      maxTokens: 5000, // High enough that summary generation (2 messages) won't trigger compaction
      policy: {
        enabled: true,
        tokenThreshold: 0.02, // 2% = 100 tokens threshold for outer conversation
      },
      summarization: {
        keepMessageCount: 1,
      },
    });

    const checkpointer = new MemorySaver();
    const agent = createAgent({
      model: createMockModel(),
      hooks: {
        PostCompact: [postCompactHook],
      },
      contextManager,
      checkpointer,
    });

    // Create messages that exceed the threshold by doing multiple generations
    // With 5000 max tokens and 0.02 threshold (100 tokens), we need several messages
    for (let i = 0; i < 8; i++) {
      await agent.generate({
        threadId: "test-thread",
        prompt: `message ${i}: this is a longer message to help exceed the token threshold`,
      });
    }

    // PostCompact hook should have been called
    expect(postCompactHook).toHaveBeenCalled();

    const postCompactInput = postCompactHook.mock.calls[0][0];
    expect(postCompactInput).toMatchObject({
      hook_event_name: "PostCompact",
      session_id: "test-thread",
    });
    expect(postCompactInput.messages_before).toBeGreaterThan(0);
    expect(postCompactInput.messages_after).toBeGreaterThan(0);
    expect(postCompactInput.tokens_before).toBeGreaterThan(0);
    expect(postCompactInput.tokens_after).toBeGreaterThan(0);
    expect(postCompactInput.tokens_saved).toBeGreaterThan(0);
    expect(postCompactInput.messages_after).toBeLessThanOrEqual(postCompactInput.messages_before);
    expect(postCompactInput.tokens_after).toBeLessThan(postCompactInput.tokens_before);
  });

  it("should emit both PreCompact and PostCompact in order", async () => {
    const hookCalls: string[] = [];

    const contextManager = createContextManager({
      maxTokens: 5000, // High enough that summary generation (2 messages) won't trigger compaction
      policy: {
        enabled: true,
        tokenThreshold: 0.02, // 2% = 100 tokens threshold for outer conversation
      },
      summarization: {
        keepMessageCount: 1,
      },
    });

    const checkpointer = new MemorySaver();
    const agent = createAgent({
      model: createMockModel(),
      hooks: {
        PreCompact: [
          async () => {
            hookCalls.push("PreCompact");
          },
        ],
        PostCompact: [
          async () => {
            hookCalls.push("PostCompact");
          },
        ],
      },
      contextManager,
      checkpointer,
    });

    // Create messages that exceed the threshold by doing multiple generations
    // With 5000 max tokens and 0.02 threshold (100 tokens), we need several messages
    for (let i = 0; i < 8; i++) {
      await agent.generate({
        threadId: "test-thread",
        prompt: `message ${i}: this is a longer message to help exceed the token threshold`,
      });
    }

    // Both hooks should be called in the correct order
    expect(hookCalls).toContain("PreCompact");
    expect(hookCalls).toContain("PostCompact");
    const preIndex = hookCalls.indexOf("PreCompact");
    const postIndex = hookCalls.indexOf("PostCompact");
    expect(preIndex).toBeLessThan(postIndex);
  });

  it("should not emit compaction hooks when compaction is not needed", async () => {
    const preCompactHook: HookCallback = vi.fn();
    const postCompactHook: HookCallback = vi.fn();

    const contextManager = createContextManager({
      maxTokens: 10000, // High threshold
      policy: {
        enabled: true,
        tokenThreshold: 0.9, // Only compact at 90% capacity
      },
      summarization: {
        keepMessageCount: 10,
      },
    });

    const agent = createAgent({
      model: createMockModel(),
      hooks: {
        PreCompact: [preCompactHook],
        PostCompact: [postCompactHook],
      },
      contextManager,
    });

    // Generate with a small prompt that won't trigger compaction
    await agent.generate({
      threadId: "test-thread",
      prompt: "short message",
    });

    // No compaction hooks should be called
    expect(preCompactHook).not.toHaveBeenCalled();
    expect(postCompactHook).not.toHaveBeenCalled();
  });

  it("should not emit hooks when contextManager is not configured", async () => {
    const preCompactHook: HookCallback = vi.fn();
    const postCompactHook: HookCallback = vi.fn();

    const agent = createAgent({
      model: createMockModel(),
      hooks: {
        PreCompact: [preCompactHook],
        PostCompact: [postCompactHook],
      },
      // No contextManager configured
    });

    await agent.generate({
      threadId: "test-thread",
      prompt: "test message",
    });

    // No compaction hooks should be called
    expect(preCompactHook).not.toHaveBeenCalled();
    expect(postCompactHook).not.toHaveBeenCalled();
  });

  it("should allow hooks to track compaction statistics", async () => {
    const compactionStats = {
      totalCompactions: 0,
      totalTokensSaved: 0,
      totalMessagesBefore: 0,
      totalMessagesAfter: 0,
    };

    const contextManager = createContextManager({
      maxTokens: 5000, // High enough that summary generation (2 messages) won't trigger compaction
      policy: {
        enabled: true,
        tokenThreshold: 0.02, // 2% = 100 tokens threshold for outer conversation
      },
      summarization: {
        keepMessageCount: 1,
      },
    });

    const checkpointer = new MemorySaver();
    const agent = createAgent({
      model: createMockModel(),
      hooks: {
        PostCompact: [
          async (input) => {
            if (input.hook_event_name === "PostCompact") {
              compactionStats.totalCompactions++;
              compactionStats.totalTokensSaved += input.tokens_saved;
              compactionStats.totalMessagesBefore += input.messages_before;
              compactionStats.totalMessagesAfter += input.messages_after;
            }
          },
        ],
      },
      contextManager,
      checkpointer,
    });

    // Generate multiple times to trigger compaction (need enough to exceed threshold)
    for (let i = 0; i < 5; i++) {
      await agent.generate({
        threadId: "test-thread",
        prompt: `message ${i}: this is a longer message to help exceed token threshold`,
      });
    }

    // Stats should be accumulated
    expect(compactionStats.totalCompactions).toBeGreaterThan(0);
    expect(compactionStats.totalTokensSaved).toBeGreaterThan(0);
    expect(compactionStats.totalMessagesBefore).toBeGreaterThan(0);
    expect(compactionStats.totalMessagesAfter).toBeGreaterThan(0);
  });

  it("should handle errors in compaction hooks gracefully", async () => {
    const postCompactHook: HookCallback = vi.fn();

    const contextManager = createContextManager({
      maxTokens: 5000, // High enough that summary generation (2 messages) won't trigger compaction
      policy: {
        enabled: true,
        tokenThreshold: 0.02, // 2% = 100 tokens threshold for outer conversation
      },
      summarization: {
        keepMessageCount: 1,
      },
    });

    const checkpointer = new MemorySaver();
    const agent = createAgent({
      model: createMockModel(),
      hooks: {
        PreCompact: [
          async () => {
            throw new Error("Hook error");
          },
        ],
        PostCompact: [postCompactHook],
      },
      contextManager,
      checkpointer,
    });

    // Generate multiple times to trigger compaction
    for (let i = 0; i < 5; i++) {
      // Should not throw despite hook error
      await expect(
        agent.generate({
          threadId: "test-thread",
          prompt: `message ${i}: this is a longer message to help exceed token threshold`,
        }),
      ).resolves.toBeDefined();
    }

    // PostCompact hook should still be called
    expect(postCompactHook).toHaveBeenCalled();
  });
});
