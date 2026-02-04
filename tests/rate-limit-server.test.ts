/**
 * Tests for rate limiter server integration features.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  createManagedRateLimitHooks,
  createRateLimitHooks,
  extractStandardRateLimitHeaders,
  type PostGenerateInput,
  type ServerRateLimitInfo,
  TokenBucketRateLimiter,
} from "../src/hooks/rate-limit.js";

describe("extractStandardRateLimitHeaders", () => {
  it("should extract x-ratelimit-* headers", () => {
    const mockResult = {
      hook_event_name: "PostGenerate" as const,
      response: {
        headers: {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
          "x-ratelimit-reset": "1735689600",
        },
      },
      result: {
        text: "test",
        usage: { totalTokens: 100 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    const info = extractStandardRateLimitHeaders(mockResult);
    expect(info).toEqual({
      limit: 5000,
      remaining: 4999,
      reset: 1735689600,
      retryAfter: undefined,
    });
  });

  it("should extract ratelimit-* headers (without x- prefix)", () => {
    const mockResult = {
      hook_event_name: "PostGenerate" as const,
      response: {
        headers: {
          "ratelimit-limit": "1000",
          "ratelimit-remaining": "500",
          "ratelimit-reset": "1735689700",
        },
      },
      result: {
        text: "test",
        usage: { totalTokens: 100 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    const info = extractStandardRateLimitHeaders(mockResult);
    expect(info).toEqual({
      limit: 1000,
      remaining: 500,
      reset: 1735689700,
      retryAfter: undefined,
    });
  });

  it("should extract retry-after header", () => {
    const mockResult = {
      hook_event_name: "PostGenerate" as const,
      response: {
        headers: {
          "retry-after": "60",
          "x-ratelimit-remaining": "0",
        },
      },
      result: {
        text: "test",
        usage: { totalTokens: 100 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    const info = extractStandardRateLimitHeaders(mockResult);
    expect(info).toEqual({
      limit: undefined,
      remaining: 0,
      reset: undefined,
      retryAfter: 60,
    });
  });

  it("should handle case-insensitive headers", () => {
    const mockResult = {
      hook_event_name: "PostGenerate" as const,
      response: {
        headers: {
          "X-RateLimit-Limit": "3000",
          "X-RATELIMIT-REMAINING": "2500",
        },
      },
      result: {
        text: "test",
        usage: { totalTokens: 100 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    const info = extractStandardRateLimitHeaders(mockResult);
    expect(info).toEqual({
      limit: 3000,
      remaining: 2500,
      reset: undefined,
      retryAfter: undefined,
    });
  });

  it("should return undefined when no rate limit headers present", () => {
    const mockResult = {
      hook_event_name: "PostGenerate" as const,
      response: {
        headers: {
          "content-type": "application/json",
        },
      },
      result: {
        text: "test",
        usage: { totalTokens: 100 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    const info = extractStandardRateLimitHeaders(mockResult);
    expect(info).toBeUndefined();
  });

  it("should return undefined when no headers present", () => {
    const mockResult = {
      hook_event_name: "PostGenerate" as const,
      result: {
        text: "test",
        usage: { totalTokens: 100 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    const info = extractStandardRateLimitHeaders(mockResult);
    expect(info).toBeUndefined();
  });

  it("should handle invalid numeric values gracefully", () => {
    const mockResult = {
      hook_event_name: "PostGenerate" as const,
      response: {
        headers: {
          "x-ratelimit-limit": "invalid",
          "x-ratelimit-remaining": "1000",
        },
      },
      result: {
        text: "test",
        usage: { totalTokens: 100 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    const info = extractStandardRateLimitHeaders(mockResult);
    expect(info).toEqual({
      limit: undefined,
      remaining: 1000,
      reset: undefined,
      retryAfter: undefined,
    });
  });
});

describe("TokenBucketRateLimiter - Server Limits", () => {
  let limiter: TokenBucketRateLimiter;

  beforeEach(() => {
    limiter = new TokenBucketRateLimiter(10000, 60000);
  });

  it("should respect server-provided remaining count", () => {
    limiter.updateServerLimits({ remaining: 0 });
    expect(limiter.tryAcquire()).toBe(false);
  });

  it("should allow when server-provided remaining count is positive", () => {
    limiter.updateServerLimits({ remaining: 100 });
    expect(limiter.tryAcquire()).toBe(true);
  });

  it("should prefer server remaining count over client-side tracking", () => {
    // Record heavy client-side usage
    limiter.recordUsage(9500);
    expect(limiter.getCurrentUsage()).toBe(9500);

    // But server says we have more remaining
    limiter.updateServerLimits({ remaining: 5000 });
    expect(limiter.getRemainingTokens()).toBe(5000);
  });

  it("should store and retrieve server limit info", () => {
    const serverInfo: ServerRateLimitInfo = {
      limit: 10000,
      remaining: 5000,
      reset: 1735689600,
      retryAfter: 60,
    };

    limiter.updateServerLimits(serverInfo);
    expect(limiter.getServerLimits()).toEqual(serverInfo);
  });

  it("should reset server limits when reset() is called", () => {
    limiter.updateServerLimits({ remaining: 1000 });
    limiter.reset();
    expect(limiter.getServerLimits()).toBeUndefined();
  });
});

describe("TokenBucketRateLimiter - Per-Tool Quota", () => {
  let limiter: TokenBucketRateLimiter;

  beforeEach(() => {
    limiter = new TokenBucketRateLimiter(
      10000, // global limit
      60000,
      true, // enable per-tool quota
      {
        Write: 1000,
        Bash: 500,
        Read: 2000,
      },
    );
  });

  it("should track usage per tool independently", () => {
    limiter.recordUsage(800, "Write");
    limiter.recordUsage(400, "Bash");
    limiter.recordUsage(1500, "Read");

    expect(limiter.getCurrentUsage("Write")).toBe(800);
    expect(limiter.getCurrentUsage("Bash")).toBe(400);
    expect(limiter.getCurrentUsage("Read")).toBe(1500);
  });

  it("should enforce per-tool limits", () => {
    limiter.recordUsage(900, "Write");
    expect(limiter.tryAcquire("Write")).toBe(true); // 900 < 1000

    limiter.recordUsage(150, "Write");
    expect(limiter.tryAcquire("Write")).toBe(false); // 1050 > 1000
  });

  it("should not affect other tools when one tool exceeds limit", () => {
    limiter.recordUsage(1100, "Write"); // Exceeds Write limit
    expect(limiter.tryAcquire("Write")).toBe(false);
    expect(limiter.tryAcquire("Bash")).toBe(true); // Bash still allowed
    expect(limiter.tryAcquire("Read")).toBe(true); // Read still allowed
  });

  it("should fall back to global limit for tools without specific limits", () => {
    limiter.recordUsage(9500, "UnknownTool");
    expect(limiter.tryAcquire("UnknownTool")).toBe(true); // 9500 < 10000

    limiter.recordUsage(600, "UnknownTool");
    expect(limiter.tryAcquire("UnknownTool")).toBe(false); // 10100 > 10000
  });

  it("should return tool-specific remaining tokens", () => {
    limiter.recordUsage(700, "Write");
    expect(limiter.getRemainingTokens("Write")).toBe(300); // 1000 - 700

    limiter.recordUsage(300, "Bash");
    expect(limiter.getRemainingTokens("Bash")).toBe(200); // 500 - 300
  });

  it("should aggregate all usage for global getCurrentUsage", () => {
    limiter.recordUsage(500, "Write");
    limiter.recordUsage(300, "Bash");
    limiter.recordUsage(800, "Read");

    // Global usage includes all tools
    expect(limiter.getCurrentUsage()).toBe(1600);
  });
});

describe("createRateLimitHooks - Server Integration", () => {
  it("should integrate server limits in PostGenerate hook", async () => {
    const [_preCheck, postTrack] = createRateLimitHooks({
      enableServerLimits: true,
    });

    const mockPostInput: PostGenerateInput = {
      hook_event_name: "PostGenerate",
      response: {
        headers: {
          "x-ratelimit-remaining": "100",
          "x-ratelimit-reset": "1735689600",
        },
      },
      result: {
        text: "test",
        usage: { totalTokens: 50 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    await postTrack(mockPostInput);
    // Server limits should be stored (verified via managed hooks test below)
  });

  it("should use custom extractor for non-standard headers", async () => {
    const customExtractor = (result: PostGenerateInput): ServerRateLimitInfo | undefined => {
      const headers = (result as any).response?.headers;
      return {
        remaining: Number.parseInt(headers?.["x-custom-remaining"] || "0", 10),
        reset: Number.parseInt(headers?.["x-custom-reset"] || "0", 10),
      };
    };

    const [_preCheck, postTrack] = createRateLimitHooks({
      enableServerLimits: true,
      extractServerLimits: customExtractor,
    });

    const mockPostInput: PostGenerateInput = {
      hook_event_name: "PostGenerate",
      response: {
        headers: {
          "x-custom-remaining": "999",
          "x-custom-reset": "1735689700",
        },
      },
      result: {
        text: "test",
        usage: { totalTokens: 50 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    await postTrack(mockPostInput);
    // Custom extractor should be used
  });

  it("should include server reset time in error message when rate limited", async () => {
    const {
      hooks,
      reset,
      getCurrentUsage: _getCurrentUsage,
    } = createManagedRateLimitHooks({
      maxTokensPerWindow: 100,
      enableServerLimits: true,
    });
    const [preCheck, postTrack] = hooks;

    // First update with server limits showing we're at limit
    const mockPostInput: PostGenerateInput = {
      hook_event_name: "PostGenerate",
      response: {
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1735689600",
        },
      },
      result: {
        text: "test",
        usage: { totalTokens: 100 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    await postTrack(mockPostInput);

    // Now try to make another request - should be denied with reset time
    const mockPreInput = {
      hook_event_name: "PreGenerate" as const,
      options: {},
    };

    const result = await preCheck(mockPreInput);
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("Rate limit resets at");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("2025-01-01"); // Unix timestamp 1735689600

    reset();
  });

  it("should include retry-after in error message when available", async () => {
    const { hooks } = createManagedRateLimitHooks({
      maxTokensPerWindow: 100,
      enableServerLimits: true,
    });
    const [preCheck, postTrack] = hooks;

    // Update with server limits showing retry-after
    const mockPostInput: PostGenerateInput = {
      hook_event_name: "PostGenerate",
      response: {
        headers: {
          "x-ratelimit-remaining": "0",
          "retry-after": "60",
        },
      },
      result: {
        text: "test",
        usage: { totalTokens: 100 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    await postTrack(mockPostInput);

    const mockPreInput = {
      hook_event_name: "PreGenerate" as const,
      options: {},
    };

    const result = await preCheck(mockPreInput);
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("Retry after 60 seconds");
  });
});

describe("createManagedRateLimitHooks - Enhanced Features", () => {
  it("should expose server limits via getServerLimits()", async () => {
    const { hooks, getServerLimits } = createManagedRateLimitHooks({
      enableServerLimits: true,
    });
    const [_preCheck, postTrack] = hooks;

    expect(getServerLimits()).toBeUndefined();

    const mockPostInput: PostGenerateInput = {
      hook_event_name: "PostGenerate",
      response: {
        headers: {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4900",
          "x-ratelimit-reset": "1735689600",
        },
      },
      result: {
        text: "test",
        usage: { totalTokens: 100 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    await postTrack(mockPostInput);

    const serverLimits = getServerLimits();
    expect(serverLimits).toEqual({
      limit: 5000,
      remaining: 4900,
      reset: 1735689600,
      retryAfter: undefined,
    });
  });

  it("should track overall usage regardless of per-tool config", async () => {
    const { hooks, getCurrentUsage, getRemainingTokens } = createManagedRateLimitHooks({
      maxTokensPerWindow: 10000,
      perToolQuota: true, // This is experimental and doesn't affect generation hooks
      toolLimits: {
        Write: 1000,
        Bash: 500,
      },
    });
    const [_preCheck, postTrack] = hooks;

    // Simulate token usage
    const mockPostInput: PostGenerateInput = {
      hook_event_name: "PostGenerate",
      result: {
        text: "test",
        usage: { totalTokens: 300 },
        finishReason: "stop" as const,
        steps: [],
      },
      options: {},
    } as unknown as PostGenerateInput;

    await postTrack(mockPostInput);

    // Per-tool quota doesn't work with generation hooks, so usage is tracked globally
    expect(getCurrentUsage()).toBe(300);
    expect(getRemainingTokens()).toBe(9700);
  });
});
