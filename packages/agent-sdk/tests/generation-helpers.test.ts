import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError, ModelError } from "../src/errors/index.js";
import {
  createRetryLoopState,
  DEFAULT_MAX_RETRIES,
  handleGenerationError,
  invokePreGenerateHooks,
  normalizeError,
  updateRetryLoopState,
  waitForRetryDelay,
} from "../src/generation-helpers.js";
import type {
  Agent,
  GenerateOptions,
  HookCallback,
  HookCallbackContext,
  HookInput,
} from "../src/types.js";

// Mock agent for tests
const createMockAgent = (): Agent =>
  ({
    options: {
      model: createMockModel(),
    },
    generate: vi.fn(),
    stream: vi.fn(),
    streamResponse: vi.fn(),
    streamRaw: vi.fn(),
    streamDataResponse: vi.fn(),
    close: vi.fn(),
    registerTools: vi.fn(),
    unregisterTools: vi.fn(),
    getActiveTools: vi.fn().mockReturnValue({}),
    loadSkill: vi.fn(),
    state: {
      todos: [],
      files: {},
    },
    getSkills: vi.fn().mockReturnValue([]),
  }) as unknown as Agent;

// Mock model for tests
const createMockModel = () => ({
  specificationVersion: "v1",
  provider: "mock",
  modelId: "mock-model",
  defaultObjectGenerationMode: "json" as const,
  doGenerate: vi.fn(),
  doStream: vi.fn(),
});

describe("generation-helpers", () => {
  describe("DEFAULT_MAX_RETRIES", () => {
    it("should be 10", () => {
      expect(DEFAULT_MAX_RETRIES).toBe(10);
    });
  });

  describe("createRetryLoopState", () => {
    it("should create initial state with default maxRetries", () => {
      const model = createMockModel();
      const state = createRetryLoopState(model);

      expect(state).toEqual({
        retryAttempt: 0,
        maxRetries: DEFAULT_MAX_RETRIES,
        currentModel: model,
        usedFallback: false,
        consecutiveOverloadCount: 0,
        contextOverflowRetryCount: 0,
      });
    });

    it("should create initial state with custom maxRetries", () => {
      const model = createMockModel();
      const state = createRetryLoopState(model, 5);

      expect(state).toEqual({
        retryAttempt: 0,
        maxRetries: 5,
        currentModel: model,
        usedFallback: false,
        consecutiveOverloadCount: 0,
        contextOverflowRetryCount: 0,
      });
    });
  });

  describe("normalizeError", () => {
    it("should return AgentError unchanged", () => {
      const error = new AgentError("test error");
      const result = normalizeError(error, "default message");
      expect(result).toBe(error);
    });

    it("should wrap regular Error", () => {
      const error = new Error("test error");
      const result = normalizeError(error, "default message");
      expect(result).toBeInstanceOf(AgentError);
      expect(result.message).toBe("test error");
    });

    it("should use default message for non-Error objects", () => {
      const error = "string error";
      const result = normalizeError(error, "default message");
      expect(result).toBeInstanceOf(AgentError);
      expect(result.message).toBe("default message");
    });

    it("should include threadId in metadata when provided", () => {
      const error = new Error("test error");
      const result = normalizeError(error, "default", "thread-123");
      expect(result.metadata?.threadId).toBe("thread-123");
    });
  });

  describe("updateRetryLoopState", () => {
    it("should increment retryAttempt", () => {
      const model = createMockModel();
      const state = createRetryLoopState(model);
      const updated = updateRetryLoopState(state, {
        shouldRetry: true,
        retryDelayMs: 0,
        requestClass: "foreground",
        classification: { type: "unknown", subtype: "unknown", retryable: false },
        outcome: "retry",
        source: "hooks",
      });

      expect(updated.retryAttempt).toBe(1);
    });

    it("should update model when provided", () => {
      const model = createMockModel();
      const fallbackModel = createMockModel();
      const state = createRetryLoopState(model);
      const updated = updateRetryLoopState(state, {
        shouldRetry: true,
        retryDelayMs: 0,
        updatedModel: fallbackModel,
        requestClass: "foreground",
        classification: { type: "overload", subtype: "rate_limit", retryable: true },
        outcome: "fallback",
        source: "policy",
      });

      expect(updated.currentModel).toBe(fallbackModel);
    });

    it("should set usedFallback when activatedFallback is true", () => {
      const model = createMockModel();
      const state = createRetryLoopState(model);
      const updated = updateRetryLoopState(state, {
        shouldRetry: true,
        retryDelayMs: 0,
        activatedFallback: true,
        requestClass: "foreground",
        classification: { type: "overload", subtype: "rate_limit", retryable: true },
        outcome: "fallback",
        source: "policy",
      });

      expect(updated.usedFallback).toBe(true);
    });

    it("should preserve previous model when no updatedModel provided", () => {
      const model = createMockModel();
      const state = createRetryLoopState(model);
      const updated = updateRetryLoopState(state, {
        shouldRetry: true,
        retryDelayMs: 0,
        requestClass: "foreground",
        classification: { type: "unknown", subtype: "unknown", retryable: false },
        outcome: "retry",
        source: "hooks",
      });

      expect(updated.currentModel).toBe(model);
    });
  });

  describe("waitForRetryDelay", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("should wait for specified delay", async () => {
      const promise = waitForRetryDelay(100);
      vi.advanceTimersByTime(100);
      await promise;
      // Test passes if promise resolves
    });

    it("should resolve immediately for zero delay", async () => {
      await waitForRetryDelay(0);
      // Test passes if promise resolves without waiting
    });

    it("should not wait for negative delay", async () => {
      await waitForRetryDelay(-100);
      // Test passes if promise resolves without waiting
    });
  });

  describe("invokePreGenerateHooks", () => {
    it("should return original options when no hooks", async () => {
      const agent = createMockAgent();
      const genOptions: GenerateOptions = { prompt: "test" };
      const result = await invokePreGenerateHooks([], genOptions, agent);

      expect(result.effectiveOptions).toBe(genOptions);
      expect(result.cachedResult).toBeUndefined();
    });

    it("should return cachedResult when hook provides respondWith", async () => {
      const agent = createMockAgent();
      const genOptions: GenerateOptions = { prompt: "test" };
      const cachedResult = {
        text: "cached",
        usage: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
      };

      const hook: HookCallback = (
        _input: HookInput,
        _toolUseId: string | null,
        _context: HookCallbackContext,
      ) => {
        return Promise.resolve({
          hookSpecificOutput: { respondWith: cachedResult },
        });
      };

      const result = await invokePreGenerateHooks([hook], genOptions, agent);

      expect(result.cachedResult).toEqual(cachedResult);
    });

    it("should return updatedInput when hook provides it", async () => {
      const agent = createMockAgent();
      const genOptions: GenerateOptions = { prompt: "original" };
      const updatedOptions: GenerateOptions = { prompt: "updated" };

      const hook: HookCallback = (
        _input: HookInput,
        _toolUseId: string | null,
        _context: HookCallbackContext,
      ) => {
        return Promise.resolve({
          hookSpecificOutput: { updatedInput: updatedOptions },
        });
      };

      const result = await invokePreGenerateHooks([hook], genOptions, agent);

      expect(result.effectiveOptions).toEqual(updatedOptions);
      expect(result.cachedResult).toBeUndefined();
    });

    it("should prioritize respondWith over updatedInput", async () => {
      const agent = createMockAgent();
      const genOptions: GenerateOptions = { prompt: "test" };
      const cachedResult = {
        text: "cached",
        usage: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
      };
      const updatedOptions: GenerateOptions = { prompt: "updated" };

      const hook: HookCallback = (
        _input: HookInput,
        _toolUseId: string | null,
        _context: HookCallbackContext,
      ) => {
        return Promise.resolve({
          hookSpecificOutput: {
            respondWith: cachedResult,
            updatedInput: updatedOptions,
          },
        });
      };

      const result = await invokePreGenerateHooks([hook], genOptions, agent);

      expect(result.cachedResult).toEqual(cachedResult);
    });
  });

  describe("handleGenerationError", () => {
    it("should return shouldRetry: false when no hooks and no fallback", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const state = createRetryLoopState(model);
      const error = new AgentError("test error");
      const genOptions: GenerateOptions = { prompt: "test" };

      const result = await handleGenerationError({
        error,
        failureHooks: [],
        genOptions,
        agent,
        state,
      });

      expect(result.shouldRetry).toBe(false);
      expect(result.retryDelayMs).toBe(0);
      expect(result.classification.type).toBe("unknown");
    });

    it("should return shouldRetry: true when hook requests retry", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const state = createRetryLoopState(model);
      const error = new AgentError("test error");
      const genOptions: GenerateOptions = { prompt: "test" };

      const hook: HookCallback = (
        _input: HookInput,
        _toolUseId: string | null,
        _context: HookCallbackContext,
      ) => {
        return Promise.resolve({
          hookSpecificOutput: { retry: true, retryDelayMs: 100 },
        });
      };

      const result = await handleGenerationError({
        error,
        failureHooks: [hook],
        genOptions,
        agent,
        state,
      });

      expect(result.shouldRetry).toBe(true);
      expect(result.retryDelayMs).toBe(100);
    });

    it("should return shouldRetry: false when maxRetries exceeded", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const state = createRetryLoopState(model);
      state.retryAttempt = 10; // At max retries
      const error = new AgentError("test error");
      const genOptions: GenerateOptions = { prompt: "test" };

      const hook: HookCallback = (
        _input: HookInput,
        _toolUseId: string | null,
        _context: HookCallbackContext,
      ) => {
        return Promise.resolve({
          hookSpecificOutput: { retry: true, retryDelayMs: 100 },
        });
      };

      const result = await handleGenerationError({
        error,
        failureHooks: [hook],
        genOptions,
        agent,
        state,
      });

      expect(result.shouldRetry).toBe(false);
    });

    it("should activate fallback model when appropriate", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const fallbackModel = createMockModel();
      const state = createRetryLoopState(model);
      const error = new ModelError("rate limit");
      const genOptions: GenerateOptions = { prompt: "test" };

      const result = await handleGenerationError({
        error,
        failureHooks: [],
        genOptions,
        agent,
        state,
        fallbackModel,
      });

      expect(result.shouldRetry).toBe(true);
      expect(result.updatedModel).toBe(fallbackModel);
      expect(result.activatedFallback).toBe(true);
    });

    it("should not activate fallback if already used", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const fallbackModel = createMockModel();
      const state = createRetryLoopState(model);
      state.usedFallback = true; // Already used fallback
      const error = new ModelError("rate limit");
      const genOptions: GenerateOptions = { prompt: "test" };

      const result = await handleGenerationError({
        error,
        failureHooks: [],
        genOptions,
        agent,
        state,
        fallbackModel,
      });

      expect(result.shouldRetry).toBe(false);
      expect(result.updatedModel).toBeUndefined();
    });

    it("uses request-class policy to fail fast on overload", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const fallbackModel = createMockModel();
      const state = createRetryLoopState(model);
      const error = new ModelError("rate limit");
      const genOptions: GenerateOptions = { prompt: "test", requestClass: "background" };

      const result = await handleGenerationError({
        error,
        failureHooks: [],
        genOptions,
        agent,
        state,
        fallbackModel,
        retryPolicy: {
          requestClasses: {
            background: {
              maxConsecutiveOverloadRetries: 0,
              fallbackOnOverloadExhaustion: false,
            },
          },
        },
      });

      expect(result.shouldRetry).toBe(false);
      expect(result.requestClass).toBe("background");
    });

    it("does not classify timeout-style errors as context overflow", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const state = createRetryLoopState(model);
      const error = new AgentError("Request timed out because it took too long");
      const genOptions: GenerateOptions = { prompt: "test", maxTokens: 1000 };

      const result = await handleGenerationError({
        error,
        failureHooks: [],
        genOptions,
        agent,
        state,
        retryPolicy: {
          contextOverflow: {
            reductionFactor: 0.5,
          },
        },
      });

      expect(result.classification.type).toBe("overload");
      expect(result.updatedOptions).toBeUndefined();
    });

    it("treats authorization markers as authorization even when the error code is authentication", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const state = createRetryLoopState(model);
      const authRecovery = vi.fn(async () => ({ retry: true }));
      const error = new AgentError("Authorization denied by upstream authz policy", {
        code: "AUTHENTICATION_ERROR",
      });
      const genOptions: GenerateOptions = { prompt: "test" };

      const result = await handleGenerationError({
        error,
        failureHooks: [],
        genOptions,
        agent,
        state,
        retryPolicy: {
          onAuthenticationFailure: authRecovery,
        },
      });

      expect(result.classification.type).toBe("authorization");
      expect(authRecovery).not.toHaveBeenCalled();
    });

    it("re-resolves requestClass after hooks update retry options", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const fallbackModel = createMockModel();
      const state = createRetryLoopState(model);
      const error = new ModelError("rate limit");
      const genOptions: GenerateOptions = { prompt: "test", requestClass: "foreground" };

      const hook: HookCallback = async () => ({
        hookSpecificOutput: {
          updatedInput: {
            ...genOptions,
            requestClass: "background",
          },
        },
      });

      const result = await handleGenerationError({
        error,
        failureHooks: [hook],
        genOptions,
        agent,
        state,
        fallbackModel,
        retryPolicy: {
          requestClasses: {
            foreground: {
              maxConsecutiveOverloadRetries: 2,
            },
            background: {
              maxConsecutiveOverloadRetries: 0,
              fallbackOnOverloadExhaustion: false,
            },
          },
        },
      });

      expect(result.shouldRetry).toBe(false);
      expect(result.requestClass).toBe("background");
      expect(result.updatedOptions).toBeUndefined();
    });

    it("reports the current overload streak to failure and decision hooks", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const state = createRetryLoopState(model);
      const failureHook = vi.fn(async () => ({}));
      const decisionHook = vi.fn(async () => ({}));
      const error = new ModelError("rate limit");
      const genOptions: GenerateOptions = { prompt: "test" };

      const result = await handleGenerationError({
        error,
        failureHooks: [failureHook],
        decisionHooks: [decisionHook],
        genOptions,
        agent,
        state,
        retryPolicy: {
          requestClasses: {
            foreground: {
              maxConsecutiveOverloadRetries: 1,
              fallbackOnOverloadExhaustion: false,
            },
          },
        },
      });

      expect(result.shouldRetry).toBe(true);
      expect(failureHook).toHaveBeenCalledWith(
        expect.objectContaining({
          consecutiveOverloadCount: 1,
        }),
        null,
        expect.anything(),
      );
      expect(decisionHook).toHaveBeenCalledWith(
        expect.objectContaining({
          consecutiveOverloadCount: 1,
        }),
        null,
        expect.anything(),
      );
    });

    it("retries after authentication recovery updates options", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const state = createRetryLoopState(model);
      const error = new AgentError("Invalid API key", {
        code: "AUTHENTICATION_ERROR",
      });
      const genOptions: GenerateOptions = { prompt: "test" };

      const result = await handleGenerationError({
        error,
        failureHooks: [],
        genOptions,
        agent,
        state,
        retryPolicy: {
          onAuthenticationFailure: async ({ options }) => ({
            retry: true,
            updatedOptions: {
              ...options,
              headers: { Authorization: "Bearer refreshed-token" },
            },
          }),
        },
      });

      expect(result.shouldRetry).toBe(true);
      expect(result.updatedOptions?.headers).toEqual({
        Authorization: "Bearer refreshed-token",
      });
      expect(result.classification.type).toBe("authentication");
    });

    it("re-resolves requestClass after authentication recovery updates options", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const state = createRetryLoopState(model);
      const error = new AgentError("Invalid API key", {
        code: "AUTHENTICATION_ERROR",
      });
      const genOptions: GenerateOptions = { prompt: "test", requestClass: "foreground" };

      const result = await handleGenerationError({
        error,
        failureHooks: [],
        genOptions,
        agent,
        state,
        retryPolicy: {
          onAuthenticationFailure: async ({ options }) => ({
            retry: true,
            updatedOptions: {
              ...options,
              requestClass: "background",
            },
          }),
        },
      });

      expect(result.shouldRetry).toBe(true);
      expect(result.requestClass).toBe("background");
      expect(result.updatedOptions?.requestClass).toBe("background");
    });

    it("reduces maxTokens on context overflow when configured", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const state = createRetryLoopState(model);
      const error = new AgentError("maximum context length exceeded");
      const genOptions: GenerateOptions = { prompt: "test", maxTokens: 1000 };

      const result = await handleGenerationError({
        error,
        failureHooks: [],
        genOptions,
        agent,
        state,
        retryPolicy: {
          contextOverflow: {
            reductionFactor: 0.5,
            minMaxTokens: 100,
          },
        },
      });

      expect(result.shouldRetry).toBe(true);
      expect(result.updatedOptions?.maxTokens).toBe(500);
      expect(result.classification.type).toBe("context_overflow");
    });
  });
});
