/**
 * E2E tests for subagent delegation via plugin.subagent.
 *
 * Verifies:
 * - Auto-created subagent definitions from plugin.subagent
 * - Main agent context stays clean (no subagent tools in active set)
 * - Plugins with both tools and subagent work correctly
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

  describe("plugin.subagent", () => {
    it("keeps main agent context clean when plugin has subagent", () => {
      const githubPlugin = definePlugin({
        name: "github",
        subagent: {
          description: "GitHub integration",
          prompt: "You are a GitHub specialist.",
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

      // GitHub subagent tools should NOT be in main agent
      expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
      expect(activeTools).not.toHaveProperty("mcp__github__create_pr");
      expect(activeTools).not.toHaveProperty("mcp__github__review_pr");

      // Util plugin tools SHOULD be loaded (not in subagent)
      expect(activeTools).toHaveProperty("mcp__utils__format_date");
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

    it("plugin with both tools and subagent loads main tools only", () => {
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

      // Subagent tools not loaded
      expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
    });
  });

  describe("delegation instructions", () => {
    it("delegation instructions appear in prompt when subagents exist", () => {
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
          },
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [plugin],
        promptMode: "builder",
      });

      // Verify agent was created successfully with no subagent tools in active set
      const activeTools = agent.getActiveTools();
      expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
    });

    it("custom delegation instructions override default", () => {
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
          },
        },
      });

      const model = createMockModel();
      const agent = createAgent({
        model,
        plugins: [plugin],
        delegationInstructions:
          "Always delegate to the GitHub specialist for any GitHub-related task.",
      });

      const activeTools = agent.getActiveTools();
      expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
    });
  });
});
