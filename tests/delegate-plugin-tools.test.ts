/**
 * Tests for plugin.subagent delegation feature.
 *
 * Verifies that:
 * - plugin.subagent keeps tools out of the main agent's active set
 * - Plugin with both tools and subagent (main tools loaded, subagent tools not)
 * - Subagent tools don't count toward tool search threshold
 * - Multiple plugins with subagents
 */

import { tool } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgent, definePlugin } from "../src/index.js";
import { createMockModel, resetMocks } from "./setup.js";

describe("Plugin subagent delegation", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("does not load subagent tools into active set", () => {
    const plugin = definePlugin({
      name: "github",
      subagent: {
        description: "GitHub specialist",
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
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [plugin],
    });

    const activeTools = agent.getActiveTools();

    // Subagent tools should NOT be in the active set
    expect(activeTools).not.toHaveProperty("list_issues");
    expect(activeTools).not.toHaveProperty("create_pr");
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
    expect(activeTools).not.toHaveProperty("mcp__github__create_pr");
  });

  it("loads plugin.tools but not plugin.subagent.tools", () => {
    const plugin = definePlugin({
      name: "github",
      tools: {
        ping: tool({
          description: "Ping",
          parameters: z.object({}),
          execute: async () => "pong",
        }),
      },
      subagent: {
        description: "GitHub specialist",
        tools: {
          list_issues: tool({
            description: "List issues",
            parameters: z.object({}),
            execute: async () => "issues",
          }),
        },
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [plugin],
    });

    const activeTools = agent.getActiveTools();

    // Main tools loaded
    expect(activeTools).toHaveProperty("mcp__github__ping");

    // Subagent tools NOT loaded
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
    expect(activeTools).not.toHaveProperty("list_issues");
  });

  it("subagent tools don't count toward tool search threshold", () => {
    // Create a plugin with many subagent tools but few main tools
    const subagentTools: Record<string, ReturnType<typeof tool>> = {};
    for (let i = 0; i < 25; i++) {
      subagentTools[`tool${i}`] = tool({
        description: `Tool ${i}`,
        parameters: z.object({}),
        execute: async () => `result${i}`,
      });
    }

    const githubPlugin = definePlugin({
      name: "github",
      subagent: {
        description: "GitHub specialist",
        tools: subagentTools,
      },
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
      plugins: [githubPlugin, smallPlugin],
      toolSearch: { enabled: "auto", threshold: 20 },
    });

    const activeTools = agent.getActiveTools();

    // Small plugin should be eagerly loaded
    expect(activeTools).toHaveProperty("mcp__small__ping");

    // search_tools should NOT be created since only 1 main tool counts
    // (subagent tools don't count toward threshold)
    expect(activeTools).not.toHaveProperty("search_tools");
  });

  it("handles multiple plugins with subagents", () => {
    const githubPlugin = definePlugin({
      name: "github",
      subagent: {
        description: "GitHub specialist",
        tools: {
          list_issues: tool({
            description: "List issues",
            parameters: z.object({}),
            execute: async () => "issues",
          }),
        },
      },
    });

    const slackPlugin = definePlugin({
      name: "slack",
      subagent: {
        description: "Slack specialist",
        tools: {
          send_message: tool({
            description: "Send Slack message",
            parameters: z.object({ channel: z.string(), text: z.string() }),
            execute: async ({ channel, text }) => `Sent to ${channel}: ${text}`,
          }),
        },
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [githubPlugin, slackPlugin],
    });

    const activeTools = agent.getActiveTools();

    // Neither plugin's subagent tools should be in active set
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
    expect(activeTools).not.toHaveProperty("mcp__slack__send_message");
  });

  it("mixes eager and subagent plugins correctly", () => {
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

    const subagentPlugin = definePlugin({
      name: "github",
      subagent: {
        description: "GitHub specialist",
        tools: {
          list_issues: tool({
            description: "List issues",
            parameters: z.object({}),
            execute: async () => "issues",
          }),
        },
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [eagerPlugin, subagentPlugin],
    });

    const activeTools = agent.getActiveTools();

    // Eager plugin loaded
    expect(activeTools).toHaveProperty("mcp__core__ping");

    // Subagent plugin NOT loaded
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
  });
});
