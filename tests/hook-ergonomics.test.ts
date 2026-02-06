/**
 * Tests for hook ergonomics improvements.
 *
 * Verifies that:
 * 1. Hooks can return void/undefined for observation-only use cases
 * 2. createToolHook helper simplifies tool hook creation
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, createToolHook } from "../src/index.js";
import type { HookCallback } from "../src/types.js";
import { createMockModel, resetMocks } from "./setup.js";

describe("Hook Ergonomics", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("Void return for observation hooks", () => {
    it("allows PreGenerate hook to return void", () => {
      const loggingHook: HookCallback = (input, _toolUseId, _ctx) => {
        console.log("PreGenerate called:", input.hook_event_name);
        // No return statement - returns void implicitly
      };

      const model = createMockModel();
      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [loggingHook],
        },
      });

      expect(agent).toBeDefined();
    });

    it("allows PreGenerate hook to return undefined explicitly", () => {
      const loggingHook: HookCallback = (input, _toolUseId, _ctx) => {
        console.log("PreGenerate called:", input.hook_event_name);
        return undefined;
      };

      const model = createMockModel();
      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [loggingHook],
        },
      });

      expect(agent).toBeDefined();
    });

    it("allows async PreGenerate hook to return void", async () => {
      const loggingHook: HookCallback = async (input, _toolUseId, _ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        console.log("PreGenerate called:", input.hook_event_name);
        // No return statement - async function returns Promise<void>
      };

      const model = createMockModel();
      const agent = createAgent({
        model,
        hooks: {
          PreGenerate: [loggingHook],
        },
      });

      expect(agent).toBeDefined();
    });
  });

  describe("createToolHook helper", () => {
    it("creates a HookMatcher from a simple callback", () => {
      const callback: HookCallback = (input, _toolUseId, _ctx) => {
        console.log("Tool called:", input.tool_name);
      };

      const matcher = createToolHook(callback);

      expect(matcher).toHaveProperty("hooks");
      expect(matcher.hooks).toHaveLength(1);
      expect(matcher.hooks[0]).toBe(callback);
      expect(matcher.matcher).toBeUndefined(); // Matches all tools
      expect(matcher.timeout).toBeUndefined(); // Uses default timeout
    });

    it("creates a HookMatcher with matcher pattern", () => {
      const callback: HookCallback = (input, _toolUseId, _ctx) => {
        console.log("File operation:", input.tool_name);
      };

      const matcher = createToolHook(callback, {
        matcher: "read|write|edit",
      });

      expect(matcher.matcher).toBe("read|write|edit");
      expect(matcher.hooks).toHaveLength(1);
    });

    it("creates a HookMatcher with custom timeout", () => {
      const callback: HookCallback = (input, _toolUseId, _ctx) => {
        console.log("Tool called:", input.tool_name);
      };

      const matcher = createToolHook(callback, {
        timeout: 5000,
      });

      expect(matcher.timeout).toBe(5000);
    });

    it("can be used with createAgent", () => {
      const loggingHook = createToolHook((input, _toolUseId, _ctx) => {
        console.log("Tool called:", input.tool_name);
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        hooks: {
          PreToolUse: [loggingHook],
        },
      });

      expect(agent).toBeDefined();
    });

    it("works with matcher pattern and agent", () => {
      const fileOpHook = createToolHook(
        (input, _toolUseId, _ctx) => {
          console.log("File operation:", input.tool_name);
        },
        {
          matcher: "read|write|edit",
          timeout: 5000,
        },
      );

      const model = createMockModel();
      const agent = createAgent({
        model,
        hooks: {
          PreToolUse: [fileOpHook],
        },
      });

      expect(agent).toBeDefined();
    });

    it("allows mixing createToolHook with manual HookMatchers", () => {
      const simpleHook = createToolHook((input) => {
        console.log("Any tool:", input.tool_name);
      });

      const manualMatcher = {
        matcher: "bash",
        hooks: [
          (input) => {
            console.log("Bash tool:", input.tool_name);
            return {};
          },
        ],
      };

      const model = createMockModel();
      const agent = createAgent({
        model,
        hooks: {
          PreToolUse: [simpleHook, manualMatcher],
        },
      });

      expect(agent).toBeDefined();
    });
  });

  describe("Real-world hook scenarios", () => {
    it("simple logging hook without return boilerplate", () => {
      const spy = vi.fn();

      // Before: Required HookMatcher boilerplate
      // const oldStyle = {
      //   hooks: [(input) => {
      //     spy(input.tool_name);
      //     return {}; // Required even though we don't use it
      //   }]
      // };

      // After: Clean and simple
      const newStyle = createToolHook((input) => {
        spy(input.tool_name);
        // No return needed!
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        hooks: {
          PreToolUse: [newStyle],
        },
      });

      expect(agent).toBeDefined();
      expect(newStyle).toHaveProperty("hooks");
    });

    it("combines observation hooks with control hooks", () => {
      // Observation hook - just logs
      const loggingHook = createToolHook((input) => {
        console.log("Tool:", input.tool_name);
      });

      // Control hook - modifies behavior
      const guardHook = createToolHook(
        (input) => {
          if (input.tool_name === "bash") {
            return {
              hookSpecificOutput: {
                permissionDecision: "deny" as const,
              },
            };
          }
          return { hookSpecificOutput: { permissionDecision: "allow" as const } };
        },
        {
          matcher: "bash",
        },
      );

      const model = createMockModel();
      const agent = createAgent({
        model,
        hooks: {
          PreToolUse: [loggingHook, guardHook],
        },
      });

      expect(agent).toBeDefined();
    });
  });
});
