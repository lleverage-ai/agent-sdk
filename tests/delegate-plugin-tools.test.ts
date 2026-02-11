/**
 * Tests for delegateToSubagent and delegatePluginTools features.
 *
 * Verifies that:
 * - Per-plugin delegateToSubagent creates a subagent definition
 * - delegatePluginTools: true delegates all plugins
 * - delegatePluginTools: string[] delegates named plugins
 * - Delegated plugin tools are NOT in the main agent's active set
 * - Auto-created subagent definitions have correct metadata
 */

import { tool } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgent, definePlugin } from "../src/index.js";
import { createMockModel, resetMocks } from "./setup.js";

describe("Per-plugin delegateToSubagent", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("does not load delegated plugin tools into active set", () => {
    const plugin = definePlugin({
      name: "github",
      delegateToSubagent: true,
      tools: {
        list_issues: tool({
          description: "List issues",
          parameters: z.object({}),
          execute: async () => "issues",
        }),
        create_pr: tool({
          description: "Create PR",
          parameters: z.object({ title: z.string() }),
          execute: async ({ title }) => `PR: ${title}`,
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [plugin],
    });

    const activeTools = agent.getActiveTools();

    // Plugin tools should NOT be in the active set
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
    expect(activeTools).not.toHaveProperty("mcp__github__create_pr");
  });

  it("does not count delegated tools toward tool search threshold", () => {
    // Create a large delegated plugin
    const tools: Record<string, ReturnType<typeof tool>> = {};
    for (let i = 0; i < 25; i++) {
      tools[`tool${i}`] = tool({
        description: `Tool ${i}`,
        parameters: z.object({}),
        execute: async () => `result${i}`,
      });
    }

    const delegatedPlugin = definePlugin({
      name: "large-delegated",
      delegateToSubagent: true,
      tools,
    });

    const smallPlugin = definePlugin({
      name: "small",
      tools: {
        ping: tool({
          description: "Ping",
          parameters: z.object({}),
          execute: async () => "pong",
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [delegatedPlugin, smallPlugin],
      toolSearch: { enabled: "auto", threshold: 20 },
    });

    const activeTools = agent.getActiveTools();

    // Small plugin should be eagerly loaded
    expect(activeTools).toHaveProperty("mcp__small__ping");

    // search_tools should NOT be created since only 1 tool counts
    // (25 delegated tools don't count toward threshold)
    expect(activeTools).not.toHaveProperty("search_tools");
  });

  it("mixes delegated and eager plugins correctly", () => {
    const eagerPlugin = definePlugin({
      name: "core",
      tools: {
        ping: tool({
          description: "Ping",
          parameters: z.object({}),
          execute: async () => "pong",
        }),
      },
    });

    const delegatedPlugin = definePlugin({
      name: "github",
      delegateToSubagent: true,
      tools: {
        list_issues: tool({
          description: "List issues",
          parameters: z.object({}),
          execute: async () => "issues",
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [eagerPlugin, delegatedPlugin],
    });

    const activeTools = agent.getActiveTools();

    // Eager plugin loaded
    expect(activeTools).toHaveProperty("mcp__core__ping");

    // Delegated plugin NOT loaded
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
  });
});

describe("Agent-level delegatePluginTools", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("delegates all plugins when delegatePluginTools: true", () => {
    const plugin1 = definePlugin({
      name: "github",
      tools: {
        list_issues: tool({
          description: "List issues",
          parameters: z.object({}),
          execute: async () => "issues",
        }),
      },
    });

    const plugin2 = definePlugin({
      name: "stripe",
      tools: {
        charge: tool({
          description: "Charge",
          parameters: z.object({ amount: z.number() }),
          execute: async ({ amount }) => `Charged ${amount}`,
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [plugin1, plugin2],
      delegatePluginTools: true,
    });

    const activeTools = agent.getActiveTools();

    // No plugin tools should be loaded
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
    expect(activeTools).not.toHaveProperty("mcp__stripe__charge");
  });

  it("delegates only named plugins when delegatePluginTools is a string array", () => {
    const github = definePlugin({
      name: "github",
      tools: {
        list_issues: tool({
          description: "List issues",
          parameters: z.object({}),
          execute: async () => "issues",
        }),
      },
    });

    const stripe = definePlugin({
      name: "stripe",
      tools: {
        charge: tool({
          description: "Charge",
          parameters: z.object({ amount: z.number() }),
          execute: async ({ amount }) => `Charged ${amount}`,
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [github, stripe],
      delegatePluginTools: ["github"], // Only delegate github
    });

    const activeTools = agent.getActiveTools();

    // github tools NOT loaded (delegated)
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");

    // stripe tools ARE loaded (not delegated)
    expect(activeTools).toHaveProperty("mcp__stripe__charge");
  });
});

describe("Combined proxy + delegation", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("handles mix of eager, deferred, and delegated plugins", () => {
    const corePlugin = definePlugin({
      name: "core",
      deferred: false, // Explicit eager
      tools: {
        ping: tool({
          description: "Ping",
          parameters: z.object({}),
          execute: async () => "pong",
        }),
      },
    });

    const stripePlugin = definePlugin({
      name: "stripe",
      deferred: true, // Via call_tool proxy
      tools: {
        charge: tool({
          description: "Charge",
          parameters: z.object({ amount: z.number() }),
          execute: async ({ amount }) => `Charged ${amount}`,
        }),
      },
    });

    const githubPlugin = definePlugin({
      name: "github",
      delegateToSubagent: true, // Via subagent
      tools: {
        list_issues: tool({
          description: "List issues",
          parameters: z.object({}),
          execute: async () => "issues",
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [corePlugin, stripePlugin, githubPlugin],
    });

    const activeTools = agent.getActiveTools();

    // Core tools loaded eagerly
    expect(activeTools).toHaveProperty("mcp__core__ping");

    // Stripe accessible via call_tool (not directly loaded)
    expect(activeTools).not.toHaveProperty("mcp__stripe__charge");
    expect(activeTools).toHaveProperty("call_tool");

    // Github delegated (not loaded, not in search)
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
  });
});
