/**
 * Suite A — No cache_control markers emitted by the SDK
 *
 * Proves that the agent-sdk never emits cache_control markers on any request,
 * so Anthropic caching is never activated regardless of model, prompt size, or
 * number of consecutive calls.
 *
 * Anthropic caching requires explicit cache_control markers. Without them,
 * cache_creation_input_tokens and cache_read_input_tokens are always 0.
 *
 * These tests define the EXPECTED caching behaviour and FAIL today. They will
 * pass once the SDK adds cache_control support.
 *
 * Each suite uses a system prompt large enough that the total prefix exceeds
 * the ~4,096-token minimum for both models (verified via direct API probe).
 * The failure is therefore attributable solely to the missing cache_control
 * markers, not to an under-threshold prompt.
 *
 * Models tested:
 *   claude-haiku-4-5-20251001 — minimum ~4,096 tokens for caching (measured)
 *   claude-opus-4-6            — minimum ~4,096 tokens for caching (measured)
 *
 * Reference: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 *
 * Run with:
 *   RUN_E2E_TESTS=1 bun test tests/integration/cache-miss-no-markers.test.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { anthropic } from "@ai-sdk/anthropic";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../../src/agent.js";

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

// Large static system prompt shared across Suite A-S and Suite A-O.
// Ensures the total prefix exceeds the ~4,096-token minimum required for either
// model to write a cache entry when markers are present.
// With markers absent the assertions still fail — this sizing guarantees the
// failure is attributable to missing markers alone.
// Each repeat ≈ 15 tokens; 300 repeats ≈ 4,500 tokens, safely above the threshold.
const LARGE_SYSTEM_PROMPT =
  "You are a helpful AI assistant for cache miss testing. " +
  "Your role is to respond concisely and accurately to all queries. ".repeat(
    300,
  );

function logTokenTrace(
  suiteName: string,
  results: Array<{
    usage?: {
      inputTokenDetails?: {
        cacheWriteTokens?: number;
        cacheReadTokens?: number;
        noCacheTokens?: number;
      };
    };
  }>,
): void {
  console.log(`\n--- ${suiteName} — per-call cache token trace ---`);
  results.forEach((r, i) => {
    console.log(
      `  Call ${i + 1}: ` +
        `cacheWrite=${r.usage?.inputTokenDetails?.cacheWriteTokens ?? 0}  ` +
        `cacheRead=${r.usage?.inputTokenDetails?.cacheReadTokens ?? 0}  ` +
        `noCacheTokens=${r.usage?.inputTokenDetails?.noCacheTokens ?? 0}`,
    );
  });
}

// ─── Suite A-S: claude-haiku-4-5-20251001 ────────────────────────────────────

describeE2E(
  "Suite A-S: claude-haiku-4-5-20251001 — SDK emits no cache_control markers",
  () => {
    const model = anthropic("claude-haiku-4-5-20251001");
    const agentsToDispose: Array<{ dispose(): Promise<void> }> = [];

    afterEach(async () => {
      for (const agent of agentsToDispose) {
        await agent.dispose().catch(() => {});
      }
      agentsToDispose.length = 0;
    });

    it(
      "call 1 should write a cache entry — fails because SDK emits no cache_control markers",
      { timeout: 120_000 },
      async () => {
        const agent = createAgent({
          model,
          systemPrompt: LARGE_SYSTEM_PROMPT,
          permissionMode: "bypassPermissions",
        });

        await agent.ready;
        agentsToDispose.push(agent);

        const result = await agent.generate({
          prompt: "Reply with exactly one word: hello",
        });

        expect(result.status).toBe("complete");
        logTokenTrace("A-S single call", [result]);

        // Anthropic never writes a cache entry without an explicit cache_control
        // marker. The system prompt exceeds the ~4,096-token minimum so markers
        // would activate caching — but none are emitted. This assertion fails today.
        expect(
          result.usage?.inputTokenDetails?.cacheWriteTokens,
        ).toBeGreaterThan(0);
      },
    );

    it(
      "5 consecutive calls should write then read from cache — fails because SDK emits no cache_control markers",
      { timeout: 300_000 },
      async () => {
        const agent = createAgent({
          model,
          systemPrompt: LARGE_SYSTEM_PROMPT,
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

        logTokenTrace("A-S five calls", results);

        // Without cache_control markers the Anthropic API never writes a cache
        // entry, so cacheWriteTokens is 0 on every call. This assertion fails.
        expect(
          results[0].usage?.inputTokenDetails?.cacheWriteTokens,
        ).toBeGreaterThan(0);

        // Since nothing was ever written to the cache, subsequent calls cannot
        // read from it. All five calls pay full input token cost. These assertions
        // also fail — they document the cost that would be avoided with caching.
        for (const result of results.slice(1)) {
          expect(
            result.usage?.inputTokenDetails?.cacheReadTokens,
          ).toBeGreaterThan(0);
        }
      },
    );
  },
);

// ─── Suite A-O: claude-opus-4-6 ──────────────────────────────────────────────

describeE2E(
  "Suite A-O: claude-opus-4-6 — SDK emits no cache_control markers",
  () => {
    const model = anthropic("claude-opus-4-6");
    const agentsToDispose: Array<{ dispose(): Promise<void> }> = [];

    afterEach(async () => {
      for (const agent of agentsToDispose) {
        await agent.dispose().catch(() => {});
      }
      agentsToDispose.length = 0;
    });

    it(
      "call 1 should write a cache entry — fails because SDK emits no cache_control markers",
      { timeout: 120_000 },
      async () => {
        const agent = createAgent({
          model,
          systemPrompt: LARGE_SYSTEM_PROMPT,
          permissionMode: "bypassPermissions",
        });

        await agent.ready;
        agentsToDispose.push(agent);

        const result = await agent.generate({
          prompt: "Reply with exactly one word: hello",
        });

        expect(result.status).toBe("complete");
        logTokenTrace("A-O single call", [result]);

        // Without cache_control markers, Anthropic never caches regardless of
        // prompt size or model. The system prompt exceeds the threshold for Opus
        // so markers would work — but none are emitted. Assertion fails today.
        expect(
          result.usage?.inputTokenDetails?.cacheWriteTokens,
        ).toBeGreaterThan(0);
      },
    );

    it(
      "5 consecutive calls should write then read from cache — fails because SDK emits no cache_control markers",
      { timeout: 600_000 },
      async () => {
        const agent = createAgent({
          model,
          systemPrompt: LARGE_SYSTEM_PROMPT,
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

        logTokenTrace("A-O five calls", results);

        expect(
          results[0].usage?.inputTokenDetails?.cacheWriteTokens,
        ).toBeGreaterThan(0);

        for (const result of results.slice(1)) {
          expect(
            result.usage?.inputTokenDetails?.cacheReadTokens,
          ).toBeGreaterThan(0);
        }
      },
    );
  },
);
