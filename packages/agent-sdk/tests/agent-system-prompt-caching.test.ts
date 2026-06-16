/**
 * Agent-level tests for opt-in system-prompt caching (LLE-10626).
 *
 * Verifies: backward-compatible string mode when disabled; structured-block
 * array emission with a cacheControl breakpoint when enabled; ttl honoured;
 * conversationBreakpoint adds a second breakpoint within the provider budget;
 * the budget guard refuses to exceed the four-breakpoint limit or double-mark a
 * message that already carries a breakpoint; and that only the `anthropic`
 * provider namespace is touched (provider-agnostic).
 */

import type { SystemModelMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, PromptBuilder } from "../src/index.js";
import { createMockModel, resetMocks } from "./setup.js";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
  };
});

import { generateText } from "ai";

const GENERATE_RESULT = {
  text: "ok",
  steps: [],
  toolCalls: [],
  toolResults: [],
  finishReason: "stop",
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    inputTokenDetails: {},
    outputTokenDetails: {},
  },
  response: { id: "id", timestamp: new Date(), modelId: "mock-model", messages: [] },
  request: {},
  warnings: [],
  providerMetadata: undefined,
  files: [],
  sources: [],
  reasoning: [],
  reasoningText: undefined,
  content: [],
} as never;

/**
 * A small builder with one static head and one dynamic tail so the stability
 * split is deterministic and independent of the default component set.
 */
function makeBuilder(): PromptBuilder {
  return new PromptBuilder().registerMany([
    { name: "identity", priority: 100, stability: "static", render: () => "IDENTITY" },
    { name: "context", priority: 80, stability: "dynamic", render: () => "CONTEXT" },
  ]);
}

function capturedCallArgs(): Record<string, unknown> {
  const mock = vi.mocked(generateText);
  expect(mock).toHaveBeenCalledTimes(1);
  return mock.mock.calls[0]![0] as Record<string, unknown>;
}

function hasAnthropicCacheBreakpoint(providerOptions: unknown): boolean {
  const anthropic = (providerOptions as { anthropic?: { cacheControl?: unknown } } | undefined)
    ?.anthropic;
  return anthropic?.cacheControl !== undefined;
}

describe("agent system-prompt caching", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
    vi.mocked(generateText).mockResolvedValue(GENERATE_RESULT);
  });

  describe("disabled (default) — backward compatibility", () => {
    it("passes the system prompt as a plain string when caching is unset", async () => {
      const agent = createAgent({ model: createMockModel(), promptBuilder: makeBuilder() });

      await agent.generate({ prompt: "hi" });

      const args = capturedCallArgs();
      expect(typeof args.system).toBe("string");
      expect(args.system).toBe("IDENTITY\n\nCONTEXT");
    });

    it("is byte-identical to the builder's build() output and to the array concatenation", async () => {
      const builder = makeBuilder();
      const agent = createAgent({ model: createMockModel(), promptBuilder: builder });

      await agent.generate({ prompt: "hi" });

      const stringSystem = capturedCallArgs().system as string;
      expect(stringSystem).toBe(builder.build({ memoryAvailable: false }));
    });

    it("does not annotate any message with a cache breakpoint when disabled", async () => {
      const agent = createAgent({
        model: createMockModel(),
        promptBuilder: makeBuilder(),
        systemPromptCaching: { enabled: false },
      });

      await agent.generate({ prompt: "hi" });

      const messages = capturedCallArgs().messages as Array<{ providerOptions?: unknown }>;
      for (const message of messages) {
        expect(hasAnthropicCacheBreakpoint(message.providerOptions)).toBe(false);
      }
    });
  });

  describe("enabled — structured-block emission", () => {
    it("emits the system as an array of system messages split at the stability boundary", async () => {
      const agent = createAgent({
        model: createMockModel(),
        promptBuilder: makeBuilder(),
        systemPromptCaching: { enabled: true },
      });

      await agent.generate({ prompt: "hi" });

      const system = capturedCallArgs().system as SystemModelMessage[];
      expect(Array.isArray(system)).toBe(true);
      expect(system).toHaveLength(2);
      expect(system[0]?.content).toBe("IDENTITY");
      expect(system[1]?.content).toBe("CONTEXT");
    });

    it("marks the stable head with a cacheControl breakpoint and defaults ttl to 5m", async () => {
      const agent = createAgent({
        model: createMockModel(),
        promptBuilder: makeBuilder(),
        systemPromptCaching: { enabled: true },
      });

      await agent.generate({ prompt: "hi" });

      const system = capturedCallArgs().system as SystemModelMessage[];
      expect(system[0]?.providerOptions?.anthropic).toMatchObject({
        cacheControl: { type: "ephemeral", ttl: "5m" },
      });
      expect(system[1]?.providerOptions).toBeUndefined();
    });

    it("honours an explicit 1h ttl", async () => {
      const agent = createAgent({
        model: createMockModel(),
        promptBuilder: makeBuilder(),
        systemPromptCaching: { enabled: true, ttl: "1h" },
      });

      await agent.generate({ prompt: "hi" });

      const system = capturedCallArgs().system as SystemModelMessage[];
      expect(system[0]?.providerOptions?.anthropic).toMatchObject({
        cacheControl: { type: "ephemeral", ttl: "1h" },
      });
    });

    it("only sets the anthropic namespace, leaving the system provider-agnostic", async () => {
      const agent = createAgent({
        model: createMockModel(),
        promptBuilder: makeBuilder(),
        systemPromptCaching: { enabled: true },
      });

      await agent.generate({ prompt: "hi" });

      const system = capturedCallArgs().system as SystemModelMessage[];
      const namespaces = Object.keys(system[0]?.providerOptions ?? {});
      expect(namespaces).toEqual(["anthropic"]);
    });

    it("leaves a static systemPrompt string unaffected (split only applies to builders)", async () => {
      const agent = createAgent({
        model: createMockModel(),
        systemPrompt: "STATIC SYSTEM",
        systemPromptCaching: { enabled: true },
      });

      await agent.generate({ prompt: "hi" });

      const args = capturedCallArgs();
      expect(args.system).toBe("STATIC SYSTEM");
    });
  });

  describe("conversationBreakpoint", () => {
    it("adds a second breakpoint on the latest message, total breakpoints <= 4", async () => {
      const agent = createAgent({
        model: createMockModel(),
        promptBuilder: makeBuilder(),
        systemPromptCaching: { enabled: true, conversationBreakpoint: true },
      });

      await agent.generate({ prompt: "hi" });

      const args = capturedCallArgs();
      const system = args.system as SystemModelMessage[];
      const messages = args.messages as Array<{ providerOptions?: unknown }>;

      const systemBreakpoints = system.filter((m) =>
        hasAnthropicCacheBreakpoint(m.providerOptions),
      ).length;
      const messageBreakpoints = messages.filter((m) =>
        hasAnthropicCacheBreakpoint(m.providerOptions),
      ).length;

      expect(systemBreakpoints).toBe(1);
      expect(messageBreakpoints).toBe(1);

      // Only the LATEST message carries the breakpoint.
      const last = messages[messages.length - 1];
      expect(hasAnthropicCacheBreakpoint(last?.providerOptions)).toBe(true);

      expect(systemBreakpoints + messageBreakpoints).toBeLessThanOrEqual(4);
    });

    it("does not exceed the provider budget when incoming messages already carry breakpoints", async () => {
      // System head reserves one breakpoint. Three incoming messages already
      // carrying breakpoints plus the head fill the four-breakpoint budget, so
      // the latest message must NOT be stamped (stamping would make five).
      const markedOptions = {
        anthropic: { cacheControl: { type: "ephemeral" as const, ttl: "5m" as const } },
      };
      const agent = createAgent({
        model: createMockModel(),
        promptBuilder: makeBuilder(),
        systemPromptCaching: { enabled: true, conversationBreakpoint: true },
      });

      await agent.generate({
        messages: [
          { role: "user", content: "one", providerOptions: markedOptions },
          { role: "assistant", content: "two", providerOptions: markedOptions },
          { role: "user", content: "three", providerOptions: markedOptions },
        ],
      });

      const args = capturedCallArgs();
      const system = args.system as SystemModelMessage[];
      const messages = args.messages as Array<{ providerOptions?: unknown }>;

      const systemBreakpoints = system.filter((m) =>
        hasAnthropicCacheBreakpoint(m.providerOptions),
      ).length;
      const messageBreakpoints = messages.filter((m) =>
        hasAnthropicCacheBreakpoint(m.providerOptions),
      ).length;

      // The three pre-existing breakpoints are preserved, none added.
      expect(systemBreakpoints).toBe(1);
      expect(messageBreakpoints).toBe(3);
      expect(systemBreakpoints + messageBreakpoints).toBeLessThanOrEqual(4);
    });

    it("does not double-mark a latest message that already carries a breakpoint", async () => {
      const markedOptions = {
        anthropic: { cacheControl: { type: "ephemeral" as const, ttl: "1h" as const } },
      };
      const agent = createAgent({
        model: createMockModel(),
        promptBuilder: makeBuilder(),
        systemPromptCaching: { enabled: true, conversationBreakpoint: true },
      });

      await agent.generate({
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "marked", providerOptions: markedOptions },
        ],
      });

      const messages = capturedCallArgs().messages as Array<{
        providerOptions?: { anthropic?: { cacheControl?: { ttl?: string } } };
      }>;
      const last = messages[messages.length - 1];

      // The latest message keeps its original 1h breakpoint, not overwritten.
      expect(hasAnthropicCacheBreakpoint(last?.providerOptions)).toBe(true);
      expect(last?.providerOptions?.anthropic?.cacheControl?.ttl).toBe("1h");
      const messageBreakpoints = messages.filter((m) =>
        hasAnthropicCacheBreakpoint(m.providerOptions),
      ).length;
      expect(messageBreakpoints).toBe(1);
    });

    it("stamps the latest message when budget allows alongside one pre-existing breakpoint", async () => {
      const markedOptions = {
        anthropic: { cacheControl: { type: "ephemeral" as const, ttl: "5m" as const } },
      };
      const agent = createAgent({
        model: createMockModel(),
        promptBuilder: makeBuilder(),
        systemPromptCaching: { enabled: true, conversationBreakpoint: true },
      });

      await agent.generate({
        messages: [
          { role: "user", content: "marked", providerOptions: markedOptions },
          { role: "assistant", content: "tail" },
        ],
      });

      const args = capturedCallArgs();
      const system = args.system as SystemModelMessage[];
      const messages = args.messages as Array<{ providerOptions?: unknown }>;

      const systemBreakpoints = system.filter((m) =>
        hasAnthropicCacheBreakpoint(m.providerOptions),
      ).length;
      const messageBreakpoints = messages.filter((m) =>
        hasAnthropicCacheBreakpoint(m.providerOptions),
      ).length;

      // Head (1) + pre-existing (1) + newly stamped latest (1) = 3 <= 4.
      expect(systemBreakpoints).toBe(1);
      expect(messageBreakpoints).toBe(2);
      expect(hasAnthropicCacheBreakpoint(messages[messages.length - 1]?.providerOptions)).toBe(
        true,
      );
      expect(systemBreakpoints + messageBreakpoints).toBeLessThanOrEqual(4);
    });

    it("does not annotate any message when conversationBreakpoint is false", async () => {
      const agent = createAgent({
        model: createMockModel(),
        promptBuilder: makeBuilder(),
        systemPromptCaching: { enabled: true, conversationBreakpoint: false },
      });

      await agent.generate({ prompt: "hi" });

      const messages = capturedCallArgs().messages as Array<{ providerOptions?: unknown }>;
      for (const message of messages) {
        expect(hasAnthropicCacheBreakpoint(message.providerOptions)).toBe(false);
      }
    });
  });
});
