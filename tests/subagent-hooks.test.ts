/**
 * Tests for subagent hook inheritance.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, createSubagent } from "../src/index.js";
import type { Agent, HookRegistration } from "../src/types.js";
import { createMockModel } from "./setup.js";

describe("Subagent Hook Inheritance", () => {
  let parentAgent: Agent;
  let _parentHookCalled: boolean;
  let _subagentHookCalled: boolean;

  beforeEach(() => {
    _parentHookCalled = false;
    _subagentHookCalled = false;
  });

  describe("Default behavior (inheritHooks: true)", () => {
    it("should inherit all hooks from parent by default", () => {
      const parentHooks: HookRegistration = {
        PreToolUse: [
          {
            callback: async () => {
              _parentHookCalled = true;
              return {};
            },
          },
        ],
      };

      parentAgent = createAgent({
        model: createMockModel(),
        systemPrompt: "Parent agent",
        hooks: parentHooks,
      });

      const subagent = createSubagent(parentAgent, {
        name: "test-subagent",
        description: "Test subagent",
        systemPrompt: "Subagent",
      });

      // Check that hooks were inherited
      expect(subagent.options.hooks).toBeDefined();
      expect(subagent.options.hooks?.PreToolUse).toBeDefined();
      expect(subagent.options.hooks?.PreToolUse?.length).toBe(1);
    });

    it("should inherit all hook event types from parent", () => {
      const parentHooks: HookRegistration = {
        PreToolUse: [{ callback: async () => ({}) }],
        PostToolUse: [{ callback: async () => ({}) }],
        PreGenerate: [async () => ({})],
        PostGenerate: [async () => ({})],
      };

      parentAgent = createAgent({
        model: createMockModel(),
        hooks: parentHooks,
      });

      const subagent = createSubagent(parentAgent, {
        name: "test-subagent",
        description: "Test subagent",
      });

      expect(subagent.options.hooks?.PreToolUse).toBeDefined();
      expect(subagent.options.hooks?.PostToolUse).toBeDefined();
      expect(subagent.options.hooks?.PreGenerate).toBeDefined();
      expect(subagent.options.hooks?.PostGenerate).toBeDefined();
    });

    it("should merge parent and subagent hooks (subagent hooks fire last)", () => {
      const parentHooks: HookRegistration = {
        PreToolUse: [
          {
            callback: async () => {
              _parentHookCalled = true;
              return {};
            },
          },
        ],
      };

      parentAgent = createAgent({
        model: createMockModel(),
        hooks: parentHooks,
      });

      const subagentHooks: HookRegistration = {
        PreToolUse: [
          {
            callback: async () => {
              _subagentHookCalled = true;
              return {};
            },
          },
        ],
      };

      const subagent = createSubagent(parentAgent, {
        name: "test-subagent",
        description: "Test subagent",
        hooks: subagentHooks,
      });

      // Should have both parent and subagent hooks
      expect(subagent.options.hooks?.PreToolUse?.length).toBe(2);
    });
  });

  describe("No inheritance (inheritHooks: false)", () => {
    it("should not inherit hooks when inheritHooks is false", () => {
      const parentHooks: HookRegistration = {
        PreToolUse: [
          {
            callback: async () => {
              _parentHookCalled = true;
              return {};
            },
          },
        ],
      };

      parentAgent = createAgent({
        model: createMockModel(),
        hooks: parentHooks,
      });

      const subagent = createSubagent(parentAgent, {
        name: "test-subagent",
        description: "Test subagent",
        inheritHooks: false,
      });

      // Should not have parent hooks
      expect(subagent.options.hooks).toBeUndefined();
    });

    it("should use only subagent's own hooks when inheritHooks is false", () => {
      const parentHooks: HookRegistration = {
        PreToolUse: [{ callback: async () => ({}) }],
      };

      parentAgent = createAgent({
        model: createMockModel(),
        hooks: parentHooks,
      });

      const subagentHooks: HookRegistration = {
        PostToolUse: [{ callback: async () => ({}) }],
      };

      const subagent = createSubagent(parentAgent, {
        name: "test-subagent",
        description: "Test subagent",
        inheritHooks: false,
        hooks: subagentHooks,
      });

      // Should have only subagent hooks
      expect(subagent.options.hooks?.PreToolUse).toBeUndefined();
      expect(subagent.options.hooks?.PostToolUse).toBeDefined();
      expect(subagent.options.hooks?.PostToolUse?.length).toBe(1);
    });
  });

  describe("Selective inheritance (inheritHooks: string[])", () => {
    it("should inherit only specified hook events", () => {
      const parentHooks: HookRegistration = {
        PreToolUse: [{ callback: async () => ({}) }],
        PostToolUse: [{ callback: async () => ({}) }],
        PreGenerate: [async () => ({})],
        PostGenerate: [async () => ({})],
      };

      parentAgent = createAgent({
        model: createMockModel(),
        hooks: parentHooks,
      });

      const subagent = createSubagent(parentAgent, {
        name: "test-subagent",
        description: "Test subagent",
        inheritHooks: ["PreToolUse", "PostToolUse"], // Only tool hooks
      });

      // Should have only tool hooks
      expect(subagent.options.hooks?.PreToolUse).toBeDefined();
      expect(subagent.options.hooks?.PostToolUse).toBeDefined();
      expect(subagent.options.hooks?.PreGenerate).toBeUndefined();
      expect(subagent.options.hooks?.PostGenerate).toBeUndefined();
    });

    it("should merge selective parent hooks with subagent hooks", () => {
      const parentHooks: HookRegistration = {
        PreToolUse: [{ callback: async () => ({}) }],
        PostToolUse: [{ callback: async () => ({}) }],
        PreGenerate: [async () => ({})],
      };

      parentAgent = createAgent({
        model: createMockModel(),
        hooks: parentHooks,
      });

      const subagentHooks: HookRegistration = {
        PostToolUse: [{ callback: async () => ({}) }],
        PostGenerate: [async () => ({})],
      };

      const subagent = createSubagent(parentAgent, {
        name: "test-subagent",
        description: "Test subagent",
        inheritHooks: ["PreToolUse"], // Only inherit PreToolUse
        hooks: subagentHooks,
      });

      // Should have inherited PreToolUse + subagent PostToolUse/PostGenerate
      expect(subagent.options.hooks?.PreToolUse).toBeDefined();
      expect(subagent.options.hooks?.PreToolUse?.length).toBe(1); // From parent
      expect(subagent.options.hooks?.PostToolUse?.length).toBe(1); // From subagent only
      expect(subagent.options.hooks?.PostGenerate?.length).toBe(1); // From subagent only
      expect(subagent.options.hooks?.PreGenerate).toBeUndefined(); // Not inherited
    });
  });

  describe("Tool filtering for subagents", () => {
    it("should restrict subagent to specified tools", () => {
      parentAgent = createAgent({
        model: createMockModel(),
        tools: {
          read: { description: "", parameters: {}, execute: async () => {} },
          write: { description: "", parameters: {}, execute: async () => {} },
          bash: { description: "", parameters: {}, execute: async () => {} },
        },
      });

      const subagent = createSubagent(parentAgent, {
        name: "reader",
        description: "Read-only subagent",
        allowedTools: ["read"], // Only read tool
      });

      expect(subagent.options.allowedTools).toEqual(["read"]);
    });
  });

  describe("Dangerous tool warnings", () => {
    it("should warn when dangerous tools accessible without security controls", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      parentAgent = createAgent({
        model: createMockModel(),
      });

      // Create subagent with dangerous tools but no security
      createSubagent(parentAgent, {
        name: "dangerous",
        description: "Has bash without security",
        allowedTools: ["bash", "write"],
        inheritHooks: true, // But parent has no hooks
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Subagent "dangerous" has access to dangerous tools'),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[bash, write]"));

      consoleSpy.mockRestore();
    });

    it("should not warn when inheritHooks: false (explicit isolation)", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      parentAgent = createAgent({
        model: createMockModel(),
      });

      // Explicit isolation with inheritHooks: false
      createSubagent(parentAgent, {
        name: "isolated",
        description: "Explicitly isolated",
        allowedTools: ["bash"],
        inheritHooks: false, // Explicit security decision
      });

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should not warn when PreToolUse hooks are present", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      parentAgent = createAgent({
        model: createMockModel(),
      });

      // Has security hooks
      createSubagent(parentAgent, {
        name: "monitored",
        description: "Has security hooks",
        allowedTools: ["bash"],
        hooks: {
          PreToolUse: [{ callback: async () => ({}) }],
        },
      });

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should not warn when no dangerous tools are accessible", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      parentAgent = createAgent({
        model: createMockModel(),
      });

      // Only safe tools
      createSubagent(parentAgent, {
        name: "safe",
        description: "Only safe tools",
        allowedTools: ["read", "search"],
      });

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should identify multiple dangerous tools in warning", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      parentAgent = createAgent({
        model: createMockModel(),
      });

      createSubagent(parentAgent, {
        name: "multi-dangerous",
        description: "Multiple dangerous tools",
        allowedTools: ["bash", "write", "edit", "rm"],
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[bash, write, edit, rm]"));

      consoleSpy.mockRestore();
    });
  });

  describe("Edge cases", () => {
    it("should handle parent with no hooks", () => {
      parentAgent = createAgent({
        model: createMockModel(),
      });

      const subagent = createSubagent(parentAgent, {
        name: "test-subagent",
        description: "Test subagent",
      });

      expect(subagent.options.hooks).toBeUndefined();
    });

    it("should handle empty inheritHooks array", () => {
      const parentHooks: HookRegistration = {
        PreToolUse: [{ callback: async () => ({}) }],
      };

      parentAgent = createAgent({
        model: createMockModel(),
        hooks: parentHooks,
      });

      const subagent = createSubagent(parentAgent, {
        name: "test-subagent",
        description: "Test subagent",
        inheritHooks: [], // Empty array means no inheritance
      });

      expect(subagent.options.hooks).toEqual({});
    });

    it("should handle inheritHooks with non-existent event names", () => {
      const parentHooks: HookRegistration = {
        PreToolUse: [{ callback: async () => ({}) }],
      };

      parentAgent = createAgent({
        model: createMockModel(),
        hooks: parentHooks,
      });

      const subagent = createSubagent(parentAgent, {
        name: "test-subagent",
        description: "Test subagent",
        inheritHooks: ["NonExistentEvent" as any],
      });

      // Should not crash, just ignore non-existent events
      expect(subagent.options.hooks).toEqual({});
    });

    it("should preserve other agent options", () => {
      parentAgent = createAgent({
        model: createMockModel(),
      });

      const subagent = createSubagent(parentAgent, {
        name: "test-subagent",
        description: "Test subagent",
        maxSteps: 5,
        permissionMode: "plan",
        disallowedTools: ["bash"],
      });

      expect(subagent.options.maxSteps).toBe(5);
      expect(subagent.options.permissionMode).toBe("plan");
      expect(subagent.options.disallowedTools).toEqual(["bash"]);
    });
  });

  describe("Documentation examples", () => {
    it("should work with inherit all hooks example", () => {
      const parentHooks: HookRegistration = {
        PreToolUse: [{ callback: async () => ({}) }],
      };

      parentAgent = createAgent({
        model: createMockModel(),
        hooks: parentHooks,
      });

      const subagent = createSubagent(parentAgent, {
        name: "helper",
        description: "Inherits parent hooks",
        inheritHooks: true, // Default
      });

      expect(subagent.options.hooks?.PreToolUse).toBeDefined();
    });

    it("should work with no inheritance example", () => {
      const parentHooks: HookRegistration = {
        PreToolUse: [{ callback: async () => ({}) }],
      };

      parentAgent = createAgent({
        model: createMockModel(),
        hooks: parentHooks,
      });

      const subagent = createSubagent(parentAgent, {
        name: "sandbox",
        description: "Runs without parent hooks",
        inheritHooks: false,
      });

      expect(subagent.options.hooks).toBeUndefined();
    });

    it("should work with selective inheritance example", () => {
      const parentHooks: HookRegistration = {
        PreToolUse: [{ callback: async () => ({}) }],
        PostToolUse: [{ callback: async () => ({}) }],
        PostToolUseFailure: [{ callback: async () => ({}) }],
        PreGenerate: [async () => ({})],
      };

      parentAgent = createAgent({
        model: createMockModel(),
        hooks: parentHooks,
      });

      const subagent = createSubagent(parentAgent, {
        name: "monitored",
        description: "Inherits only tool lifecycle hooks",
        inheritHooks: ["PreToolUse", "PostToolUse", "PostToolUseFailure"],
      });

      expect(subagent.options.hooks?.PreToolUse).toBeDefined();
      expect(subagent.options.hooks?.PostToolUse).toBeDefined();
      expect(subagent.options.hooks?.PostToolUseFailure).toBeDefined();
      expect(subagent.options.hooks?.PreGenerate).toBeUndefined();
    });
  });
});
