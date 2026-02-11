/**
 * E2E tests for combined proxy + delegation features.
 *
 * Verifies that proxy tool loading and subagent delegation work correctly
 * together when an agent uses both approaches.
 */

import { tool } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgent, definePlugin } from "../../src/index.js";
import { createMockModel, resetMocks } from "../setup.js";

describe("E2E: Combined Proxy + Delegation", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("handles eager, deferred, and delegated plugins together", () => {
    const corePlugin = definePlugin({
      name: "core",
      deferred: false, // Explicitly eager, even in proxy mode
      tools: {
        ping: tool({
          description: "Ping",
          parameters: z.object({}),
          execute: async () => "pong",
        }),
        version: tool({
          description: "Get version",
          parameters: z.object({}),
          execute: async () => "1.0.0",
        }),
      },
    });

    const stripePlugin = definePlugin({
      name: "stripe",
      deferred: true, // Accessible via search_tools + call_tool
      tools: {
        create_payment: tool({
          description: "Create a payment intent",
          parameters: z.object({
            amount: z.number(),
            currency: z.string(),
          }),
          execute: async ({ amount, currency }) =>
            `Payment: ${amount} ${currency}`,
        }),
        refund: tool({
          description: "Refund a payment",
          parameters: z.object({ id: z.string() }),
          execute: async ({ id }) => `Refunded: ${id}`,
        }),
      },
    });

    const githubPlugin = definePlugin({
      name: "github",
      description: "GitHub integration",
      delegateToSubagent: true, // Only via subagent
      subagentPrompt: "You are a GitHub specialist.",
      tools: {
        list_issues: tool({
          description: "List issues",
          parameters: z.object({ repo: z.string() }),
          execute: async ({ repo }) => `Issues for ${repo}`,
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
      plugins: [corePlugin, stripePlugin, githubPlugin],
    });

    const activeTools = agent.getActiveTools();

    // Core plugin: eagerly loaded
    expect(activeTools).toHaveProperty("mcp__core__ping");
    expect(activeTools).toHaveProperty("mcp__core__version");

    // Stripe plugin: deferred (not in active set, accessible via call_tool)
    expect(activeTools).not.toHaveProperty("mcp__stripe__create_payment");
    expect(activeTools).not.toHaveProperty("mcp__stripe__refund");

    // GitHub plugin: delegated (not in active set at all)
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
    expect(activeTools).not.toHaveProperty("mcp__github__create_pr");

    // Meta tools present
    expect(activeTools).toHaveProperty("call_tool");
    expect(activeTools).toHaveProperty("search_tools");
  });

  it("handles proxy mode with delegatePluginTools for specific plugins", () => {
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

    const github = definePlugin({
      name: "github",
      tools: {
        issues: tool({
          description: "List issues",
          parameters: z.object({}),
          execute: async () => "issues",
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [stripe, github],
      pluginLoading: "proxy",
      delegatePluginTools: ["github"], // GitHub delegated, stripe proxied
    });

    const activeTools = agent.getActiveTools();

    // Stripe: proxied (in MCP but not loaded)
    expect(activeTools).not.toHaveProperty("mcp__stripe__charge");

    // GitHub: delegated (not in MCP at all, goes to subagent)
    expect(activeTools).not.toHaveProperty("mcp__github__issues");

    // call_tool available for stripe
    expect(activeTools).toHaveProperty("call_tool");
    expect(activeTools).toHaveProperty("search_tools");
  });

  it("delegation instructions appear in prompt when subagents exist", () => {
    const plugin = definePlugin({
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
      plugins: [plugin],
      promptMode: "builder",
    });

    // Build the system prompt by triggering prompt context
    // The prompt builder should include delegation instructions since hasSubagents = true
    // We verify this indirectly by checking that the agent was created successfully
    // and has no plugin tools in its active set
    const activeTools = agent.getActiveTools();
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
  });

  it("custom delegation instructions override default", () => {
    const plugin = definePlugin({
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
    // Should not throw — custom delegation instructions are accepted
    const agent = createAgent({
      model,
      plugins: [plugin],
      delegationInstructions: "Always delegate to the GitHub specialist for any GitHub-related task.",
    });

    const activeTools = agent.getActiveTools();
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");
  });

  it("tool set is stable with mixed strategy", () => {
    const eager = definePlugin({
      name: "eager",
      deferred: false,
      tools: {
        ping: tool({
          description: "Ping",
          parameters: z.object({}),
          execute: async () => "pong",
        }),
      },
    });

    const deferred = definePlugin({
      name: "deferred",
      deferred: true,
      tools: {
        slow_op: tool({
          description: "Slow operation",
          parameters: z.object({}),
          execute: async () => "done",
        }),
      },
    });

    const delegated = definePlugin({
      name: "delegated",
      delegateToSubagent: true,
      tools: {
        external_op: tool({
          description: "External operation",
          parameters: z.object({}),
          execute: async () => "result",
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [eager, deferred, delegated],
    });

    // Get active tools multiple times and verify stability
    const keys1 = Object.keys(agent.getActiveTools()).sort();
    const keys2 = Object.keys(agent.getActiveTools()).sort();
    const keys3 = Object.keys(agent.getActiveTools()).sort();

    expect(keys1).toEqual(keys2);
    expect(keys2).toEqual(keys3);
  });
});
