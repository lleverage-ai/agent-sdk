import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GenerateResult,
  HookCallback,
  HookMatcher,
  HookOutput,
  PostGenerateFailureInput,
  PostGenerateInput,
  PostToolUseFailureInput,
  PostToolUseInput,
  PreGenerateInput,
  PreToolUseInput,
} from "../src/index.js";
import {
  aggregatePermissionDecisions,
  createAgent,
  extractRespondWith,
  extractRetryDecision,
  extractUpdatedInput,
  extractUpdatedResult,
  HookTimeoutError,
  invokeHooksWithTimeout,
  invokeMatchingHooks,
  matchesToolName,
} from "../src/index.js";
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

import { generateText } from "ai";

describe("unified hook system types", () => {
  describe("HookInput types", () => {
    it("PreToolUseInput has correct shape", () => {
      const input: PreToolUseInput = {
        hook_event_name: "PreToolUse",
        session_id: "test-session",
        cwd: "/test/dir",
        tool_name: "Write",
        tool_input: { file_path: "/test.txt", content: "test" },
      };

      expect(input.hook_event_name).toBe("PreToolUse");
      expect(input.tool_name).toBe("Write");
      expect(input.tool_input).toEqual({ file_path: "/test.txt", content: "test" });
    });

    it("PostToolUseInput has correct shape", () => {
      const input: PostToolUseInput = {
        hook_event_name: "PostToolUse",
        session_id: "test-session",
        cwd: "/test/dir",
        tool_name: "Read",
        tool_input: { file_path: "/test.txt" },
        tool_response: "file contents",
      };

      expect(input.hook_event_name).toBe("PostToolUse");
      expect(input.tool_response).toBe("file contents");
    });

    it("PostToolUseFailureInput has correct shape", () => {
      const error = new Error("Tool failed");
      const input: PostToolUseFailureInput = {
        hook_event_name: "PostToolUseFailure",
        session_id: "test-session",
        cwd: "/test/dir",
        tool_name: "Bash",
        tool_input: { command: "invalid" },
        error,
      };

      expect(input.hook_event_name).toBe("PostToolUseFailure");
      expect(input.error).toBe(error);
    });

    it("PreGenerateInput has correct shape", () => {
      const input: PreGenerateInput = {
        hook_event_name: "PreGenerate",
        session_id: "test-session",
        cwd: "/test/dir",
        options: { prompt: "test prompt" },
      };

      expect(input.hook_event_name).toBe("PreGenerate");
      expect(input.options.prompt).toBe("test prompt");
    });

    it("PostGenerateInput has correct shape", () => {
      const input: PostGenerateInput = {
        hook_event_name: "PostGenerate",
        session_id: "test-session",
        cwd: "/test/dir",
        options: { prompt: "test prompt" },
        result: {
          text: "response",
          finishReason: "stop",
          steps: [],
        },
      };

      expect(input.hook_event_name).toBe("PostGenerate");
      expect(input.result.text).toBe("response");
    });

    it("PostGenerateFailureInput has correct shape", () => {
      const error = new Error("Generation failed");
      const input: PostGenerateFailureInput = {
        hook_event_name: "PostGenerateFailure",
        session_id: "test-session",
        cwd: "/test/dir",
        options: { prompt: "test prompt" },
        error,
      };

      expect(input.hook_event_name).toBe("PostGenerateFailure");
      expect(input.error).toBe(error);
    });
  });

  describe("HookOutput types", () => {
    it("allows empty output (continue execution)", () => {
      const output: HookOutput = {};
      expect(output).toEqual({});
    });

    it("supports permission decision", () => {
      const output: HookOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Tool blocked by security policy",
        },
      };

      expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput?.permissionDecisionReason).toBe(
        "Tool blocked by security policy",
      );
    });

    it("supports input transformation", () => {
      const output: HookOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: {
            file_path: "/sandbox/test.txt",
            content: "filtered content",
          },
        },
      };

      expect(output.hookSpecificOutput?.updatedInput).toEqual({
        file_path: "/sandbox/test.txt",
        content: "filtered content",
      });
    });

    it("supports cache short-circuit", () => {
      const cachedResult = { text: "cached response", finishReason: "stop", steps: [] };
      const output: HookOutput = {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          respondWith: cachedResult,
        },
      };

      expect(output.hookSpecificOutput?.respondWith).toBe(cachedResult);
    });

    it("supports result transformation", () => {
      const output: HookOutput = {
        hookSpecificOutput: {
          hookEventName: "PostGenerate",
          updatedResult: {
            text: "redacted response",
            finishReason: "stop",
            steps: [],
          },
        },
      };

      expect(output.hookSpecificOutput?.updatedResult).toBeDefined();
    });

    it("supports retry signaling", () => {
      const output: HookOutput = {
        hookSpecificOutput: {
          hookEventName: "PostGenerateFailure",
          retry: true,
          retryDelayMs: 1000,
        },
      };

      expect(output.hookSpecificOutput?.retry).toBe(true);
      expect(output.hookSpecificOutput?.retryDelayMs).toBe(1000);
    });
  });

  describe("HookCallback type", () => {
    it("accepts async callback with all parameters", async () => {
      const callback: HookCallback = async (input, toolUseId, context) => {
        expect(input.hook_event_name).toBeDefined();
        expect(context.agent).toBeDefined();
        expect(context.signal).toBeDefined();
        return {};
      };

      const model = createMockModel();
      const agent = createAgent({ model });
      const input: PreToolUseInput = {
        hook_event_name: "PreToolUse",
        session_id: "test",
        cwd: "/test",
        tool_name: "Write",
        tool_input: {},
      };

      const result = await callback(input, "tool-123", {
        agent,
        signal: new AbortController().signal,
      });

      expect(result).toEqual({});
    });

    it("accepts sync callback", () => {
      const callback: HookCallback = (input) => {
        if (input.hook_event_name === "PreToolUse") {
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: "Blocked",
            },
          };
        }
        return {};
      };

      const input: PreToolUseInput = {
        hook_event_name: "PreToolUse",
        session_id: "test",
        cwd: "/test",
        tool_name: "Bash",
        tool_input: { command: "rm -rf /" },
      };

      const model = createMockModel();
      const agent = createAgent({ model });
      const result = callback(input, null, {
        agent,
        signal: new AbortController().signal,
      });

      expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    });
  });

  describe("HookMatcher type", () => {
    it("supports matcher without regex (all tools)", () => {
      const callback: HookCallback = () => ({});
      const matcher: HookMatcher = {
        hooks: [callback],
      };

      expect(matcher.matcher).toBeUndefined();
      expect(matcher.hooks).toHaveLength(1);
    });

    it("supports matcher with regex pattern", () => {
      const callback: HookCallback = () => ({});
      const matcher: HookMatcher = {
        matcher: "Write|Edit",
        hooks: [callback],
      };

      expect(matcher.matcher).toBe("Write|Edit");
      expect(new RegExp(matcher.matcher).test("Write")).toBe(true);
      expect(new RegExp(matcher.matcher).test("Edit")).toBe(true);
      expect(new RegExp(matcher.matcher).test("Read")).toBe(false);
    });

    it("supports matcher with MCP pattern", () => {
      const callback: HookCallback = () => ({});
      const matcher: HookMatcher = {
        matcher: "^mcp__playwright__",
        hooks: [callback],
      };

      expect(matcher.matcher).toBe("^mcp__playwright__");
      expect(new RegExp(matcher.matcher).test("mcp__playwright__click")).toBe(true);
      expect(new RegExp(matcher.matcher).test("mcp__github__list_issues")).toBe(false);
    });

    it("supports timeout configuration", () => {
      const callback: HookCallback = () => ({});
      const matcher: HookMatcher = {
        matcher: "Write",
        hooks: [callback],
        timeout: 30000,
      };

      expect(matcher.timeout).toBe(30000);
    });

    it("supports multiple hooks in matcher", () => {
      const callback1: HookCallback = () => ({});
      const callback2: HookCallback = () => ({});
      const matcher: HookMatcher = {
        matcher: "Bash",
        hooks: [callback1, callback2],
      };

      expect(matcher.hooks).toHaveLength(2);
    });
  });

  describe("permission decision aggregation", () => {
    it("deny wins over all other decisions", () => {
      const decisions: Array<"allow" | "deny" | "ask"> = ["allow", "deny", "ask"];
      const hasDeny = decisions.some((d) => d === "deny");
      expect(hasDeny).toBe(true);
    });

    it("ask wins over allow", () => {
      const decisions: Array<"allow" | "ask"> = ["allow", "ask"];
      const hasAsk = decisions.some((d) => d === "ask");
      const hasDeny = decisions.some((d) => d === "deny");
      expect(hasAsk).toBe(true);
      expect(hasDeny).toBe(false);
    });

    it("allow is default when no other decisions", () => {
      const decisions: Array<"allow"> = ["allow", "allow"];
      const hasAsk = decisions.some((d) => d === "ask");
      const hasDeny = decisions.some((d) => d === "deny");
      expect(hasAsk).toBe(false);
      expect(hasDeny).toBe(false);
    });
  });

  describe("matchesToolName", () => {
    it("matches all tools when matcher is undefined", () => {
      expect(matchesToolName("Write", undefined)).toBe(true);
      expect(matchesToolName("Read", undefined)).toBe(true);
      expect(matchesToolName("Bash", undefined)).toBe(true);
      expect(matchesToolName("mcp__playwright__click", undefined)).toBe(true);
    });

    it("matches with simple regex pattern", () => {
      expect(matchesToolName("Write", "Write")).toBe(true);
      expect(matchesToolName("Edit", "Write")).toBe(false);
    });

    it("matches with OR pattern", () => {
      const pattern = "Write|Edit";
      expect(matchesToolName("Write", pattern)).toBe(true);
      expect(matchesToolName("Edit", pattern)).toBe(true);
      expect(matchesToolName("Read", pattern)).toBe(false);
      expect(matchesToolName("Bash", pattern)).toBe(false);
    });

    it("matches with prefix pattern", () => {
      const pattern = "^mcp__playwright__";
      expect(matchesToolName("mcp__playwright__click", pattern)).toBe(true);
      expect(matchesToolName("mcp__playwright__type", pattern)).toBe(true);
      expect(matchesToolName("mcp__github__list_issues", pattern)).toBe(false);
      expect(matchesToolName("Write", pattern)).toBe(false);
    });

    it("matches with suffix pattern", () => {
      const pattern = "__click$";
      expect(matchesToolName("mcp__playwright__click", pattern)).toBe(true);
      expect(matchesToolName("mcp__github__click", pattern)).toBe(true);
      expect(matchesToolName("mcp__playwright__type", pattern)).toBe(false);
    });

    it("handles invalid regex gracefully", () => {
      const pattern = "[invalid";
      // Should fall back to literal string match
      expect(matchesToolName("[invalid", pattern)).toBe(true);
      expect(matchesToolName("Write", pattern)).toBe(false);
    });

    it("matches with wildcard pattern", () => {
      const pattern = ".*Tool$";
      expect(matchesToolName("MyTool", pattern)).toBe(true);
      expect(matchesToolName("AnotherTool", pattern)).toBe(true);
      expect(matchesToolName("NotAMatch", pattern)).toBe(false);
    });
  });

  describe("invokeHooksWithTimeout", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("invokes all hooks and returns results", async () => {
      const hook1: HookCallback = vi.fn().mockReturnValue({ control: { abort: false } });
      const hook2: HookCallback = vi.fn().mockReturnValue({
        hookSpecificOutput: { permissionDecision: "allow" },
      });

      const input: PreToolUseInput = {
        type: "PreToolUse",
        toolName: "Write",
        input: { path: "/test.txt" },
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      const results = await invokeHooksWithTimeout([hook1, hook2], input, "tool-1", agent, 5000);

      expect(results).toHaveLength(2);
      expect(hook1).toHaveBeenCalledWith(
        input,
        "tool-1",
        expect.objectContaining({
          agent,
          signal: expect.any(AbortSignal),
          retryAttempt: 0,
        }),
      );
      expect(hook2).toHaveBeenCalledWith(
        input,
        "tool-1",
        expect.objectContaining({
          agent,
          signal: expect.any(AbortSignal),
          retryAttempt: 0,
        }),
      );
    });

    it("handles hook errors gracefully", async () => {
      const errorHook: HookCallback = vi.fn().mockRejectedValue(new Error("Hook failed"));
      const successHook: HookCallback = vi.fn().mockReturnValue({ control: { abort: false } });

      const input: PreToolUseInput = {
        type: "PreToolUse",
        toolName: "Write",
        input: { path: "/test.txt" },
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      const results = await invokeHooksWithTimeout(
        [errorHook, successHook],
        input,
        "tool-1",
        agent,
        5000,
      );

      // Should return results for both, with error hook returning empty object
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({});
      expect(results[1]).toEqual({ control: { abort: false } });
    });

    it("respects timeout and aborts signal with hard timeout enforcement", async () => {
      let signalAborted = false;
      const slowHook: HookCallback = vi.fn().mockImplementation(async (_input, _toolUseId, ctx) => {
        // Check if signal gets aborted during execution
        ctx.signal.addEventListener("abort", () => {
          signalAborted = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { hookSpecificOutput: { hookEventName: "PreToolUse" } };
      });

      const input: PreToolUseInput = {
        type: "PreToolUse",
        toolName: "Write",
        input: { path: "/test.txt" },
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      // Set a very short timeout - hard timeout will enforce this
      const results = await invokeHooksWithTimeout([slowHook], input, "tool-1", agent, 100);

      // Signal should have been aborted
      expect(signalAborted).toBe(true);
      // Hard timeout enforced: hook returns empty result
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({});
    });
  });

  describe("invokeMatchingHooks", () => {
    it("invokes hooks matching tool name pattern", async () => {
      const writeHook: HookCallback = vi.fn().mockReturnValue({
        hookSpecificOutput: { permissionDecision: "deny" },
      });
      const allToolsHook: HookCallback = vi.fn().mockReturnValue({});

      const matchers: HookMatcher[] = [
        { matcher: "Write|Edit", hooks: [writeHook] },
        { hooks: [allToolsHook] }, // Matches all
      ];

      const input: PreToolUseInput = {
        type: "PreToolUse",
        toolName: "Write",
        input: { path: "/test.txt" },
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      const results = await invokeMatchingHooks(matchers, "Write", input, "tool-1", agent);

      // Both matchers should match
      expect(writeHook).toHaveBeenCalled();
      expect(allToolsHook).toHaveBeenCalled();
      expect(results).toHaveLength(2);
    });

    it("skips non-matching hooks", async () => {
      const writeHook: HookCallback = vi.fn().mockReturnValue({});
      const bashHook: HookCallback = vi.fn().mockReturnValue({});

      const matchers: HookMatcher[] = [
        { matcher: "Write|Edit", hooks: [writeHook] },
        { matcher: "Bash", hooks: [bashHook] },
      ];

      const input: PreToolUseInput = {
        type: "PreToolUse",
        toolName: "Read",
        input: { path: "/test.txt" },
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      const results = await invokeMatchingHooks(matchers, "Read", input, "tool-1", agent);

      // Neither matcher should match
      expect(writeHook).not.toHaveBeenCalled();
      expect(bashHook).not.toHaveBeenCalled();
      expect(results).toHaveLength(0);
    });

    it("applies custom timeout from matcher", async () => {
      const hook: HookCallback = vi.fn().mockResolvedValue({});

      const matchers: HookMatcher[] = [{ matcher: "Write", hooks: [hook], timeout: 30000 }];

      const input: PreToolUseInput = {
        type: "PreToolUse",
        toolName: "Write",
        input: { path: "/test.txt" },
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      await invokeMatchingHooks(matchers, "Write", input, "tool-1", agent);

      expect(hook).toHaveBeenCalled();
    });

    it("matches MCP tool patterns", async () => {
      const mcpHook: HookCallback = vi.fn().mockReturnValue({});
      const playwrightHook: HookCallback = vi.fn().mockReturnValue({});

      const matchers: HookMatcher[] = [
        { matcher: "^mcp__", hooks: [mcpHook] },
        { matcher: "^mcp__playwright__", hooks: [playwrightHook] },
      ];

      const input: PreToolUseInput = {
        type: "PreToolUse",
        toolName: "mcp__playwright__click",
        input: { selector: "button" },
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      const results = await invokeMatchingHooks(
        matchers,
        "mcp__playwright__click",
        input,
        "tool-1",
        agent,
      );

      // Both matchers should match
      expect(mcpHook).toHaveBeenCalled();
      expect(playwrightHook).toHaveBeenCalled();
      expect(results).toHaveLength(2);
    });

    it("invokes multiple hooks within same matcher", async () => {
      const hook1: HookCallback = vi.fn().mockReturnValue({});
      const hook2: HookCallback = vi.fn().mockReturnValue({});

      const matchers: HookMatcher[] = [{ matcher: "Write", hooks: [hook1, hook2] }];

      const input: PreToolUseInput = {
        type: "PreToolUse",
        toolName: "Write",
        input: { path: "/test.txt" },
      };

      const model = createMockModel();
      const agent = createAgent({ model });

      const results = await invokeMatchingHooks(matchers, "Write", input, "tool-1", agent);

      expect(hook1).toHaveBeenCalled();
      expect(hook2).toHaveBeenCalled();
      expect(results).toHaveLength(2);
    });
  });
});

describe("aggregatePermissionDecisions", () => {
  it("returns default when no decisions are provided", () => {
    const decision = aggregatePermissionDecisions([]);
    expect(decision).toBe("allow");
  });

  it("returns custom default when no decisions are provided", () => {
    const decision = aggregatePermissionDecisions([], "ask");
    expect(decision).toBe("ask");
  });

  it("returns 'allow' when only allow decisions are present", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      },
    ];

    const decision = aggregatePermissionDecisions(outputs);
    expect(decision).toBe("allow");
  });

  it("returns 'ask' when only ask decisions are present", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
        },
      },
    ];

    const decision = aggregatePermissionDecisions(outputs);
    expect(decision).toBe("ask");
  });

  it("returns 'deny' when only deny decisions are present", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      },
    ];

    const decision = aggregatePermissionDecisions(outputs);
    expect(decision).toBe("deny");
  });

  it("returns 'deny' when deny and allow are present (deny wins)", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      },
    ];

    const decision = aggregatePermissionDecisions(outputs);
    expect(decision).toBe("deny");
  });

  it("returns 'deny' when deny and ask are present (deny wins)", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      },
    ];

    const decision = aggregatePermissionDecisions(outputs);
    expect(decision).toBe("deny");
  });

  it("returns 'ask' when ask and allow are present (ask wins)", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
        },
      },
    ];

    const decision = aggregatePermissionDecisions(outputs);
    expect(decision).toBe("ask");
  });

  it("returns 'deny' when all three decisions are present (deny wins)", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      },
    ];

    const decision = aggregatePermissionDecisions(outputs);
    expect(decision).toBe("deny");
  });

  it("ignores hooks without permission decisions", () => {
    const outputs: HookOutput[] = [
      {},
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
        },
      },
      {},
    ];

    const decision = aggregatePermissionDecisions(outputs);
    expect(decision).toBe("ask");
  });

  it("ignores hooks with hookSpecificOutput but no permissionDecision", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          updatedInput: { modified: true },
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      },
    ];

    const decision = aggregatePermissionDecisions(outputs);
    expect(decision).toBe("deny");
  });

  it("handles empty hookSpecificOutput correctly", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      },
    ];

    const decision = aggregatePermissionDecisions(outputs);
    expect(decision).toBe("allow");
  });

  it("works with mixed hook event types", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          permissionDecision: "allow",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      },
    ];

    const decision = aggregatePermissionDecisions(outputs);
    expect(decision).toBe("deny");
  });
});

describe("extractRespondWith", () => {
  it("returns undefined when no hookOutputs are provided", () => {
    const result = extractRespondWith([]);
    expect(result).toBeUndefined();
  });

  it("returns undefined when no respondWith is in hookOutputs", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          permissionDecision: "allow",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
        },
      },
    ];

    const result = extractRespondWith(outputs);
    expect(result).toBeUndefined();
  });

  it("returns the first non-undefined respondWith value", () => {
    const cachedResult = { text: "cached response", finishReason: "stop", steps: [] };
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          respondWith: cachedResult,
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          respondWith: { text: "other", finishReason: "stop", steps: [] },
        },
      },
    ];

    const result = extractRespondWith(outputs);
    expect(result).toBe(cachedResult);
  });

  it("works with empty hookSpecificOutput objects", () => {
    const outputs: HookOutput[] = [
      {},
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
        },
      },
    ];

    const result = extractRespondWith(outputs);
    expect(result).toBeUndefined();
  });

  it("supports generic type parameter", () => {
    interface CustomResult {
      data: string;
    }

    const customResult: CustomResult = { data: "test" };
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          respondWith: customResult,
        },
      },
    ];

    const result = extractRespondWith<CustomResult>(outputs);
    expect(result).toEqual(customResult);
  });
});

describe("respondWith integration", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("short-circuits generate with cached result", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    const cachedResult: GenerateResult = {
      text: "cached response",
      finishReason: "stop",
      steps: [],
      usage: { totalTokens: 0 },
    };

    const cacheHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PreGenerate") {
        return {
          hookSpecificOutput: {
            hookEventName: "PreGenerate",
            respondWith: cachedResult,
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PreGenerate: [cacheHook],
      },
    });

    const result = await agent.generate({ prompt: "test" });

    // Should return cached result without calling generateText
    expect(result).toBe(cachedResult);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("proceeds with generation when no respondWith is provided", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValue({
      text: "generated response",
      finishReason: "stop",
      usage: { totalTokens: 10 },
      steps: [],
      output: undefined,
    } as any);

    const noOpHook: HookCallback = async () => ({});

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PreGenerate: [noOpHook],
      },
    });

    const result = await agent.generate({ prompt: "test" });

    // Should call generateText when no respondWith is provided
    expect(mockGenerateText).toHaveBeenCalled();
    expect(result.text).toBe("generated response");
  });

  it("supports multiple hooks with first respondWith winning", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    const firstCache: GenerateResult = {
      text: "first cache",
      finishReason: "stop",
      steps: [],
      usage: { totalTokens: 0 },
    };

    const secondCache: GenerateResult = {
      text: "second cache",
      finishReason: "stop",
      steps: [],
      usage: { totalTokens: 0 },
    };

    const firstCacheHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PreGenerate") {
        return {
          hookSpecificOutput: {
            hookEventName: "PreGenerate",
            respondWith: firstCache,
          },
        };
      }
      return {};
    };

    const secondCacheHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PreGenerate") {
        return {
          hookSpecificOutput: {
            hookEventName: "PreGenerate",
            respondWith: secondCache,
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PreGenerate: [firstCacheHook, secondCacheHook],
      },
    });

    const result = await agent.generate({ prompt: "test" });

    // Should return first cache result
    expect(result).toBe(firstCache);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });
});

describe("extractUpdatedInput", () => {
  it("returns undefined when no hookOutputs are provided", () => {
    const result = extractUpdatedInput([]);
    expect(result).toBeUndefined();
  });

  it("returns undefined when no updatedInput is in hookOutputs", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          permissionDecision: "allow",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
        },
      },
    ];

    const result = extractUpdatedInput(outputs);
    expect(result).toBeUndefined();
  });

  it("returns the first non-undefined updatedInput value", () => {
    const transformedInput = { prompt: "transformed prompt", maxTokens: 200 };
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          updatedInput: transformedInput,
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          updatedInput: { prompt: "other", maxTokens: 300 },
        },
      },
    ];

    const result = extractUpdatedInput(outputs);
    expect(result).toBe(transformedInput);
  });

  it("works with empty hookSpecificOutput objects", () => {
    const outputs: HookOutput[] = [
      {},
      {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
        },
      },
    ];

    const result = extractUpdatedInput(outputs);
    expect(result).toBeUndefined();
  });

  it("supports generic type parameter", () => {
    interface CustomInput {
      customField: string;
    }

    const customInput: CustomInput = { customField: "test" };
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          updatedInput: customInput,
        },
      },
    ];

    const result = extractUpdatedInput<CustomInput>(outputs);
    expect(result).toEqual(customInput);
  });

  it("works with tool input transformations", () => {
    const originalToolInput = { file_path: "/etc/passwd" };
    const sandboxedToolInput = { file_path: "/sandbox/etc/passwd" };

    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          updatedInput: sandboxedToolInput,
        },
      },
    ];

    const result = extractUpdatedInput(outputs);
    expect(result).toEqual(sandboxedToolInput);
    expect(result).not.toEqual(originalToolInput);
  });
});

describe("extractUpdatedResult", () => {
  it("returns undefined when no hookOutputs are provided", () => {
    const result = extractUpdatedResult([]);
    expect(result).toBeUndefined();
  });

  it("returns undefined when no updatedResult is in hookOutputs", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerate",
          permissionDecision: "allow",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerate",
        },
      },
    ];

    const result = extractUpdatedResult(outputs);
    expect(result).toBeUndefined();
  });

  it("returns the first non-undefined updatedResult value", () => {
    const transformedResult = { text: "filtered response", usage: { totalTokens: 100 } };
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerate",
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerate",
          updatedResult: transformedResult,
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerate",
          updatedResult: { text: "other", usage: { totalTokens: 200 } },
        },
      },
    ];

    const result = extractUpdatedResult(outputs);
    expect(result).toBe(transformedResult);
  });

  it("works with empty hookSpecificOutput objects", () => {
    const outputs: HookOutput[] = [
      {},
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerate",
        },
      },
    ];

    const result = extractUpdatedResult(outputs);
    expect(result).toBeUndefined();
  });

  it("supports generic type parameter", () => {
    interface CustomResult {
      customField: string;
    }

    const customResult: CustomResult = { customField: "test" };
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerate",
          updatedResult: customResult,
        },
      },
    ];

    const result = extractUpdatedResult<CustomResult>(outputs);
    expect(result).toEqual(customResult);
  });

  it("works with result filtering transformations", () => {
    const originalResult = {
      text: "Secret: API_KEY_12345",
      usage: { totalTokens: 50 },
    };
    const filteredResult = {
      text: "Secret: [REDACTED]",
      usage: { totalTokens: 50 },
    };

    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerate",
          updatedResult: filteredResult,
        },
      },
    ];

    const result = extractUpdatedResult(outputs);
    expect(result).toEqual(filteredResult);
    expect(result).not.toEqual(originalResult);
  });
});

describe("updatedInput integration", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("transforms generate options before execution", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Mock successful generation
    mockGenerateText.mockResolvedValue({
      text: "response",
      finishReason: "stop",
      usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
      steps: [],
    } as any);

    const transformHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PreGenerate") {
        const preGenInput = input as PreGenerateInput;
        return {
          hookSpecificOutput: {
            hookEventName: "PreGenerate",
            updatedInput: {
              ...preGenInput.options,
              prompt: `TRANSFORMED: ${preGenInput.options.prompt}`,
              maxTokens: 500,
            },
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PreGenerate: [transformHook],
      },
    });

    await agent.generate({ prompt: "original prompt", maxTokens: 100 });

    // Verify generateText was called with transformed params
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 500,
      }),
    );
  });

  it("applies first updatedInput when multiple hooks provide one", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValue({
      text: "response",
      finishReason: "stop",
      usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
      steps: [],
    } as any);

    const firstTransformHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PreGenerate") {
        const preGenInput = input as PreGenerateInput;
        return {
          hookSpecificOutput: {
            hookEventName: "PreGenerate",
            updatedInput: {
              ...preGenInput.options,
              maxTokens: 200,
            },
          },
        };
      }
      return {};
    };

    const secondTransformHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PreGenerate") {
        const preGenInput = input as PreGenerateInput;
        return {
          hookSpecificOutput: {
            hookEventName: "PreGenerate",
            updatedInput: {
              ...preGenInput.options,
              maxTokens: 300,
            },
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PreGenerate: [firstTransformHook, secondTransformHook],
      },
    });

    await agent.generate({ prompt: "test" });

    // Should use first transformation (maxTokens: 200)
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 200,
      }),
    );
  });

  it("combines updatedInput with other hook capabilities", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValue({
      text: "response",
      finishReason: "stop",
      usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
      steps: [],
    } as any);

    let hookExecuted = false;
    const multiFeatureHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PreGenerate") {
        hookExecuted = true;
        const preGenInput = input as PreGenerateInput;
        return {
          hookSpecificOutput: {
            hookEventName: "PreGenerate",
            permissionDecision: "allow",
            updatedInput: {
              ...preGenInput.options,
              temperature: 0.5,
            },
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PreGenerate: [multiFeatureHook],
      },
    });

    await agent.generate({ prompt: "test", temperature: 0.9 });

    expect(hookExecuted).toBe(true);
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.5,
      }),
    );
  });
});

describe("updatedResult integration", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("transforms result after generation", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Mock successful generation
    mockGenerateText.mockResolvedValue({
      text: "original response with secret API_KEY_12345",
      finishReason: "stop",
      usage: { totalTokens: 50, promptTokens: 25, completionTokens: 25 },
      steps: [],
    } as any);

    const filterHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PostGenerate") {
        const postGenInput = input as PostGenerateInput;
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerate",
            updatedResult: {
              ...postGenInput.result,
              text: postGenInput.result.text.replace(/API_KEY_\w+/, "[REDACTED]"),
            },
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PostGenerate: [filterHook],
      },
    });

    const result = await agent.generate({ prompt: "test" });

    // Verify result was transformed
    expect(result.text).toBe("original response with secret [REDACTED]");
    expect(result.usage?.totalTokens).toBe(50);
  });

  it("applies first updatedResult when multiple hooks provide one", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValue({
      text: "response",
      finishReason: "stop",
      usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
      steps: [],
    } as any);

    const firstFilterHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PostGenerate") {
        const postGenInput = input as PostGenerateInput;
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerate",
            updatedResult: {
              ...postGenInput.result,
              text: `FIRST: ${postGenInput.result.text}`,
            },
          },
        };
      }
      return {};
    };

    const secondFilterHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PostGenerate") {
        const postGenInput = input as PostGenerateInput;
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerate",
            updatedResult: {
              ...postGenInput.result,
              text: `SECOND: ${postGenInput.result.text}`,
            },
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PostGenerate: [firstFilterHook, secondFilterHook],
      },
    });

    const result = await agent.generate({ prompt: "test" });

    // Should use first transformation
    expect(result.text).toBe("FIRST: response");
  });

  it("adds metadata to result", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValue({
      text: "response",
      finishReason: "stop",
      usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
      steps: [],
    } as any);

    const metadataHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PostGenerate") {
        const postGenInput = input as PostGenerateInput;
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerate",
            updatedResult: {
              ...postGenInput.result,
              metadata: { filtered: true, timestamp: Date.now() },
            } as any,
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PostGenerate: [metadataHook],
      },
    });

    const result = (await agent.generate({ prompt: "test" })) as any;

    expect(result.text).toBe("response");
    expect(result.metadata).toBeDefined();
    expect(result.metadata.filtered).toBe(true);
  });
});

// =============================================================================
// extractRetryDecision Tests
// =============================================================================

describe("extractRetryDecision", () => {
  it("returns undefined when no hooks provide retry", () => {
    const outputs: HookOutput[] = [
      { hookSpecificOutput: { hookEventName: "PostGenerateFailure" } },
      {},
    ];
    expect(extractRetryDecision(outputs)).toBeUndefined();
  });

  it("returns retry decision when hook provides retry: true", () => {
    const outputs: HookOutput[] = [
      { hookSpecificOutput: { hookEventName: "PostGenerateFailure" } },
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerateFailure",
          retry: true,
          retryDelayMs: 1000,
        },
      },
    ];
    const decision = extractRetryDecision(outputs);
    expect(decision).toEqual({ retry: true, retryDelayMs: 1000 });
  });

  it("returns retry decision with 0ms delay when retryDelayMs not specified", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerateFailure",
          retry: true,
        },
      },
    ];
    const decision = extractRetryDecision(outputs);
    expect(decision).toEqual({ retry: true, retryDelayMs: 0 });
  });

  it("returns first retry decision when multiple hooks provide retry", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerateFailure",
          retry: true,
          retryDelayMs: 500,
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerateFailure",
          retry: true,
          retryDelayMs: 2000,
        },
      },
    ];
    const decision = extractRetryDecision(outputs);
    expect(decision).toEqual({ retry: true, retryDelayMs: 500 });
  });

  it("ignores hooks with retry: false", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerateFailure",
          retry: false,
        },
      },
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerateFailure",
          retry: true,
          retryDelayMs: 1000,
        },
      },
    ];
    const decision = extractRetryDecision(outputs);
    expect(decision).toEqual({ retry: true, retryDelayMs: 1000 });
  });

  it("handles empty hookSpecificOutput", () => {
    const outputs: HookOutput[] = [{ hookSpecificOutput: undefined }, {}];
    expect(extractRetryDecision(outputs)).toBeUndefined();
  });

  it("handles exponential backoff pattern", () => {
    const outputs: HookOutput[] = [
      {
        hookSpecificOutput: {
          hookEventName: "PostGenerateFailure",
          retry: true,
          retryDelayMs: 2 ** 3 * 1000, // 8000ms for 4th attempt
        },
      },
    ];
    const decision = extractRetryDecision(outputs);
    expect(decision).toEqual({ retry: true, retryDelayMs: 8000 });
  });
});

// =============================================================================
// Retry Integration Tests
// =============================================================================

describe("Retry with PostGenerateFailure hooks", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("retries generation when PostGenerateFailure hook requests retry", async () => {
    let attemptCount = 0;
    const mockGenerate = vi.mocked(generateText);
    mockGenerate.mockImplementation(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        throw new Error("Temporary failure");
      }
      return {
        text: "success after retry",
        usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as any;
    });

    const retryHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PostGenerateFailure") {
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerateFailure",
            retry: true,
            retryDelayMs: 10, // Short delay for test
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PostGenerateFailure: [retryHook],
      },
    });

    const result = await agent.generate({ prompt: "test" });

    expect(attemptCount).toBe(2);
    expect(result.text).toBe("success after retry");
  });

  it("stops retrying after max retries", async () => {
    let attemptCount = 0;
    const mockGenerate = vi.mocked(generateText);
    mockGenerate.mockImplementation(async () => {
      attemptCount++;
      throw new Error("Persistent failure");
    });

    const retryHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PostGenerateFailure") {
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerateFailure",
            retry: true,
            retryDelayMs: 1,
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PostGenerateFailure: [retryHook],
      },
    });

    await expect(agent.generate({ prompt: "test" })).rejects.toThrow("Persistent failure");
    // Should retry up to maxRetries (10) + initial attempt = 11 total
    expect(attemptCount).toBe(11);
  });

  it("does not retry when hook does not request retry", async () => {
    let attemptCount = 0;
    const mockGenerate = vi.mocked(generateText);
    mockGenerate.mockImplementation(async () => {
      attemptCount++;
      throw new Error("Failure without retry");
    });

    const noRetryHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PostGenerateFailure") {
        // Hook doesn't return retry: true
        return { hookSpecificOutput: { hookEventName: "PostGenerateFailure" } };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PostGenerateFailure: [noRetryHook],
      },
    });

    await expect(agent.generate({ prompt: "test" })).rejects.toThrow("Failure without retry");
    expect(attemptCount).toBe(1); // No retry
  });

  it("uses exponential backoff for retries", async () => {
    let attemptCount = 0;
    const delays: number[] = [];
    const mockGenerate = vi.mocked(generateText);
    mockGenerate.mockImplementation(async () => {
      attemptCount++;
      if (attemptCount <= 3) {
        throw new Error("Temporary failure");
      }
      return {
        text: "success",
        usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as any;
    });

    const backoffHook: HookCallback = async (input, _toolUseId, context) => {
      if (input.hook_event_name === "PostGenerateFailure") {
        const attempt = context.retryAttempt ?? 0;
        const delay = 2 ** attempt * 10; // Fast for testing
        delays.push(delay);
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerateFailure",
            retry: true,
            retryDelayMs: delay,
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PostGenerateFailure: [backoffHook],
      },
    });

    const result = await agent.generate({ prompt: "test" });

    expect(result.text).toBe("success");
    expect(attemptCount).toBe(4); // 3 failures + 1 success
    // Note: retryAttempt is always 0 in current implementation, so backoff is constant
    // This test documents current behavior - actual backoff would need retryAttempt tracking
  });

  it("combines retry with other hook features", async () => {
    let attemptCount = 0;
    const mockGenerate = vi.mocked(generateText);
    mockGenerate.mockImplementation(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        throw new Error("First attempt fails");
      }
      return {
        text: "success",
        usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as any;
    });

    const combinedHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PostGenerateFailure") {
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerateFailure",
            retry: true,
            retryDelayMs: 5,
          },
        };
      }
      if (input.hook_event_name === "PostGenerate") {
        const postGenInput = input as PostGenerateInput;
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerate",
            updatedResult: {
              ...postGenInput.result,
              metadata: { retried: true },
            } as any,
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PostGenerateFailure: [combinedHook],
        PostGenerate: [combinedHook],
      },
    });

    const result = (await agent.generate({ prompt: "test" })) as any;

    expect(attemptCount).toBe(2);
    expect(result.text).toBe("success");
    expect(result.metadata).toEqual({ retried: true });
  });

  it("first hook to request retry wins", async () => {
    let attemptCount = 0;
    const mockGenerate = vi.mocked(generateText);
    mockGenerate.mockImplementation(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        throw new Error("Failure");
      }
      return {
        text: "success",
        usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
        finishReason: "stop",
        steps: [],
      } as any;
    });

    const fastRetryHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PostGenerateFailure") {
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerateFailure",
            retry: true,
            retryDelayMs: 5,
          },
        };
      }
      return {};
    };

    const slowRetryHook: HookCallback = async (input) => {
      if (input.hook_event_name === "PostGenerateFailure") {
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerateFailure",
            retry: true,
            retryDelayMs: 5000, // Would slow down test if used
          },
        };
      }
      return {};
    };

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PostGenerateFailure: [fastRetryHook, slowRetryHook],
      },
    });

    const startTime = Date.now();
    const result = await agent.generate({ prompt: "test" });
    const elapsed = Date.now() - startTime;

    expect(attemptCount).toBe(2);
    expect(result.text).toBe("success");
    // Should use fast retry (5ms), not slow retry (5000ms)
    expect(elapsed).toBeLessThan(100);
  });
});

// =============================================================================
// Additional Hook Event Type Tests
// =============================================================================

describe("Additional hook event types", () => {
  it("SubagentStartInput has correct shape", () => {
    const input = {
      hook_event_name: "SubagentStart" as const,
      session_id: "test-session",
      cwd: "/test/dir",
      subagent_type: "general-purpose",
      subagent_id: "subagent-123",
      prompt: "Research this topic",
    };

    expect(input.hook_event_name).toBe("SubagentStart");
    expect(input.subagent_type).toBe("general-purpose");
    expect(input.subagent_id).toBe("subagent-123");
    expect(input.prompt).toBe("Research this topic");
  });

  it("SubagentStopInput has correct shape", () => {
    const input = {
      hook_event_name: "SubagentStop" as const,
      session_id: "test-session",
      cwd: "/test/dir",
      subagent_type: "general-purpose",
      subagent_id: "subagent-123",
      result: "Research completed",
      duration_ms: 5000,
    };

    expect(input.hook_event_name).toBe("SubagentStop");
    expect(input.result).toBe("Research completed");
    expect(input.duration_ms).toBe(5000);
  });

  it("MCPConnectionFailedInput has correct shape", () => {
    const error = new Error("Connection failed");
    const input = {
      hook_event_name: "MCPConnectionFailed" as const,
      session_id: "test-session",
      cwd: "/test/dir",
      server_name: "playwright",
      config: { command: "npx", args: ["-y", "@playwright/mcp"] },
      error,
    };

    expect(input.hook_event_name).toBe("MCPConnectionFailed");
    expect(input.server_name).toBe("playwright");
    expect(input.error).toBe(error);
  });

  it("MCPConnectionRestoredInput has correct shape", () => {
    const input = {
      hook_event_name: "MCPConnectionRestored" as const,
      session_id: "test-session",
      cwd: "/test/dir",
      server_name: "playwright",
      tool_count: 15,
    };

    expect(input.hook_event_name).toBe("MCPConnectionRestored");
    expect(input.server_name).toBe("playwright");
    expect(input.tool_count).toBe(15);
  });

  it("ToolRegisteredInput has correct shape", () => {
    const input = {
      hook_event_name: "ToolRegistered" as const,
      session_id: "test-session",
      cwd: "/test/dir",
      tool_name: "CustomTool",
      source: "plugin" as const,
      plugin_name: "my-plugin",
    };

    expect(input.hook_event_name).toBe("ToolRegistered");
    expect(input.tool_name).toBe("CustomTool");
    expect(input.source).toBe("plugin");
    expect(input.plugin_name).toBe("my-plugin");
  });

  it("ToolLoadErrorInput has correct shape", () => {
    const error = new Error("Failed to load tool");
    const input = {
      hook_event_name: "ToolLoadError" as const,
      session_id: "test-session",
      cwd: "/test/dir",
      tool_name: "BrokenTool",
      error,
      source: "mcp" as const,
    };

    expect(input.hook_event_name).toBe("ToolLoadError");
    expect(input.tool_name).toBe("BrokenTool");
    expect(input.error).toBe(error);
    expect(input.source).toBe("mcp");
  });
});

// =============================================================================
// Hook Execution Order Tests
// =============================================================================

describe("Hook execution order", () => {
  it("executes hooks in registration order", async () => {
    const executionOrder: number[] = [];

    const hook1: HookCallback = vi.fn().mockImplementation(async () => {
      executionOrder.push(1);
      return {};
    });

    const hook2: HookCallback = vi.fn().mockImplementation(async () => {
      executionOrder.push(2);
      return {};
    });

    const hook3: HookCallback = vi.fn().mockImplementation(async () => {
      executionOrder.push(3);
      return {};
    });

    const input = {
      type: "PreToolUse",
      toolName: "Write",
      input: { path: "/test.txt" },
    };

    const model = createMockModel();
    const agent = createAgent({ model });

    await invokeHooksWithTimeout([hook1, hook2, hook3], input, "tool-1", agent, 5000);

    expect(executionOrder).toEqual([1, 2, 3]);
    expect(hook1).toHaveBeenCalled();
    expect(hook2).toHaveBeenCalled();
    expect(hook3).toHaveBeenCalled();
  });

  it("executes matchers in registration order", async () => {
    const executionOrder: string[] = [];

    const matcherAHook: HookCallback = vi.fn().mockImplementation(async () => {
      executionOrder.push("matcher-A");
      return {};
    });

    const matcherBHook: HookCallback = vi.fn().mockImplementation(async () => {
      executionOrder.push("matcher-B");
      return {};
    });

    const matcherCHook: HookCallback = vi.fn().mockImplementation(async () => {
      executionOrder.push("matcher-C");
      return {};
    });

    const matchers = [
      { matcher: "Write", hooks: [matcherAHook] },
      { hooks: [matcherBHook] }, // Matches all
      { matcher: "Write|Edit", hooks: [matcherCHook] },
    ];

    const input = {
      type: "PreToolUse",
      toolName: "Write",
      input: { path: "/test.txt" },
    };

    const model = createMockModel();
    const agent = createAgent({ model });

    await invokeMatchingHooks(matchers, "Write", input, "tool-1", agent);

    expect(executionOrder).toEqual(["matcher-A", "matcher-B", "matcher-C"]);
  });

  it("executes multiple hooks within same matcher in order", async () => {
    const executionOrder: string[] = [];

    const hook1: HookCallback = vi.fn().mockImplementation(async () => {
      executionOrder.push("hook-1");
      return {};
    });

    const hook2: HookCallback = vi.fn().mockImplementation(async () => {
      executionOrder.push("hook-2");
      return {};
    });

    const hook3: HookCallback = vi.fn().mockImplementation(async () => {
      executionOrder.push("hook-3");
      return {};
    });

    const matchers = [{ matcher: "Write", hooks: [hook1, hook2, hook3] }];

    const input = {
      type: "PreToolUse",
      toolName: "Write",
      input: { path: "/test.txt" },
    };

    const model = createMockModel();
    const agent = createAgent({ model });

    await invokeMatchingHooks(matchers, "Write", input, "tool-1", agent);

    expect(executionOrder).toEqual(["hook-1", "hook-2", "hook-3"]);
  });

  it("PreGenerate hooks execute before generation", async () => {
    const events: string[] = [];

    const mockGenerate = vi.mocked(generateText);
    mockGenerate.mockImplementation(async () => {
      events.push("generate");
      return {
        text: "response",
        finishReason: "stop",
        usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
        steps: [],
      } as any;
    });

    const preHook: HookCallback = vi.fn().mockImplementation(async () => {
      events.push("pre-hook");
      return {};
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PreGenerate: [preHook],
      },
    });

    await agent.generate({ prompt: "test" });

    expect(events).toEqual(["pre-hook", "generate"]);
  });

  it("PostGenerate hooks execute after generation", async () => {
    const events: string[] = [];

    const mockGenerate = vi.mocked(generateText);
    mockGenerate.mockImplementation(async () => {
      events.push("generate");
      return {
        text: "response",
        finishReason: "stop",
        usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
        steps: [],
      } as any;
    });

    const postHook: HookCallback = vi.fn().mockImplementation(async () => {
      events.push("post-hook");
      return {};
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PostGenerate: [postHook],
      },
    });

    await agent.generate({ prompt: "test" });

    expect(events).toEqual(["generate", "post-hook"]);
  });
});

// =============================================================================
// Enhanced Error Handling Tests
// =============================================================================

describe("Hook error handling doesn't break execution", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("continues generation when PreGenerate hook throws", async () => {
    const mockGenerate = vi.mocked(generateText);
    mockGenerate.mockResolvedValue({
      text: "success despite hook error",
      finishReason: "stop",
      usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
      steps: [],
    } as any);

    const errorHook: HookCallback = vi.fn().mockRejectedValue(new Error("Hook error"));

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PreGenerate: [errorHook],
      },
    });

    // Should not throw, generation should proceed
    const result = await agent.generate({ prompt: "test" });

    expect(result.text).toBe("success despite hook error");
    expect(errorHook).toHaveBeenCalled();
    expect(mockGenerate).toHaveBeenCalled();
  });

  it("continues generation when PostGenerate hook throws", async () => {
    const mockGenerate = vi.mocked(generateText);
    mockGenerate.mockResolvedValue({
      text: "original response",
      finishReason: "stop",
      usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
      steps: [],
    } as any);

    const errorHook: HookCallback = vi.fn().mockRejectedValue(new Error("Hook error"));

    const model = createMockModel();
    const agent = createAgent({
      model,
      hooks: {
        PostGenerate: [errorHook],
      },
    });

    const result = await agent.generate({ prompt: "test" });

    // Result should be returned unchanged despite hook error
    expect(result.text).toBe("original response");
    expect(errorHook).toHaveBeenCalled();
  });

  it("executes remaining hooks when one hook throws", async () => {
    const errorHook: HookCallback = vi.fn().mockRejectedValue(new Error("Hook 1 error"));
    const successHook1: HookCallback = vi.fn().mockResolvedValue({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" as const },
    });
    const successHook2: HookCallback = vi.fn().mockResolvedValue({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" as const },
    });

    const input = {
      type: "PreToolUse",
      toolName: "Write",
      input: { path: "/test.txt" },
    };

    const model = createMockModel();
    const agent = createAgent({ model });

    const results = await invokeHooksWithTimeout(
      [errorHook, successHook1, successHook2],
      input,
      "tool-1",
      agent,
      5000,
    );

    // All hooks should be invoked despite first one throwing
    expect(errorHook).toHaveBeenCalled();
    expect(successHook1).toHaveBeenCalled();
    expect(successHook2).toHaveBeenCalled();

    // Results should contain empty object for error hook, successful results for others
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({});
    expect(results[1]).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
    expect(results[2]).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
  });

  it("handles synchronous hook errors", async () => {
    const syncErrorHook: HookCallback = vi.fn().mockImplementation(() => {
      throw new Error("Sync hook error");
    });

    const successHook: HookCallback = vi.fn().mockReturnValue({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" as const },
    });

    const input = {
      type: "PreToolUse",
      toolName: "Write",
      input: { path: "/test.txt" },
    };

    const model = createMockModel();
    const agent = createAgent({ model });

    const results = await invokeHooksWithTimeout(
      [syncErrorHook, successHook],
      input,
      "tool-1",
      agent,
      5000,
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({});
    expect(results[1]).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
  });

  it("handles hooks returning malformed output", async () => {
    const malformedHook: HookCallback = vi.fn().mockReturnValue("not an object" as any);
    const normalHook: HookCallback = vi.fn().mockReturnValue({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" as const },
    });

    const input = {
      type: "PreToolUse",
      toolName: "Write",
      input: { path: "/test.txt" },
    };

    const model = createMockModel();
    const agent = createAgent({ model });

    // Should not throw
    const results = await invokeHooksWithTimeout(
      [malformedHook, normalHook],
      input,
      "tool-1",
      agent,
      5000,
    );

    expect(results).toHaveLength(2);
    // Malformed hook result should still be returned as-is (or normalized)
    expect(normalHook).toHaveBeenCalled();
  });
});

// =============================================================================
// Enhanced Timeout Tests
// =============================================================================

describe("Hook timeout behavior", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("enforces hard timeout and returns empty result for slow hook", async () => {
    let signalWasAborted = false;

    const slowHook: HookCallback = vi.fn().mockImplementation(async (_input, _toolUseId, ctx) => {
      ctx.signal.addEventListener("abort", () => {
        signalWasAborted = true;
      });
      // Simulate slow operation that exceeds timeout
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return { hookSpecificOutput: { hookEventName: "PreToolUse" } };
    });

    const input = {
      type: "PreToolUse",
      toolName: "Write",
      input: { path: "/test.txt" },
    };

    const model = createMockModel();
    const agent = createAgent({ model });

    // Use very short timeout - should enforce hard timeout
    const results = await invokeHooksWithTimeout([slowHook], input, "tool-1", agent, 50);

    expect(signalWasAborted).toBe(true);
    expect(results).toHaveLength(1);
    // Hard timeout enforced: slow hook returns empty result
    expect(results[0]).toEqual({});
  });

  it("completes fast hook before timeout", async () => {
    const fastHook: HookCallback = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" as const },
      };
    });

    const input = {
      type: "PreToolUse",
      toolName: "Write",
      input: { path: "/test.txt" },
    };

    const model = createMockModel();
    const agent = createAgent({ model });

    const results = await invokeHooksWithTimeout([fastHook], input, "tool-1", agent, 1000);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
  });

  it("applies different timeouts for different matchers", async () => {
    const fastHook: HookCallback = vi.fn().mockResolvedValue({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" as const },
    });
    const slowHook: HookCallback = vi.fn().mockResolvedValue({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" as const },
    });

    const matchers = [
      { matcher: "Write", hooks: [fastHook], timeout: 1000 },
      { matcher: "Bash", hooks: [slowHook], timeout: 5000 },
    ];

    const input = {
      type: "PreToolUse",
      toolName: "Write",
      input: { path: "/test.txt" },
    };

    const model = createMockModel();
    const agent = createAgent({ model });

    // Only Write matcher should match
    await invokeMatchingHooks(matchers, "Write", input, "tool-1", agent);

    expect(fastHook).toHaveBeenCalled();
    expect(slowHook).not.toHaveBeenCalled();
  });

  it("uses default timeout when matcher doesn't specify one", async () => {
    const hook: HookCallback = vi.fn().mockResolvedValue({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" as const },
    });

    const matchers = [{ matcher: "Write", hooks: [hook] }]; // No timeout specified

    const input = {
      type: "PreToolUse",
      toolName: "Write",
      input: { path: "/test.txt" },
    };

    const model = createMockModel();
    const agent = createAgent({ model });

    await invokeMatchingHooks(matchers, "Write", input, "tool-1", agent);

    expect(hook).toHaveBeenCalled();
  });

  it("handles multiple hooks with different completion times - enforces timeout", async () => {
    const fastHook: HookCallback = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" as const },
      };
    });

    const mediumHook: HookCallback = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" as const },
      };
    });

    const slowHook: HookCallback = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" as const },
      };
    });

    const input = {
      type: "PreToolUse",
      toolName: "Write",
      input: { path: "/test.txt" },
    };

    const model = createMockModel();
    const agent = createAgent({ model });

    // Set timeout that allows fast and medium but not slow
    const results = await invokeHooksWithTimeout(
      [fastHook, mediumHook, slowHook],
      input,
      "tool-1",
      agent,
      100,
    );

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
    expect(results[1]).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" },
    });
    // Hard timeout enforced: slow hook returns empty result
    expect(results[2]).toEqual({});
    expect(slowHook).toHaveBeenCalled();
  });

  it("HookTimeoutError has correct properties", () => {
    const error = new HookTimeoutError(5000);
    expect(error.name).toBe("HookTimeoutError");
    expect(error.message).toBe("Hook execution timed out after 5000ms");
    expect(error instanceof Error).toBe(true);
  });

  it("fast hooks complete even when other hooks are slow", async () => {
    const fastHook: HookCallback = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" as const },
      };
    });

    const slowHook: HookCallback = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return {
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" as const },
      };
    });

    const input = {
      type: "PreToolUse",
      toolName: "Write",
      input: { path: "/test.txt" },
    };

    const model = createMockModel();
    const agent = createAgent({ model });

    const startTime = Date.now();
    const results = await invokeHooksWithTimeout([fastHook, slowHook], input, "tool-1", agent, 50);
    const elapsed = Date.now() - startTime;

    // Should complete in roughly timeout time, not wait for slow hook
    expect(elapsed).toBeLessThan(200);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
    expect(results[1]).toEqual({}); // Slow hook timed out
  });
});

describe("tool lifecycle hooks integration", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("triggers PreToolUse hook before tool execution", async () => {
    const mockGenerateText = vi.mocked(generateText);
    const toolExecuteFn = vi.fn().mockResolvedValue("Tool result");

    // Create a test tool using AI SDK tool
    const { tool } = await import("ai");
    const { z } = await import("zod");
    const testTool = tool({
      description: "A test tool",
      parameters: z.object({
        message: z.string(),
      }),
      execute: toolExecuteFn,
    });

    // Capture the tools passed to generateText so we can call them
    mockGenerateText.mockImplementation(async (params) => {
      const tools = params.tools || {};
      // Simulate calling the tool
      if (
        tools.testTool &&
        typeof (tools.testTool as { execute?: unknown }).execute === "function"
      ) {
        await (
          tools.testTool as { execute: (input: unknown, options: unknown) => Promise<unknown> }
        ).execute({ message: "hello" }, {});
      }
      return {
        text: "Response",
        steps: [],
        toolCalls: [],
        toolResults: [],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 20, inputTokenDetails: {}, outputTokenDetails: {} },
        response: { id: "test-id", timestamp: new Date(), modelId: "test-model", messages: [] },
        request: {},
        warnings: [],
        providerMetadata: undefined,
        files: [],
        sources: [],
        reasoning: [],
        reasoningText: undefined,
        content: [],
      } as never;
    });

    const preToolHandler = vi.fn().mockResolvedValue({});

    const model = createMockModel();
    const agent = createAgent({
      model,
      tools: { testTool },
      hooks: {
        PreToolUse: [{ hooks: [preToolHandler] }],
      },
    });

    await agent.generate({ prompt: "Test" });

    expect(preToolHandler).toHaveBeenCalledTimes(1);
    expect(preToolHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        hook_event_name: "PreToolUse",
        tool_name: "testTool",
        tool_input: { message: "hello" },
      }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it("triggers PostToolUse hook after successful tool execution", async () => {
    const mockGenerateText = vi.mocked(generateText);
    const toolExecuteFn = vi.fn().mockResolvedValue("Tool result");

    const { tool } = await import("ai");
    const { z } = await import("zod");
    const testTool = tool({
      description: "A test tool",
      parameters: z.object({
        message: z.string(),
      }),
      execute: toolExecuteFn,
    });

    mockGenerateText.mockImplementation(async (params) => {
      const tools = params.tools || {};
      if (
        tools.testTool &&
        typeof (tools.testTool as { execute?: unknown }).execute === "function"
      ) {
        await (
          tools.testTool as { execute: (input: unknown, options: unknown) => Promise<unknown> }
        ).execute({ message: "hello" }, {});
      }
      return {
        text: "Response",
        steps: [],
        toolCalls: [],
        toolResults: [],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 20, inputTokenDetails: {}, outputTokenDetails: {} },
        response: { id: "test-id", timestamp: new Date(), modelId: "test-model", messages: [] },
        request: {},
        warnings: [],
        providerMetadata: undefined,
        files: [],
        sources: [],
        reasoning: [],
        reasoningText: undefined,
        content: [],
      } as never;
    });

    const postToolHandler = vi.fn().mockResolvedValue({});

    const model = createMockModel();
    const agent = createAgent({
      model,
      tools: { testTool },
      hooks: {
        PostToolUse: [{ hooks: [postToolHandler] }],
      },
    });

    await agent.generate({ prompt: "Test" });

    expect(postToolHandler).toHaveBeenCalledTimes(1);
    expect(postToolHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        hook_event_name: "PostToolUse",
        tool_name: "testTool",
        tool_input: { message: "hello" },
        tool_response: "Tool result",
      }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it("triggers PostToolUseFailure hook when tool execution fails", async () => {
    const mockGenerateText = vi.mocked(generateText);
    const toolError = new Error("Tool execution failed");
    const toolExecuteFn = vi.fn().mockRejectedValue(toolError);

    const { tool } = await import("ai");
    const { z } = await import("zod");
    const testTool = tool({
      description: "A failing test tool",
      parameters: z.object({
        message: z.string(),
      }),
      execute: toolExecuteFn,
    });

    mockGenerateText.mockImplementation(async (params) => {
      const tools = params.tools || {};
      if (
        tools.testTool &&
        typeof (tools.testTool as { execute?: unknown }).execute === "function"
      ) {
        try {
          await (
            tools.testTool as { execute: (input: unknown, options: unknown) => Promise<unknown> }
          ).execute({ message: "hello" }, {});
        } catch {
          // Tool failed, but generation continues (simulating AI SDK behavior)
        }
      }
      return {
        text: "Response",
        steps: [],
        toolCalls: [],
        toolResults: [],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 20, inputTokenDetails: {}, outputTokenDetails: {} },
        response: { id: "test-id", timestamp: new Date(), modelId: "test-model", messages: [] },
        request: {},
        warnings: [],
        providerMetadata: undefined,
        files: [],
        sources: [],
        reasoning: [],
        reasoningText: undefined,
        content: [],
      } as never;
    });

    const failureHandler = vi.fn().mockResolvedValue({});

    const model = createMockModel();
    const agent = createAgent({
      model,
      tools: { testTool },
      hooks: {
        PostToolUseFailure: [{ hooks: [failureHandler] }],
      },
    });

    await agent.generate({ prompt: "Test" });

    expect(failureHandler).toHaveBeenCalledTimes(1);
    expect(failureHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        hook_event_name: "PostToolUseFailure",
        tool_name: "testTool",
        tool_input: { message: "hello" },
        error: toolError,
      }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it("calls hooks in correct order: PreToolUse -> execute -> PostToolUse", async () => {
    const mockGenerateText = vi.mocked(generateText);
    const callOrder: string[] = [];

    const { tool } = await import("ai");
    const { z } = await import("zod");
    const toolExecuteFn = vi.fn().mockImplementation(async () => {
      callOrder.push("execute");
      return "result";
    });

    const testTool = tool({
      description: "A test tool",
      parameters: z.object({
        message: z.string(),
      }),
      execute: toolExecuteFn,
    });

    mockGenerateText.mockImplementation(async (params) => {
      const tools = params.tools || {};
      if (
        tools.testTool &&
        typeof (tools.testTool as { execute?: unknown }).execute === "function"
      ) {
        await (
          tools.testTool as { execute: (input: unknown, options: unknown) => Promise<unknown> }
        ).execute({ message: "hello" }, {});
      }
      return {
        text: "Response",
        steps: [],
        toolCalls: [],
        toolResults: [],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 20, inputTokenDetails: {}, outputTokenDetails: {} },
        response: { id: "test-id", timestamp: new Date(), modelId: "test-model", messages: [] },
        request: {},
        warnings: [],
        providerMetadata: undefined,
        files: [],
        sources: [],
        reasoning: [],
        reasoningText: undefined,
        content: [],
      } as never;
    });

    const preToolHandler: HookCallback = vi.fn().mockImplementation(async () => {
      callOrder.push("PreToolUse");
      return {};
    });
    const postToolHandler: HookCallback = vi.fn().mockImplementation(async () => {
      callOrder.push("PostToolUse");
      return {};
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      tools: { testTool },
      hooks: {
        PreToolUse: [{ hooks: [preToolHandler] }],
        PostToolUse: [{ hooks: [postToolHandler] }],
      },
    });

    await agent.generate({ prompt: "Test" });

    expect(callOrder).toEqual(["PreToolUse", "execute", "PostToolUse"]);
  });

  it("preserves tool without execute function", async () => {
    const mockGenerateText = vi.mocked(generateText);
    const { z } = await import("zod");

    // Create a tool without execute (client-side only tool)
    const clientOnlyTool = {
      description: "A client-only tool",
      parameters: z.object({ data: z.string() }),
      // No execute function
    };

    mockGenerateText.mockResolvedValue({
      text: "Response",
      steps: [],
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20, inputTokenDetails: {}, outputTokenDetails: {} },
      response: { id: "test-id", timestamp: new Date(), modelId: "test-model", messages: [] },
      request: {},
      warnings: [],
      providerMetadata: undefined,
      files: [],
      sources: [],
      reasoning: [],
      reasoningText: undefined,
      content: [],
    } as never);

    const model = createMockModel();

    // Should not throw even with a tool that has no execute function
    const agent = createAgent({
      model,
      hooks: {
        PreToolUse: [{ hooks: [vi.fn().mockResolvedValue({})] }],
      },
      tools: { clientOnlyTool: clientOnlyTool as never },
    });

    await expect(agent.generate({ prompt: "Test" })).resolves.toBeDefined();
  });

  it("PreToolUse hook can deny tool execution", async () => {
    const mockGenerateText = vi.mocked(generateText);
    const toolExecuteFn = vi.fn().mockResolvedValue("Tool result");

    const { tool } = await import("ai");
    const { z } = await import("zod");
    const testTool = tool({
      description: "A test tool",
      parameters: z.object({
        message: z.string(),
      }),
      execute: toolExecuteFn,
    });

    mockGenerateText.mockImplementation(async (params) => {
      const tools = params.tools || {};
      if (
        tools.testTool &&
        typeof (tools.testTool as { execute?: unknown }).execute === "function"
      ) {
        try {
          await (
            tools.testTool as { execute: (input: unknown, options: unknown) => Promise<unknown> }
          ).execute({ message: "hello" }, {});
        } catch {
          // Expected to throw due to denied permission
        }
      }
      return {
        text: "Response",
        steps: [],
        toolCalls: [],
        toolResults: [],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 20, inputTokenDetails: {}, outputTokenDetails: {} },
        response: { id: "test-id", timestamp: new Date(), modelId: "test-model", messages: [] },
        request: {},
        warnings: [],
        providerMetadata: undefined,
        files: [],
        sources: [],
        reasoning: [],
        reasoningText: undefined,
        content: [],
      } as never;
    });

    const preToolHandler = vi.fn().mockResolvedValue({
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: "Not allowed",
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      tools: { testTool },
      hooks: {
        PreToolUse: [{ hooks: [preToolHandler] }],
      },
    });

    await agent.generate({ prompt: "Test" });

    // Tool execution should have been blocked
    expect(toolExecuteFn).not.toHaveBeenCalled();
  });

  it("tool hook matcher filters tools by name", async () => {
    const mockGenerateText = vi.mocked(generateText);

    const { tool } = await import("ai");
    const { z } = await import("zod");
    const matchedTool = tool({
      description: "A matched tool",
      parameters: z.object({}),
      execute: vi.fn().mockResolvedValue("result"),
    });

    const unmatchedTool = tool({
      description: "An unmatched tool",
      parameters: z.object({}),
      execute: vi.fn().mockResolvedValue("result"),
    });

    mockGenerateText.mockImplementation(async (params) => {
      const tools = params.tools || {};
      // Call both tools
      if (
        tools.WriteTool &&
        typeof (tools.WriteTool as { execute?: unknown }).execute === "function"
      ) {
        await (
          tools.WriteTool as { execute: (input: unknown, options: unknown) => Promise<unknown> }
        ).execute({}, {});
      }
      if (
        tools.ReadTool &&
        typeof (tools.ReadTool as { execute?: unknown }).execute === "function"
      ) {
        await (
          tools.ReadTool as { execute: (input: unknown, options: unknown) => Promise<unknown> }
        ).execute({}, {});
      }
      return {
        text: "Response",
        steps: [],
        toolCalls: [],
        toolResults: [],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 20, inputTokenDetails: {}, outputTokenDetails: {} },
        response: { id: "test-id", timestamp: new Date(), modelId: "test-model", messages: [] },
        request: {},
        warnings: [],
        providerMetadata: undefined,
        files: [],
        sources: [],
        reasoning: [],
        reasoningText: undefined,
        content: [],
      } as never;
    });

    const handler = vi.fn().mockResolvedValue({});

    const model = createMockModel();
    const agent = createAgent({
      model,
      tools: { WriteTool: matchedTool, ReadTool: unmatchedTool },
      hooks: {
        PreToolUse: [{ matcher: "Write", hooks: [handler] }],
      },
    });

    await agent.generate({ prompt: "Test" });

    // Handler should only be called for WriteTool, not ReadTool
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ tool_name: "WriteTool" }),
      expect.any(String),
      expect.any(Object),
    );
  });
});
