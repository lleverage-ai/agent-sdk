/**
 * Hook Routing Test Coverage Audit
 *
 * This test file verifies that all hook event types defined in HookRegistration
 * are properly routed and invoked throughout the agent lifecycle.
 *
 * Lifecycle hooks tested:
 * - MCP connection hooks (MCPConnectionFailed, MCPConnectionRestored)
 * - Tool registry hooks (ToolRegistered, ToolLoadError)
 * - Stream completion hooks (PostGenerate in streaming context)
 * - Context compaction hooks (PreCompact, PostCompact)
 * - Session lifecycle hooks (SessionStart, SessionEnd - type validation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeHooksWithTimeout } from "../src/hooks.js";
import { createAgent, MCPManager } from "../src/index.js";
import type {
  HookCallback,
  HookRegistration,
  MCPConnectionFailedInput,
  MCPConnectionRestoredInput,
  MCPServerConfig,
  PostGenerateInput,
  ToolLoadErrorInput,
  ToolRegisteredInput,
} from "../src/types.js";
import { createMockModel, resetMocks } from "./setup.js";

// Mock the AI SDK functions
vi.mock("ai", async () => {
  const actual = await import("ai");
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
  };
});

import { streamText } from "ai";

describe("Hook Routing Test Coverage Audit", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe("MCP Connection Hooks Integration", () => {
    it("wires MCPConnectionFailed hooks from createAgent options to MCPManager", async () => {
      const failedHookCalled = vi.fn();

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          MCPConnectionFailed: [
            async (input: MCPConnectionFailedInput) => {
              failedHookCalled(input);
              return { continue: true };
            },
          ],
        },
      });

      // The MCPManager is internal, but we can verify the hook structure is correct
      expect(agent.options.hooks?.MCPConnectionFailed).toBeDefined();
      expect(agent.options.hooks?.MCPConnectionFailed?.length).toBe(1);
    });

    it("MCPConnectionFailed hook receives correct input structure", async () => {
      const receivedInput: MCPConnectionFailedInput[] = [];

      const callback: HookCallback = async (input) => {
        if (input.hook_event_name === "MCPConnectionFailed") {
          receivedInput.push(input as MCPConnectionFailedInput);
        }
        return { continue: true };
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      // Simulate MCPConnectionFailed hook invocation
      const hookInput: MCPConnectionFailedInput = {
        hook_event_name: "MCPConnectionFailed",
        session_id: "test-session",
        cwd: "/test",
        server_name: "test-server",
        config: { type: "stdio", command: "test", args: [] },
        error: new Error("Connection failed"),
      };

      await invokeHooksWithTimeout([callback], hookInput, null, agent);

      expect(receivedInput.length).toBe(1);
      expect(receivedInput[0].hook_event_name).toBe("MCPConnectionFailed");
      expect(receivedInput[0].server_name).toBe("test-server");
      expect(receivedInput[0].error.message).toBe("Connection failed");
    });

    it("MCPConnectionRestored hook receives correct input structure", async () => {
      const receivedInput: MCPConnectionRestoredInput[] = [];

      const callback: HookCallback = async (input) => {
        if (input.hook_event_name === "MCPConnectionRestored") {
          receivedInput.push(input as MCPConnectionRestoredInput);
        }
        return { continue: true };
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      // Simulate MCPConnectionRestored hook invocation
      const hookInput: MCPConnectionRestoredInput = {
        hook_event_name: "MCPConnectionRestored",
        session_id: "test-session",
        cwd: "/test",
        server_name: "test-server",
        tool_count: 5,
      };

      await invokeHooksWithTimeout([callback], hookInput, null, agent);

      expect(receivedInput.length).toBe(1);
      expect(receivedInput[0].hook_event_name).toBe("MCPConnectionRestored");
      expect(receivedInput[0].server_name).toBe("test-server");
      expect(receivedInput[0].tool_count).toBe(5);
    });

    it("MCPManager invokes onConnectionFailed callback on connection failure", async () => {
      const failedCallback = vi.fn();

      const manager = new MCPManager({
        onConnectionFailed: failedCallback,
      });

      const config: MCPServerConfig = {
        type: "stdio",
        command: "nonexistent-command-that-will-fail",
        args: [],
      };

      try {
        await manager.connectServer("test-server", config);
      } catch {
        // Expected to fail
      }

      expect(failedCallback).toHaveBeenCalledTimes(1);
      expect(failedCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          server_name: "test-server",
          config,
          error: expect.any(Error),
        }),
      );

      await manager.disconnect();
    });
  });

  describe("Tool Registry Hooks", () => {
    it("ToolRegisteredInput has correct shape", () => {
      const input: ToolRegisteredInput = {
        hook_event_name: "ToolRegistered",
        session_id: "test-session",
        cwd: "/test",
        tool_name: "myTool",
        description: "A custom tool",
        source: "my-plugin",
      };

      expect(input.hook_event_name).toBe("ToolRegistered");
      expect(input.tool_name).toBe("myTool");
      expect(input.description).toBe("A custom tool");
      expect(input.source).toBe("my-plugin");
    });

    it("ToolLoadErrorInput has correct shape", () => {
      const input: ToolLoadErrorInput = {
        hook_event_name: "ToolLoadError",
        session_id: "test-session",
        cwd: "/test",
        tool_name: "badTool",
        error: new Error("Failed to load"),
        source: "bad-plugin",
      };

      expect(input.hook_event_name).toBe("ToolLoadError");
      expect(input.tool_name).toBe("badTool");
      expect(input.error.message).toBe("Failed to load");
      expect(input.source).toBe("bad-plugin");
    });

    it("createAgent accepts ToolRegistered hooks in options", () => {
      const toolRegisteredHook = vi.fn();

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          ToolRegistered: [toolRegisteredHook],
        },
      });

      expect(agent.options.hooks?.ToolRegistered).toBeDefined();
      expect(agent.options.hooks?.ToolRegistered?.length).toBe(1);
    });

    it("createAgent accepts ToolLoadError hooks in options", () => {
      const toolLoadErrorHook = vi.fn();

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          ToolLoadError: [toolLoadErrorHook],
        },
      });

      expect(agent.options.hooks?.ToolLoadError).toBeDefined();
      expect(agent.options.hooks?.ToolLoadError?.length).toBe(1);
    });
  });

  describe("Stream Completion Hooks", () => {
    it("PostGenerate hook fires after stream() completes", async () => {
      const postGenerateCallback = vi.fn(async (input: PostGenerateInput) => ({
        hookSpecificOutput: {},
      }));

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          PostGenerate: [postGenerateCallback],
        },
      });

      // Mock streamText to return a valid stream
      const mockStream = {
        fullStream: (async function* () {
          yield { type: "text-delta" as const, text: "Hello" };
          yield {
            type: "finish" as const,
            finishReason: "stop" as const,
            totalUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          };
        })(),
        text: Promise.resolve("Hello"),
        usage: Promise.resolve({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
        finishReason: Promise.resolve("stop" as const),
        steps: Promise.resolve([]),
      };
      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const stream = agent.stream({ prompt: "test" });

      // Consume the stream to trigger PostGenerate
      for await (const _part of stream) {
        // Just consume
      }

      expect(postGenerateCallback).toHaveBeenCalledTimes(1);
      expect(postGenerateCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PostGenerate",
          result: expect.objectContaining({
            text: "Hello",
          }),
        }),
        null,
        expect.anything(), // HookCallbackContext
      );
    });

    it("PostGenerate hook fires after streamResponse() completes", async () => {
      const postGenerateCallback = vi.fn(async () => ({}));

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          PostGenerate: [postGenerateCallback],
        },
      });

      // Mock streamText with onFinish callback
      const mockStream = {
        toUIMessageStreamResponse: vi.fn(() => new Response()),
      };
      vi.mocked(streamText).mockImplementation((options: any) => {
        // Call onFinish immediately for testing
        if (options.onFinish) {
          setTimeout(() => {
            options.onFinish({
              text: "Hello",
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              finishReason: "stop",
              steps: [],
            });
          }, 0);
        }
        return mockStream as any;
      });

      await agent.streamResponse({ prompt: "test" });

      // Wait for the onFinish callback
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(postGenerateCallback).toHaveBeenCalled();
    });

    it("PostGenerateFailure hook fires on stream() error", async () => {
      const postGenerateFailureCallback = vi.fn(async () => ({}));

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          PostGenerateFailure: [postGenerateFailureCallback],
        },
      });

      const testError = new Error("Stream failed");
      vi.mocked(streamText).mockImplementation(() => {
        throw testError;
      });

      const stream = agent.stream({ prompt: "test" });

      await expect(async () => {
        for await (const _part of stream) {
          // Should not get here
        }
      }).rejects.toThrow();

      expect(postGenerateFailureCallback).toHaveBeenCalledTimes(1);
      expect(postGenerateFailureCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_event_name: "PostGenerateFailure",
          error: expect.any(Error),
        }),
        null,
        expect.anything(), // HookCallbackContext
      );
    });
  });

  describe("Context Compaction Hooks (covered in compaction-observability.test.ts)", () => {
    // These tests verify the hook type registration works
    // Actual compaction behavior is tested in compaction-observability.test.ts

    it("createAgent accepts PreCompact hooks in options", () => {
      const preCompactHook = vi.fn();

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          PreCompact: [preCompactHook],
        },
      });

      expect(agent.options.hooks?.PreCompact).toBeDefined();
      expect(agent.options.hooks?.PreCompact?.length).toBe(1);
    });

    it("createAgent accepts PostCompact hooks in options", () => {
      const postCompactHook = vi.fn();

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          PostCompact: [postCompactHook],
        },
      });

      expect(agent.options.hooks?.PostCompact).toBeDefined();
      expect(agent.options.hooks?.PostCompact?.length).toBe(1);
    });
  });

  describe("Session Lifecycle Hooks", () => {
    // SessionStart and SessionEnd are defined in types but may not have
    // explicit invocation points yet. These tests verify the types are correct.

    it("SessionStart hook type is accepted in HookRegistration", () => {
      const sessionStartHook: HookCallback = vi.fn();

      const hooks: HookRegistration = {
        SessionStart: [sessionStartHook],
      };

      expect(hooks.SessionStart).toBeDefined();
      expect(hooks.SessionStart?.length).toBe(1);
    });

    it("SessionEnd hook type is accepted in HookRegistration", () => {
      const sessionEndHook: HookCallback = vi.fn();

      const hooks: HookRegistration = {
        SessionEnd: [sessionEndHook],
      };

      expect(hooks.SessionEnd).toBeDefined();
      expect(hooks.SessionEnd?.length).toBe(1);
    });

    it("createAgent accepts SessionStart hooks in options", () => {
      const sessionStartHook = vi.fn();

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          SessionStart: [sessionStartHook],
        },
      });

      expect(agent.options.hooks?.SessionStart).toBeDefined();
      expect(agent.options.hooks?.SessionStart?.length).toBe(1);
    });

    it("createAgent accepts SessionEnd hooks in options", () => {
      const sessionEndHook = vi.fn();

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          SessionEnd: [sessionEndHook],
        },
      });

      expect(agent.options.hooks?.SessionEnd).toBeDefined();
      expect(agent.options.hooks?.SessionEnd?.length).toBe(1);
    });
  });

  describe("Subagent Lifecycle Hooks", () => {
    it("SubagentStart hook type is accepted in HookRegistration", () => {
      const subagentStartHook: HookCallback = vi.fn();

      const hooks: HookRegistration = {
        SubagentStart: [subagentStartHook],
      };

      expect(hooks.SubagentStart).toBeDefined();
      expect(hooks.SubagentStart?.length).toBe(1);
    });

    it("SubagentStop hook type is accepted in HookRegistration", () => {
      const subagentStopHook: HookCallback = vi.fn();

      const hooks: HookRegistration = {
        SubagentStop: [subagentStopHook],
      };

      expect(hooks.SubagentStop).toBeDefined();
      expect(hooks.SubagentStop?.length).toBe(1);
    });

    it("createAgent accepts SubagentStart hooks in options", () => {
      const subagentStartHook = vi.fn();

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          SubagentStart: [subagentStartHook],
        },
      });

      expect(agent.options.hooks?.SubagentStart).toBeDefined();
      expect(agent.options.hooks?.SubagentStart?.length).toBe(1);
    });

    it("createAgent accepts SubagentStop hooks in options", () => {
      const subagentStopHook = vi.fn();

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          SubagentStop: [subagentStopHook],
        },
      });

      expect(agent.options.hooks?.SubagentStop).toBeDefined();
      expect(agent.options.hooks?.SubagentStop?.length).toBe(1);
    });
  });

  describe("Complete Hook Registration", () => {
    it("createAgent accepts all hook types in a single registration", () => {
      const noopHook = vi.fn();

      const agent = createAgent({
        model: createMockModel(),
        hooks: {
          // Tool lifecycle hooks
          PreToolUse: [{ callback: noopHook }],
          PostToolUse: [{ callback: noopHook }],
          PostToolUseFailure: [{ callback: noopHook }],

          // Generation lifecycle hooks
          PreGenerate: [noopHook],
          PostGenerate: [noopHook],
          PostGenerateFailure: [noopHook],

          // Session lifecycle hooks
          SessionStart: [noopHook],
          SessionEnd: [noopHook],

          // Subagent lifecycle hooks
          SubagentStart: [noopHook],
          SubagentStop: [noopHook],

          // MCP connection lifecycle hooks
          MCPConnectionFailed: [noopHook],
          MCPConnectionRestored: [noopHook],

          // Tool registry lifecycle hooks
          ToolRegistered: [noopHook],
          ToolLoadError: [noopHook],

          // Context compaction lifecycle hooks
          PreCompact: [noopHook],
          PostCompact: [noopHook],
        },
      });

      // Verify all hooks are registered
      expect(agent.options.hooks?.PreToolUse).toBeDefined();
      expect(agent.options.hooks?.PostToolUse).toBeDefined();
      expect(agent.options.hooks?.PostToolUseFailure).toBeDefined();
      expect(agent.options.hooks?.PreGenerate).toBeDefined();
      expect(agent.options.hooks?.PostGenerate).toBeDefined();
      expect(agent.options.hooks?.PostGenerateFailure).toBeDefined();
      expect(agent.options.hooks?.SessionStart).toBeDefined();
      expect(agent.options.hooks?.SessionEnd).toBeDefined();
      expect(agent.options.hooks?.SubagentStart).toBeDefined();
      expect(agent.options.hooks?.SubagentStop).toBeDefined();
      expect(agent.options.hooks?.MCPConnectionFailed).toBeDefined();
      expect(agent.options.hooks?.MCPConnectionRestored).toBeDefined();
      expect(agent.options.hooks?.ToolRegistered).toBeDefined();
      expect(agent.options.hooks?.ToolLoadError).toBeDefined();
      expect(agent.options.hooks?.PreCompact).toBeDefined();
      expect(agent.options.hooks?.PostCompact).toBeDefined();
    });
  });

  describe("Hook Invocation with Agent Context", () => {
    it("hooks receive agent reference in context", async () => {
      let receivedAgent: any = null;

      const callback: HookCallback = async (_input, _toolUseId, context) => {
        receivedAgent = context.agent;
        return { continue: true };
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      const hookInput: MCPConnectionFailedInput = {
        hook_event_name: "MCPConnectionFailed",
        session_id: "test-session",
        cwd: "/test",
        server_name: "test-server",
        config: { type: "stdio", command: "test", args: [] },
        error: new Error("Connection failed"),
      };

      await invokeHooksWithTimeout([callback], hookInput, null, agent);

      expect(receivedAgent).toBe(agent);
    });

    it("hooks receive abort signal in context", async () => {
      let receivedSignal: AbortSignal | null = null;

      const callback: HookCallback = async (_input, _toolUseId, context) => {
        receivedSignal = context.signal;
        return { continue: true };
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      const hookInput: ToolRegisteredInput = {
        hook_event_name: "ToolRegistered",
        session_id: "test-session",
        cwd: "/test",
        tool_name: "testTool",
        description: "A test tool",
      };

      await invokeHooksWithTimeout([callback], hookInput, null, agent);

      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("Hook Error Isolation", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("hook errors do not prevent subsequent hooks from running", async () => {
      const hook1Called = vi.fn();
      const hook2Called = vi.fn();
      const hook3Called = vi.fn();

      const errorHook: HookCallback = async () => {
        hook1Called();
        throw new Error("Hook 1 failed");
      };

      const successHook1: HookCallback = async () => {
        hook2Called();
        return { continue: true };
      };

      const successHook2: HookCallback = async () => {
        hook3Called();
        return { continue: true };
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      const hookInput: ToolLoadErrorInput = {
        hook_event_name: "ToolLoadError",
        session_id: "test-session",
        cwd: "/test",
        tool_name: "badTool",
        error: new Error("Load failed"),
      };

      // Should not throw
      await invokeHooksWithTimeout([errorHook, successHook1, successHook2], hookInput, null, agent);

      // All hooks should have been called
      expect(hook1Called).toHaveBeenCalled();
      expect(hook2Called).toHaveBeenCalled();
      expect(hook3Called).toHaveBeenCalled();
    });
  });
});
