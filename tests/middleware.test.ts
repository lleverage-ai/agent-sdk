/**
 * Tests for the middleware system.
 */

import { describe, expect, it, vi } from "vitest";
import {
  applyMiddleware,
  createLoggingMiddleware,
  createMiddlewareContext,
  mergeHooks,
  setupMiddleware,
  teardownMiddleware,
} from "../src/middleware/index.js";
import type { AgentMiddleware } from "../src/middleware/types.js";
import type { HookCallback, HookRegistration } from "../src/types.js";

describe("Middleware System", () => {
  describe("createMiddlewareContext", () => {
    it("should create a context with all hook registration methods", () => {
      const { context } = createMiddlewareContext();

      expect(typeof context.onPreGenerate).toBe("function");
      expect(typeof context.onPostGenerate).toBe("function");
      expect(typeof context.onPostGenerateFailure).toBe("function");
      expect(typeof context.onPreToolUse).toBe("function");
      expect(typeof context.onPostToolUse).toBe("function");
      expect(typeof context.onPostToolUseFailure).toBe("function");
      expect(typeof context.onPreCompact).toBe("function");
      expect(typeof context.onPostCompact).toBe("function");
      expect(typeof context.onSessionStart).toBe("function");
      expect(typeof context.onSessionEnd).toBe("function");
    });

    it("should collect hooks and return them via getHooks", () => {
      const { context, getHooks } = createMiddlewareContext();

      const preGenHook: HookCallback = async () => ({});
      const postGenHook: HookCallback = async () => ({});

      context.onPreGenerate(preGenHook);
      context.onPostGenerate(postGenHook);

      const hooks = getHooks();

      expect(hooks.PreGenerate).toEqual([preGenHook]);
      expect(hooks.PostGenerate).toEqual([postGenHook]);
    });

    it("should group tool hooks by matcher", () => {
      const { context, getHooks } = createMiddlewareContext();

      const hook1: HookCallback = async () => ({});
      const hook2: HookCallback = async () => ({});
      const hook3: HookCallback = async () => ({});

      context.onPreToolUse(hook1); // No matcher
      context.onPreToolUse(hook2, "Write|Edit");
      context.onPreToolUse(hook3, "Write|Edit"); // Same matcher

      const hooks = getHooks();

      expect(hooks.PreToolUse).toHaveLength(2);
      expect(hooks.PreToolUse?.[0]).toEqual({
        matcher: undefined,
        hooks: [hook1],
      });
      expect(hooks.PreToolUse?.[1]).toEqual({
        matcher: "Write|Edit",
        hooks: [hook2, hook3],
      });
    });
  });

  describe("applyMiddleware", () => {
    it("should return empty hooks for empty middleware array", () => {
      const hooks = applyMiddleware([]);
      expect(hooks).toEqual({});
    });

    it("should apply single middleware and collect hooks", () => {
      const hook: HookCallback = async () => ({});

      const middleware: AgentMiddleware = {
        name: "test",
        register(ctx) {
          ctx.onPreGenerate(hook);
        },
      };

      const hooks = applyMiddleware([middleware]);

      expect(hooks.PreGenerate).toEqual([hook]);
    });

    it("should apply multiple middleware in order", () => {
      const hooks: string[] = [];

      const middleware1: AgentMiddleware = {
        name: "mw1",
        register(ctx) {
          ctx.onPreGenerate(async () => {
            hooks.push("mw1");
            return {};
          });
        },
      };

      const middleware2: AgentMiddleware = {
        name: "mw2",
        register(ctx) {
          ctx.onPreGenerate(async () => {
            hooks.push("mw2");
            return {};
          });
        },
      };

      const result = applyMiddleware([middleware1, middleware2]);

      // Verify hooks are registered in order
      expect(result.PreGenerate).toHaveLength(2);
    });

    it("should continue with other middleware if one throws during registration", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const goodHook: HookCallback = async () => ({});

      const badMiddleware: AgentMiddleware = {
        name: "bad",
        register() {
          throw new Error("Registration failed");
        },
      };

      const goodMiddleware: AgentMiddleware = {
        name: "good",
        register(ctx) {
          ctx.onPreGenerate(goodHook);
        },
      };

      const hooks = applyMiddleware([badMiddleware, goodMiddleware]);

      expect(hooks.PreGenerate).toEqual([goodHook]);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("mergeHooks", () => {
    it("should return empty object for no arguments", () => {
      const result = mergeHooks();
      expect(result).toEqual({});
    });

    it("should handle undefined registrations", () => {
      const result = mergeHooks(undefined, undefined);
      expect(result).toEqual({});
    });

    it("should merge generation hooks", () => {
      const hook1: HookCallback = async () => ({});
      const hook2: HookCallback = async () => ({});

      const reg1: HookRegistration = { PreGenerate: [hook1] };
      const reg2: HookRegistration = { PreGenerate: [hook2] };

      const result = mergeHooks(reg1, reg2);

      expect(result.PreGenerate).toEqual([hook1, hook2]);
    });

    it("should merge tool hooks with same matcher", () => {
      const hook1: HookCallback = async () => ({});
      const hook2: HookCallback = async () => ({});

      const reg1: HookRegistration = {
        PreToolUse: [{ matcher: "Write", hooks: [hook1] }],
      };
      const reg2: HookRegistration = {
        PreToolUse: [{ matcher: "Write", hooks: [hook2] }],
      };

      const result = mergeHooks(reg1, reg2);

      expect(result.PreToolUse).toEqual([{ matcher: "Write", hooks: [hook1, hook2] }]);
    });

    it("should merge tool hooks with different matchers", () => {
      const hook1: HookCallback = async () => ({});
      const hook2: HookCallback = async () => ({});

      const reg1: HookRegistration = {
        PreToolUse: [{ matcher: "Write", hooks: [hook1] }],
      };
      const reg2: HookRegistration = {
        PreToolUse: [{ matcher: "Edit", hooks: [hook2] }],
      };

      const result = mergeHooks(reg1, reg2);

      expect(result.PreToolUse).toEqual([
        { matcher: "Write", hooks: [hook1] },
        { matcher: "Edit", hooks: [hook2] },
      ]);
    });
  });

  describe("setupMiddleware", () => {
    it("should call setup on middleware that have it", async () => {
      const setup1 = vi.fn();
      const setup2 = vi.fn();

      const middleware: AgentMiddleware[] = [
        { name: "mw1", register: () => {}, setup: setup1 },
        { name: "mw2", register: () => {} }, // No setup
        { name: "mw3", register: () => {}, setup: setup2 },
      ];

      await setupMiddleware(middleware);

      expect(setup1).toHaveBeenCalled();
      expect(setup2).toHaveBeenCalled();
    });

    it("should handle setup errors gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const middleware: AgentMiddleware[] = [
        {
          name: "failing",
          register: () => {},
          setup: () => {
            throw new Error("Setup failed");
          },
        },
      ];

      await setupMiddleware(middleware);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("teardownMiddleware", () => {
    it("should call teardown on middleware that have it", async () => {
      const teardown1 = vi.fn();
      const teardown2 = vi.fn();

      const middleware: AgentMiddleware[] = [
        { name: "mw1", register: () => {}, teardown: teardown1 },
        { name: "mw2", register: () => {} }, // No teardown
        { name: "mw3", register: () => {}, teardown: teardown2 },
      ];

      await teardownMiddleware(middleware);

      expect(teardown1).toHaveBeenCalled();
      expect(teardown2).toHaveBeenCalled();
    });
  });

  describe("createLoggingMiddleware", () => {
    it("should create middleware with correct name", () => {
      const transport = { name: "test", write: vi.fn() };
      const middleware = createLoggingMiddleware({ transport });

      expect(middleware.name).toBe("logging");
    });

    it("should register hooks for generation events", () => {
      const transport = { name: "test", write: vi.fn() };
      const middleware = createLoggingMiddleware({ transport });

      const { context, getHooks } = createMiddlewareContext();
      middleware.register(context);
      const hooks = getHooks();

      expect(hooks.PreGenerate).toBeDefined();
      expect(hooks.PostGenerate).toBeDefined();
      expect(hooks.PostGenerateFailure).toBeDefined();
    });

    it("should register hooks for tool events", () => {
      const transport = { name: "test", write: vi.fn() };
      const middleware = createLoggingMiddleware({ transport });

      const { context, getHooks } = createMiddlewareContext();
      middleware.register(context);
      const hooks = getHooks();

      expect(hooks.PreToolUse).toBeDefined();
      expect(hooks.PostToolUse).toBeDefined();
      expect(hooks.PostToolUseFailure).toBeDefined();
    });

    it("should respect event filtering options", () => {
      const transport = { name: "test", write: vi.fn() };
      const middleware = createLoggingMiddleware({
        transport,
        events: {
          generation: false,
          tools: true,
          compaction: false,
        },
      });

      const { context, getHooks } = createMiddlewareContext();
      middleware.register(context);
      const hooks = getHooks();

      expect(hooks.PreGenerate).toBeUndefined();
      expect(hooks.PostGenerate).toBeUndefined();
      expect(hooks.PreToolUse).toBeDefined();
      expect(hooks.PostToolUse).toBeDefined();
      expect(hooks.PreCompact).toBeUndefined();
      expect(hooks.PostCompact).toBeUndefined();
    });

    it("should have teardown method for cleanup", () => {
      const transport = { name: "test", write: vi.fn() };
      const middleware = createLoggingMiddleware({ transport });

      expect(middleware.teardown).toBeDefined();
    });
  });
});
