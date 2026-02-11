/**
 * E2E tests for subagent delegation.
 *
 * Verifies:
 * - Auto-created subagent definitions from delegated plugins
 * - Main agent context stays clean (no plugin tools in active set)
 * - delegatePluginTools agent-level option works
 */

import { tool } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgent, definePlugin } from "../../src/index.js";
import { createMockModel, resetMocks } from "../setup.js";

describe("E2E: Subagent Delegation", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("per-plugin delegateToSubagent", () => {
    it("keeps main agent context clean when plugin is delegated", () => {
      const githubPlugin = definePlugin({
        name: "github",
        description: "GitHub integration",
        delegateToSubagent: true,
        subagentPrompt: "You are a GitHub specialist.",
        tools: {
          list_issues: tool({
            description: "List GitHub issues",
            parameters: z.object({ repo: z.string() }),
            execute: async ({ repo }) => `Issues for ${repo}`,
          }),
          create_pr: tool({
            description: "Create a pull request",
            parameters: z.object({ title: z.string(), body: z.string() }),
            execute: async ({ title }) => `PR created: ${title}`,
          }),
          review_pr: tool({
            description: "Review a pull request",
            parameters: z.object({ prNumber: z.number() }),
            execute: async ({ prNumber }) => `Reviewed PR #${prNumber}`,
          }),
        },
      });

      const utilPlugin = definePlugin({
        name: "utils",
        tools: {
          format_date: tool({
            description: "Format a date",
            parameters: z.object({ date: z.string() }),
            execute: async ({ date }) => `Formatted: ${date}`,
          }),
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [githubPlugin, utilPlugin],
      });

      const activeTools = agent.getActiveTools();

      // GitHub plugin tools should NOT be in main agent
      expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
      expect(activeTools).not.toHaveProperty("mcp__github__create_pr");
      expect(activeTools).not.toHaveProperty("mcp__github__review_pr");

      // Util plugin tools SHOULD be loaded (not delegated)
      expect(activeTools).toHaveProperty("mcp__utils__format_date");
    });

    it("handles multiple delegated plugins", () => {
      const githubPlugin = definePlugin({
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

      const slackPlugin = definePlugin({
        name: "slack",
        delegateToSubagent: true,
        tools: {
          send_message: tool({
            description: "Send Slack message",
            parameters: z.object({ channel: z.string(), text: z.string() }),
            execute: async ({ channel, text }) => `Sent to ${channel}: ${text}`,
          }),
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [githubPlugin, slackPlugin],
      });

      const activeTools = agent.getActiveTools();

      // Neither plugin's tools should be in active set
      expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
      expect(activeTools).not.toHaveProperty("mcp__slack__send_message");
    });
  });

  describe("delegatePluginTools: true", () => {
    it("delegates all plugins to subagents", () => {
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

      expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
      expect(activeTools).not.toHaveProperty("mcp__stripe__charge");
    });
  });

  describe("delegatePluginTools: string[]", () => {
    it("delegates only named plugins", () => {
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

      const core = definePlugin({
        name: "core",
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
        plugins: [github, stripe, core],
        delegatePluginTools: ["github", "stripe"],
      });

      const activeTools = agent.getActiveTools();

      // Delegated plugins not in active set
      expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
      expect(activeTools).not.toHaveProperty("mcp__stripe__charge");

      // Non-delegated plugin IS in active set
      expect(activeTools).toHaveProperty("mcp__core__ping");
    });
  });
});
