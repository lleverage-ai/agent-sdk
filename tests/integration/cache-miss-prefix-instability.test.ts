/**
 * Suite B — Prefix instability caused by the dynamic PromptBuilder
 *
 * Anthropic caching requires 100% exact match on the entire cached prefix
 * (tools → system → messages, in that order). Any single character change to
 * the system prompt invalidates the cache for that and all subsequent levels.
 *
 * The agent-sdk's PromptBuilder embeds dynamic state (current message count,
 * active tool list) in every system prompt it generates. This means the prefix
 * changes on every generate() call, causing a cache miss and a full re-write
 * even when cache_control markers ARE present.
 *
 * Test structure:
 *
 *   Suite B Control (claude-haiku-4-5-20251001, static systemPrompt + markers)
 *     → Proves the test methodology is sound: when the prefix IS stable,
 *       caching WORKS. This test PASSES.
 *
 *   Suite B-S (claude-haiku-4-5-20251001, dynamic PromptBuilder + markers)
 *     → Proves the SDK's dynamic PromptBuilder breaks caching. FAILS.
 *
 *   Suite B-O (claude-opus-4-6, dynamic PromptBuilder + markers)
 *     → Same proof on the flagship model. FAILS.
 *
 * Minimum token thresholds (measured via direct API probe):
 *   claude-haiku-4-5-20251001 → ~4,096 tokens (verified between 4,006 and 4,196 total)
 *   claude-opus-4-6            → ~4,096 tokens
 *
 * Reference: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 *
 * Run with:
 *   RUN_E2E_TESTS=1 bun test tests/integration/cache-miss-prefix-instability.test.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { anthropic } from "@ai-sdk/anthropic";
import { afterEach, describe, expect, it } from "vitest";
import { wrapLanguageModel } from "ai";
import type { LanguageModelMiddleware } from "ai";
import { createAgent } from "../../src/agent.js";
import {
  createDefaultPromptBuilder,
  MemorySaver,
} from "../../src/index.js";
import type { PromptBuilder } from "../../src/index.js";

// Load .env file manually (dotenv not available)
function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env");
  const env: Record<string, string> = {};
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
  } catch {
    // .env file not found — tests will be skipped
  }
  return env;
}

const shouldRun = process.env.RUN_E2E_TESTS === "1";
const envVars = shouldRun ? loadEnv() : {};
const apiKey = process.env.ANTHROPIC_API_KEY ?? envVars.ANTHROPIC_API_KEY ?? "";

if (shouldRun && apiKey) {
  process.env.ANTHROPIC_API_KEY = apiKey;
}

const describeE2E = shouldRun ? describe : describe.skip;

/**
 * Middleware that:
 * 1. Injects cache_control onto the system message via transformParams
 *    (runs before doGenerate, so the marker reaches the Anthropic provider).
 * 2. Captures the exact system prompt string sent to the provider via wrapGenerate
 *    (receives the already-transformed params).
 *
 * The cache_control is applied as providerOptions.anthropic.cacheControl on the
 * system message, which the @ai-sdk/anthropic provider converts into the
 * cache_control field on the text block of the system array in the API request.
 */
function makeCaptureAndMarkMiddleware(
  capturedSystemPrompts: string[],
): LanguageModelMiddleware {
  return {
    transformParams: async ({ params, type }) => {
      if (type !== "generate") return params;

      const systemIndex = params.prompt.findIndex((m) => m.role === "system");
      if (systemIndex === -1) return params;

      const systemMessage = params.prompt[systemIndex];
      const modifiedPrompt = [...params.prompt];

      modifiedPrompt[systemIndex] = {
        ...systemMessage,
        providerOptions: {
          ...systemMessage.providerOptions,
          anthropic: {
            cacheControl: { type: "ephemeral" },
          },
        },
      };

      return { ...params, prompt: modifiedPrompt };
    },

    wrapGenerate: async ({ doGenerate, params }) => {
      const systemMessage = params.prompt.find((m) => m.role === "system");
      if (systemMessage?.role === "system") {
        capturedSystemPrompts.push(systemMessage.content);
      }
      return doGenerate();
    },
  };
}

type CacheUsage = {
  cacheWriteTokens: number;
  cacheReadTokens: number;
  noCacheTokens: number;
};

function extractCacheUsage(result: {
  usage?: {
    inputTokenDetails?: {
      cacheWriteTokens?: number;
      cacheReadTokens?: number;
      noCacheTokens?: number;
    };
  };
}): CacheUsage {
  return {
    cacheWriteTokens: result.usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
    cacheReadTokens: result.usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    noCacheTokens: result.usage?.inputTokenDetails?.noCacheTokens ?? 0,
  };
}

function logCacheTrace(
  suiteName: string,
  results: Parameters<typeof extractCacheUsage>[0][],
  capturedSystemPrompts: string[],
): void {
  console.log(`\n--- ${suiteName} — per-call cache token trace ---`);
  results.forEach((r, i) => {
    const u = extractCacheUsage(r);
    console.log(
      `  Call ${i + 1}: cacheWrite=${u.cacheWriteTokens}  cacheRead=${u.cacheReadTokens}  noCacheTokens=${u.noCacheTokens}`,
    );
  });

  if (capturedSystemPrompts.length >= 2) {
    const diffIndex = [...capturedSystemPrompts[0]].findIndex(
      (ch, i) => ch !== capturedSystemPrompts[1][i],
    );
    console.log(
      `\n  System prompt length (call 1): ${capturedSystemPrompts[0].length} chars`,
    );
    console.log(
      `  System prompt length (call 2): ${capturedSystemPrompts[1].length} chars`,
    );
    console.log(
      `  First difference at character index: ${diffIndex === -1 ? "none (identical)" : diffIndex}`,
    );
  }
}

// ─── Suite B Control: claude-haiku-4-5-20251001, static prefix ───────────────
//
// Uses promptMode: "static" (systemPrompt option) which returns the literal
// string unchanged on every call — no dynamic PromptBuilder involved.
// With markers injected and a stable prefix, caching SHOULD work.
// This test is expected to PASS. It proves the methodology is sound.

describeE2E(
  "Suite B Control: claude-haiku-4-5-20251001 — static system prompt with cache markers (should PASS)",
  () => {
    const model = anthropic("claude-haiku-4-5-20251001");

    // A large static system prompt that exceeds the ~4,096-token threshold for
    // claude-haiku-4-5-20251001 (verified via direct API probe). Without tools
    // in the prefix, the system prompt alone must clear the 4,096-token minimum.
    // Each repeat is ~15 tokens; 300 repeats ≈ 4,500 tokens — safely above threshold.
    const STATIC_SYSTEM_PROMPT =
      "You are a helpful AI assistant for cache miss testing. " +
      "Your role is to respond concisely and accurately to all queries. ".repeat(
        300,
      );

    const agentsToDispose: Array<{ dispose(): Promise<void> }> = [];

    afterEach(async () => {
      for (const agent of agentsToDispose) {
        await agent.dispose().catch(() => {});
      }
      agentsToDispose.length = 0;
    });

    it(
      "5 consecutive calls with a stable prefix and markers — cache should be read on calls 2–5 (control: should PASS)",
      { timeout: 300_000 },
      async () => {
        const capturedSystemPrompts: string[] = [];
        const middleware = makeCaptureAndMarkMiddleware(capturedSystemPrompts);

        const wrappedModel = wrapLanguageModel({ model, middleware });

        // Static mode: systemPrompt is returned verbatim on every call.
        // No checkpointer, so there is no growing message history.
        const agent = createAgent({
          model: wrappedModel,
          systemPrompt: STATIC_SYSTEM_PROMPT,
          permissionMode: "bypassPermissions",
        });

        await agent.ready;
        agentsToDispose.push(agent);

        const results = [];
        for (let i = 1; i <= 5; i++) {
          results.push(
            await agent.generate({
              prompt: `Call ${i}: reply with exactly one word`,
            }),
          );
        }

        for (const result of results) {
          expect(result.status).toBe("complete");
        }

        logCacheTrace("B Control", results, capturedSystemPrompts);

        // The system prompt must be byte-for-byte identical across all calls.
        expect(new Set(capturedSystemPrompts).size).toBe(1);

        // Call 1: the static system prompt (> 4,096 tokens) activates the cache.
        // On a fresh run this writes; if a prior run completed within the 5-minute
        // Anthropic TTL it reads instead. Either way caching must be active.
        const u1 = extractCacheUsage(results[0]);
        expect(u1.cacheWriteTokens + u1.cacheReadTokens).toBeGreaterThan(0);

        // Calls 2–5: the prefix is identical to call 1 (static mode, no message
        // count embedded), so each call must read from the cached entry.
        for (const result of results.slice(1)) {
          const u = extractCacheUsage(result);
          expect(u.cacheReadTokens).toBeGreaterThan(0);
        }
      },
    );
  },
);

// ─── Suite B-S: claude-haiku-4-5-20251001, dynamic PromptBuilder ─────────────

describeE2E(
  "Suite B-S: claude-haiku-4-5-20251001 — dynamic PromptBuilder with cache markers (should FAIL)",
  () => {
    const model = anthropic("claude-haiku-4-5-20251001");

    // Padding ensures the Anthropic cache threshold is met for claude-haiku-4-5-20251001
    // (~4,096 tokens minimum for the combined prefix). Without registered tools, the
    // system prompt alone must exceed the threshold. The PromptBuilder base output
    // (identity + permission-mode + context) adds ~50 tokens. repeat(300) adds
    // ≈ 4,500 tokens → total prefix ≈ 4,550 tokens, safely above the ~4,096 minimum.
    const PADDING_SONNET =
      "This agent is part of a cache miss verification suite. " +
      "It demonstrates that dynamic system prompt construction prevents " +
      "provider-level prompt caching from being effective. ".repeat(300);

    const agentsToDispose: Array<{ dispose(): Promise<void> }> = [];

    afterEach(async () => {
      for (const agent of agentsToDispose) {
        await agent.dispose().catch(() => {});
      }
      agentsToDispose.length = 0;
    });

    it(
      "system prompt must be identical across calls for caching to work — fails because PromptBuilder embeds dynamic message count",
      { timeout: 240_000 },
      async () => {
        const capturedSystemPrompts: string[] = [];
        const middleware = makeCaptureAndMarkMiddleware(capturedSystemPrompts);

        const wrappedModel = wrapLanguageModel({ model, middleware });

        const checkpointer = new MemorySaver();
        const threadId = "cache-test-prefix-stability-sonnet";

        const promptBuilder: PromptBuilder = createDefaultPromptBuilder().register({
          name: "cache-test-padding",
          priority: 1,
          render: () => PADDING_SONNET,
        });

        const agent = createAgent({
          model: wrappedModel,
          checkpointer,
          promptBuilder,
          permissionMode: "bypassPermissions",
        });

        await agent.ready;
        agentsToDispose.push(agent);

        // Four calls so we can observe the prompt diverging with each one.
        for (let i = 1; i <= 4; i++) {
          await agent.generate({
            prompt: `Call ${i}: reply with exactly one word`,
            threadId,
          });
        }

        expect(capturedSystemPrompts).toHaveLength(4);

        console.log("\n--- B-S stability check — captured system prompt diffs ---");
        for (let i = 1; i < capturedSystemPrompts.length; i++) {
          const prev = capturedSystemPrompts[i - 1];
          const curr = capturedSystemPrompts[i];
          const diffIndex = [...prev].findIndex((ch, j) => ch !== curr[j]);
          console.log(
            `  Call ${i} → Call ${i + 1}: first difference at char ${diffIndex === -1 ? "none (identical)" : diffIndex}`,
          );
        }

        // For prefix-based caching, the system prompt must be byte-for-byte
        // identical on every call. This assertion fails because the default
        // PromptBuilder embeds the current message count in its output.
        expect(new Set(capturedSystemPrompts).size).toBe(1);
      },
    );

    it(
      "5 consecutive calls should read from cache on calls 2–5 — fails because dynamic prefix causes re-write every call",
      { timeout: 300_000 },
      async () => {
        const capturedSystemPrompts: string[] = [];
        const middleware = makeCaptureAndMarkMiddleware(capturedSystemPrompts);

        const wrappedModel = wrapLanguageModel({ model, middleware });

        const checkpointer = new MemorySaver();
        const threadId = "cache-test-read-miss-sonnet";

        // A unique run ID embedded in the padding guarantees this test invocation's
        // prefix has never been seen by Anthropic before, eliminating any stale
        // cache entries from prior runs that would otherwise cause false reads.
        // repeat(300) ensures the total prefix exceeds the ~4,096-token minimum
        // required for claude-haiku-4-5-20251001 to write a cache entry.
        const runId = Math.random().toString(36).slice(2, 10);
        const paddingForThisRun =
          `[run:${runId}] ` +
          "This agent is part of a cache miss verification suite. " +
          "It demonstrates that dynamic system prompt construction prevents " +
          "provider-level prompt caching from being effective. ".repeat(300);

        const promptBuilder: PromptBuilder = createDefaultPromptBuilder().register({
          name: "cache-test-padding",
          priority: 1,
          render: () => paddingForThisRun,
        });

        const agent = createAgent({
          model: wrappedModel,
          checkpointer,
          promptBuilder,
          permissionMode: "bypassPermissions",
        });

        await agent.ready;
        agentsToDispose.push(agent);

        const results = [];
        for (let i = 1; i <= 5; i++) {
          results.push(
            await agent.generate({
              prompt: `Call ${i}: reply with exactly one word`,
              threadId,
            }),
          );
        }

        for (const result of results) {
          expect(result.status).toBe("complete");
        }

        logCacheTrace("B-S five calls", results, capturedSystemPrompts);

        // Call 1: unique padding ensures no stale cache entry exists for this run.
        // The padded prefix exceeds the 4,096-token minimum → written to cache.
        // This assertion PASSES — it proves markers work and the threshold is met.
        const u1 = extractCacheUsage(results[0]);
        expect(u1.cacheWriteTokens).toBeGreaterThan(0);
        expect(u1.cacheReadTokens).toBe(0);

        // Calls 2–5: the system prompt changed (message count incremented), so
        // Anthropic sees a new prefix. It re-creates the cache entry instead of
        // reading the one from call 1. cacheWriteTokens > 0 on every call confirms
        // the cache is re-written each time (not a network error, not a TTL issue).
        for (const result of results.slice(1)) {
          const u = extractCacheUsage(result);
          expect(u.cacheWriteTokens).toBeGreaterThan(0);
        }

        // KEY FAILING ASSERTION: calls 2–5 should serve the system prompt from
        // the cache written on call 1. They don't, because the prefix changed.
        // Every call pays full input token cost for the system prompt.
        for (const result of results.slice(1)) {
          expect(
            result.usage?.inputTokenDetails?.cacheReadTokens,
          ).toBeGreaterThan(0);
        }
      },
    );
  },
);

// ─── Suite B-O: claude-opus-4-6, dynamic PromptBuilder ───────────────────────

describeE2E(
  "Suite B-O: claude-opus-4-6 — dynamic PromptBuilder with cache markers (should FAIL)",
  () => {
    const model = anthropic("claude-opus-4-6");

    // Padding ensures the total system prompt exceeds the 4,096-token minimum
    // for Opus 4.6. Without registered tools, the system prompt alone must exceed
    // the threshold. The PromptBuilder base output (identity + permission-mode +
    // context) adds ~50 tokens. repeat(300) adds ≈ 4,500 tokens → total ≈ 4,550
    // tokens, well above the 4,096 minimum.
    const PADDING_OPUS =
      "This agent is part of a cache miss verification suite. " +
      "It demonstrates that dynamic system prompt construction prevents " +
      "provider-level prompt caching from being effective. ".repeat(300);

    const agentsToDispose: Array<{ dispose(): Promise<void> }> = [];

    afterEach(async () => {
      for (const agent of agentsToDispose) {
        await agent.dispose().catch(() => {});
      }
      agentsToDispose.length = 0;
    });

    it(
      "5 consecutive calls should read from cache on calls 2–5 — fails because dynamic prefix causes re-write every call",
      { timeout: 600_000 },
      async () => {
        const capturedSystemPrompts: string[] = [];
        const middleware = makeCaptureAndMarkMiddleware(capturedSystemPrompts);

        const wrappedModel = wrapLanguageModel({ model, middleware });

        const checkpointer = new MemorySaver();
        const threadId = "cache-test-read-miss-opus";

        // A unique run ID embedded in the padding guarantees this test invocation's
        // prefix has never been seen by Anthropic before, eliminating any stale
        // cache entries from prior runs that would otherwise cause false reads.
        const runId = Math.random().toString(36).slice(2, 10);
        const paddingForThisRun =
          `[run:${runId}] ` +
          "This agent is part of a cache miss verification suite. " +
          "It demonstrates that dynamic system prompt construction prevents " +
          "provider-level prompt caching from being effective. ".repeat(300);

        const promptBuilder: PromptBuilder = createDefaultPromptBuilder().register({
          name: "cache-test-padding",
          priority: 1,
          render: () => paddingForThisRun,
        });

        const agent = createAgent({
          model: wrappedModel,
          checkpointer,
          promptBuilder,
          permissionMode: "bypassPermissions",
        });

        await agent.ready;
        agentsToDispose.push(agent);

        const results = [];
        for (let i = 1; i <= 5; i++) {
          results.push(
            await agent.generate({
              prompt: `Call ${i}: reply with exactly one word`,
              threadId,
            }),
          );
        }

        for (const result of results) {
          expect(result.status).toBe("complete");
        }

        logCacheTrace("B-O five calls", results, capturedSystemPrompts);

        // Call 1: unique padding ensures no stale cache entry exists for this run.
        // Padded prompt exceeds the 4,096-token Opus minimum → written to cache.
        // This assertion PASSES — it proves markers work and the threshold is met.
        const u1 = extractCacheUsage(results[0]);
        expect(u1.cacheWriteTokens).toBeGreaterThan(0);
        expect(u1.cacheReadTokens).toBe(0);

        // Calls 2–5: system prompt re-written each time (message count changed).
        // cacheWriteTokens > 0 confirms the cache is being re-created, not read.
        for (const result of results.slice(1)) {
          const u = extractCacheUsage(result);
          expect(u.cacheWriteTokens).toBeGreaterThan(0);
        }

        // KEY FAILING ASSERTION: even on the flagship Claude Opus 4.6, caching
        // is never served from cache on calls 2–5 because the system prompt
        // prefix is different on every call. Full input token cost is paid every
        // single time the agent is invoked.
        for (const result of results.slice(1)) {
          expect(
            result.usage?.inputTokenDetails?.cacheReadTokens,
          ).toBeGreaterThan(0);
        }
      },
    );
  },
);
