import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { NoSuchToolError, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../src/agent.js";
import { MCPManager } from "../src/mcp/manager.js";
import { definePlugin } from "../src/plugins.js";
import { createCallToolTool, suggestNearMissTools } from "../src/tools/call-tool.js";
import type { LanguageModel, StreamPart } from "../src/types.js";

/**
 * A near-miss tool name (`skills__update_skill` for
 * `skills__change_skill_draft`) must name the closest discoverable tools
 * instead of pointing the model at another `search_tools` round trip. This is
 * pinned on both the `call_tool` proxy path and the direct-call repair path.
 * Suggestions are names only; nothing is auto-executed.
 */

const execOpts = {
  toolCallId: "tc-1",
  messages: [],
  abortSignal: undefined as unknown as AbortSignal,
};

const skillTools = {
  change_skill_draft: tool({
    description: "Change a skill draft",
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => `changed ${id}`,
  }),
  get_skill: tool({
    description: "Get a skill",
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => `skill ${id}`,
  }),
};

function skillsManager(): MCPManager {
  const manager = new MCPManager();
  manager.registerPluginTools("skills", skillTools, { autoLoad: false });
  return manager;
}

async function callTool(manager: MCPManager, toolName: string): Promise<string> {
  const callToolTool = createCallToolTool({ mcpManager: manager });
  return (await callToolTool.execute!({ tool_name: toolName, arguments: {} }, execOpts)) as string;
}

describe("suggestNearMissTools", () => {
  it("returns up to three ranked names, excluding the requested one", () => {
    const manager = skillsManager();
    const suggestions = suggestNearMissTools(manager, "skills__update_skill");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    expect(suggestions).not.toContain("skills__update_skill");
    expect(suggestions).toContain("skills__change_skill_draft");
  });

  it("never echoes the requested name back", () => {
    const manager = {
      searchTools: vi.fn(() => [{ name: "skills__update_skill" }]),
    } as unknown as MCPManager;
    expect(suggestNearMissTools(manager, "skills__update_skill")).toEqual([]);
  });

  it("yields no suggestions when discovery throws", () => {
    const manager = {
      searchTools: vi.fn(() => {
        throw new Error("index unavailable");
      }),
    } as unknown as MCPManager;
    expect(suggestNearMissTools(manager, "anything")).toEqual([]);
  });
});

describe("call_tool near-miss suggestions", () => {
  it("names the closest available tools for an unknown name", async () => {
    const manager = skillsManager();
    const searchSpy = vi.spyOn(manager, "searchTools");
    const result = await callTool(manager, "skills__update_skill");
    expect(result).toContain('Tool "skills__update_skill" not found');
    expect(result).toContain("Closest available tools: ");
    expect(result).toContain("`skills__change_skill_draft`");
    expect(result).toContain("`skills__get_skill`");
    expect(result).toContain("Call one of them by its exact name.");
    expect(result).not.toContain("Use search_tools");
    expect(searchSpy).toHaveBeenCalledWith("skills__update_skill", 3);
  });

  it("falls back to the search hint when nothing is close", async () => {
    const result = await callTool(skillsManager(), "zzqx");
    expect(result).toBe(
      'Error: Tool "zzqx" not found. Use search_tools to discover available tools.',
    );
  });

  it("falls back to the search hint when discovery itself fails", async () => {
    const manager = skillsManager();
    vi.spyOn(manager, "searchTools").mockImplementation(() => {
      throw new Error("index unavailable");
    });
    const result = await callTool(manager, "skills__update_skill");
    expect(result).toContain('Tool "skills__update_skill" not found');
    expect(result).toContain("Use search_tools to discover available tools");
  });

  it("never suggests the requested name back to the model", async () => {
    const manager = skillsManager();
    vi.spyOn(manager, "searchTools").mockReturnValue([
      { name: "skills__update_skill", description: "", pluginName: "skills", serverName: "skills" },
    ]);
    const result = await callTool(manager, "skills__update_skill");
    expect(result).toContain("Use search_tools to discover available tools");
    expect(result).not.toContain("Closest available tools");
  });

  it("does not execute a suggested tool", async () => {
    const execute = vi.fn(async () => "executed");
    const manager = new MCPManager();
    manager.registerPluginTools(
      "skills",
      {
        change_skill_draft: tool({
          description: "Change a skill draft",
          inputSchema: z.object({}),
          execute,
        }),
      },
      { autoLoad: false },
    );
    await callTool(manager, "skills__change_skill");
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps the plain hint without an MCPManager", async () => {
    const callToolTool = createCallToolTool({});
    const result = await callToolTool.execute!({ tool_name: "x", arguments: {} }, execOpts);
    expect(result).toBe('Error: Tool "x" not found. Use search_tools to discover available tools.');
  });
});

describe("direct-call near-miss suggestions", () => {
  const usage = {
    inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 10, text: 10, reasoning: 0 },
  };

  async function streamUnknownCall(toolName: string, transform: boolean) {
    let calls = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        calls++;
        const parts: LanguageModelV3StreamPart[] =
          calls === 1
            ? [{ type: "tool-call", toolCallId: "call-1", toolName, input: '{"id":"s1"}' }]
            : [
                { type: "text-start", id: "t" },
                { type: "text-delta", id: "t", delta: "done" },
                { type: "text-end", id: "t" },
              ];
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              for (const part of parts) controller.enqueue(part);
              controller.enqueue({
                type: "finish",
                finishReason: { unified: calls === 1 ? "tool-calls" : "stop", raw: "x" },
                usage,
              });
              controller.close();
            },
          }),
        };
      },
    });
    const agent = createAgent({
      model: model as LanguageModel,
      systemPrompt: "Near-miss fixture.",
      plugins: [definePlugin({ name: "skills", tools: skillTools, deferred: true })],
      transformToolError: transform
        ? (error) => new Error("sanitised", { cause: error })
        : undefined,
    });
    const parts: StreamPart[] = [];
    for await (const part of agent.stream({ prompt: "Update the skill." })) parts.push(part);
    return parts.filter(
      (part): part is Extract<StreamPart, { type: "tool-error" }> => part.type === "tool-error",
    );
  }

  function findNoSuchTool(error: unknown): NoSuchToolError | undefined {
    let current: unknown = error;
    for (let depth = 0; depth < 6 && current != null; depth++) {
      if (NoSuchToolError.isInstance(current)) return current;
      current =
        (current as { cause?: unknown; originalError?: unknown }).cause ??
        (current as { originalError?: unknown }).originalError;
    }
    return undefined;
  }

  it("enriches NoSuchToolError with suggestions and keeps the class", async () => {
    const errors = await streamUnknownCall("skills__update_skill", true);
    expect(errors).toHaveLength(1);
    const noSuchTool = findNoSuchTool(errors[0]?.error);
    expect(noSuchTool).toBeDefined();
    expect(noSuchTool?.toolName).toBe("skills__update_skill");
    expect(noSuchTool?.availableTools).toContain("skills__change_skill_draft");
    expect(noSuchTool?.message).toBe(
      `Tool "skills__update_skill" does not exist. Closest available tools: ${noSuchTool?.availableTools?.map((n) => `\`${n}\``).join(", ")}. Call one of them by its exact name through call_tool.`,
    );
  });

  it("leaves the original NoSuchToolError untouched when nothing is close", async () => {
    const errors = await streamUnknownCall("zzqx", true);
    const noSuchTool = findNoSuchTool(errors[0]?.error);
    expect(noSuchTool).toBeDefined();
    expect(noSuchTool?.message).not.toContain("Closest available tools");
  });

  it("does not enrich when no transformToolError is configured", async () => {
    // Without a transform the repair hook returns null and the AI SDK's own
    // error is used unchanged; enrichment is only surfaced through the host's
    // sanitiser path, matching the patched consumer.
    const errors = await streamUnknownCall("skills__update_skill", false);
    const noSuchTool = findNoSuchTool(errors[0]?.error);
    expect(noSuchTool).toBeDefined();
    expect(noSuchTool?.message).not.toContain("Closest available tools");
  });
});
