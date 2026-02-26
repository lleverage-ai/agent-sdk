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
      });

      expect(updated.usedFallback).toBe(true);
    });

    it("should preserve previous model when no updatedModel provided", () => {
      const model = createMockModel();
      const state = createRetryLoopState(model);
      const updated = updateRetryLoopState(state, {
        shouldRetry: true,
        retryDelayMs: 0,
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

      const result = await handleGenerationError(
        error,
        [],
        genOptions,
        agent,
        state,
        undefined,
        undefined,
      );

      expect(result.shouldRetry).toBe(false);
      expect(result.retryDelayMs).toBe(0);
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

      const result = await handleGenerationError(
        error,
        [hook],
        genOptions,
        agent,
        state,
        undefined,
        undefined,
      );

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

      const result = await handleGenerationError(
        error,
        [hook],
        genOptions,
        agent,
        state,
        undefined,
        undefined,
      );

      expect(result.shouldRetry).toBe(false);
    });

    it("should activate fallback model when appropriate", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const fallbackModel = createMockModel();
      const state = createRetryLoopState(model);
      const error = new ModelError("rate limit");
      const genOptions: GenerateOptions = { prompt: "test" };

      // shouldUseFallback returns true for any error
      const shouldUseFallback = vi.fn().mockReturnValue(true);

      const result = await handleGenerationError(
        error,
        [],
        genOptions,
        agent,
        state,
        fallbackModel,
        shouldUseFallback,
      );

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

      const shouldUseFallback = vi.fn().mockReturnValue(true);

      const result = await handleGenerationError(
        error,
        [],
        genOptions,
        agent,
        state,
        fallbackModel,
        shouldUseFallback,
      );

      expect(result.shouldRetry).toBe(false);
      expect(result.updatedModel).toBeUndefined();
    });

    it("should not activate fallback if shouldUseFallback returns false", async () => {
      const agent = createMockAgent();
      const model = createMockModel();
      const fallbackModel = createMockModel();
      const state = createRetryLoopState(model);
      const error = new ModelError("rate limit");
      const genOptions: GenerateOptions = { prompt: "test" };

      const shouldUseFallback = vi.fn().mockReturnValue(false);

      const result = await handleGenerationError(
        error,
        [],
        genOptions,
        agent,
        state,
        fallbackModel,
        shouldUseFallback,
      );

      expect(result.shouldRetry).toBe(false);
    });
  });
});
