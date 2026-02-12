/**
 * Tests for pluginLoading: "proxy" mode and per-plugin deferred: true.
 *
 * Verifies that:
 * - Proxy mode registers tools with autoLoad: false
 * - call_tool is created in proxy mode
 * - search_tools uses includeSchema in proxy mode
 * - Per-plugin deferred: true works in eager mode
 * - Tool set remains stable (no dynamic loading)
 */

import { tool } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgent, definePlugin } from "../src/index.js";
import { createMockModel, resetMocks } from "./setup.js";

describe("Proxy Mode (pluginLoading: 'proxy')", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("does NOT load plugin tools into active set", () => {
    const plugin = definePlugin({
      name: "stripe",
      tools: {
        create_payment: tool({
          description: "Create a payment",
          parameters: z.object({ amount: z.number() }),
          execute: async ({ amount }) => `Paid ${amount}`,
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [plugin],
      pluginLoading: "proxy",
    });

    const activeTools = agent.getActiveTools();
    // Plugin tool should NOT be directly in the active set
    expect(activeTools).not.toHaveProperty("mcp__stripe__create_payment");
  });

  it("creates call_tool in active tools", () => {
    const plugin = definePlugin({
      name: "stripe",
      tools: {
        create_payment: tool({
          description: "Create a payment",
          parameters: z.object({ amount: z.number() }),
          execute: async ({ amount }) => `Paid ${amount}`,
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [plugin],
      pluginLoading: "proxy",
    });

    const activeTools = agent.getActiveTools();
    expect(activeTools).toHaveProperty("call_tool");
  });

  it("creates search_tools in active tools", () => {
    const plugin = definePlugin({
      name: "stripe",
      tools: {
        create_payment: tool({
          description: "Create a payment",
          parameters: z.object({ amount: z.number() }),
          execute: async ({ amount }) => `Paid ${amount}`,
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [plugin],
      pluginLoading: "proxy",
    });

    const activeTools = agent.getActiveTools();
    expect(activeTools).toHaveProperty("search_tools");
  });

  it("keeps tool set stable with multiple plugins", () => {
    const stripe = definePlugin({
      name: "stripe",
      tools: {
        create_payment: tool({
          description: "Create a payment",
          parameters: z.object({ amount: z.number() }),
          execute: async ({ amount }) => `Paid ${amount}`,
        }),
        refund: tool({
          description: "Refund a payment",
          parameters: z.object({ id: z.string() }),
          execute: async ({ id }) => `Refunded ${id}`,
        }),
      },
    });

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

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [stripe, github],
      pluginLoading: "proxy",
    });

    const activeTools = agent.getActiveTools();

    // No plugin tools directly loaded
    expect(activeTools).not.toHaveProperty("mcp__stripe__create_payment");
    expect(activeTools).not.toHaveProperty("mcp__stripe__refund");
    expect(activeTools).not.toHaveProperty("mcp__github__list_issues");

    // Meta tools present
    expect(activeTools).toHaveProperty("call_tool");
    expect(activeTools).toHaveProperty("search_tools");
  });

  it("allows disabling call_tool via disabledCoreTools", () => {
    const plugin = definePlugin({
      name: "stripe",
      tools: {
        create_payment: tool({
          description: "Create a payment",
          parameters: z.object({ amount: z.number() }),
          execute: async ({ amount }) => `Paid ${amount}`,
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [plugin],
      pluginLoading: "proxy",
      disabledCoreTools: ["call_tool"],
    });

    const activeTools = agent.getActiveTools();
    expect(activeTools).not.toHaveProperty("call_tool");
  });
});

describe("Per-plugin deferred: true", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("defers individual plugin tools in eager mode", () => {
    const eagerPlugin = definePlugin({
      name: "core-utils",
      tools: {
        ping: tool({
          description: "Ping",
          parameters: z.object({}),
          execute: async () => "pong",
        }),
      },
    });

    const deferredPlugin = definePlugin({
      name: "stripe",
      deferred: true,
      tools: {
        create_payment: tool({
          description: "Create a payment",
          parameters: z.object({ amount: z.number() }),
          execute: async ({ amount }) => `Paid ${amount}`,
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [eagerPlugin, deferredPlugin],
      // Default eager mode
    });

    const activeTools = agent.getActiveTools();

    // Eager plugin tools ARE loaded
    expect(activeTools).toHaveProperty("mcp__core-utils__ping");

    // Deferred plugin tools are NOT loaded
    expect(activeTools).not.toHaveProperty("mcp__stripe__create_payment");

    // call_tool is created because there are proxied tools
    expect(activeTools).toHaveProperty("call_tool");
  });

  it("creates search_tools when a deferred plugin exists", () => {
    const deferredPlugin = definePlugin({
      name: "stripe",
      deferred: true,
      tools: {
        create_payment: tool({
          description: "Create a payment",
          parameters: z.object({ amount: z.number() }),
          execute: async ({ amount }) => `Paid ${amount}`,
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [deferredPlugin],
    });

    const activeTools = agent.getActiveTools();
    expect(activeTools).toHaveProperty("search_tools");
  });

  it("respects deferred: false in proxy mode to eagerly load", () => {
    const eagerInProxy = definePlugin({
      name: "core-utils",
      deferred: false, // Opt out of proxy deferral
      tools: {
        ping: tool({
          description: "Ping",
          parameters: z.object({}),
          execute: async () => "pong",
        }),
      },
    });

    const normalPlugin = definePlugin({
      name: "stripe",
      // No explicit deferred — defaults to true in proxy mode
      tools: {
        create_payment: tool({
          description: "Create a payment",
          parameters: z.object({ amount: z.number() }),
          execute: async ({ amount }) => `Paid ${amount}`,
        }),
      },
    });

    const model = createMockModel();
    const agent = createAgent({
      model,
      plugins: [eagerInProxy, normalPlugin],
      pluginLoading: "proxy",
    });

    const activeTools = agent.getActiveTools();

    // Opted-out plugin IS loaded eagerly
    expect(activeTools).toHaveProperty("mcp__core-utils__ping");

    // Default plugin in proxy mode is NOT loaded
    expect(activeTools).not.toHaveProperty("mcp__stripe__create_payment");
  });
});
