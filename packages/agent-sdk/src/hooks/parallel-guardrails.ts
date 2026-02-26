/**
 * Guardrails - Content moderation utilities for AI generation.
 *
 * This module provides a simple, composable approach to content moderation:
 * - Guardrails are just async functions that return pass/block results
 * - Multiple guardrails can race against generation
 * - First failure aborts everything via shared AbortSignal
 *
 * @packageDocumentation
 */

import type { UIMessage } from "ai";
import { GeneratePermissionDeniedError } from "../errors/index.js";

// =============================================================================
// Core Types
// =============================================================================

/**
 * Result from a guardrail check.
 */
export interface GuardrailCheckResult {
  /** Whether the content should be blocked */
  blocked: boolean;
  /** Reason for blocking (if blocked) */
  reason?: string;
  /** IDs of messages that caused the block */
  blockedMessageIds?: string[];
}

/**
 * A guardrail is a function that checks content and returns a result.
 *
 * Guardrails can be sync or async. They receive the text to check and
 * an optional AbortSignal for cancellation.
 *
 * @example
 * ```typescript
 * // Simple regex guardrail
 * const noSecrets: Guardrail = async (text) => ({
 *   blocked: /SECRET_API_KEY/i.test(text),
 *   reason: "Contains sensitive pattern",
 * });
 *
 * // LLM-based guardrail
 * const llmModeration: Guardrail = async (text, signal) => {
 *   const result = await moderateWithLLM(text, { signal });
 *   return {
 *     blocked: result.flagged,
 *     reason: result.reason,
 *   };
 * };
 * ```
 */
export type Guardrail = (
  text: string,
  signal?: AbortSignal,
) => Promise<GuardrailCheckResult> | GuardrailCheckResult;

/**
 * Options for raceGuardrails.
 */
export interface RaceGuardrailsOptions {
  /** Message to show when content is blocked */
  blockedMessage?: string;
  /** IDs of messages to remove from client history if blocked */
  blockedMessageIds?: string[];
}

// =============================================================================
// Core Utility
// =============================================================================

/**
 * Race multiple guardrails - first failure blocks, all run in parallel.
 *
 * Returns a Promise that resolves when all guardrails pass, or rejects
 * with GeneratePermissionDeniedError if any guardrail blocks.
 *
 * @example
 * ```typescript
 * const controller = new AbortController();
 *
 * // Start guardrails and generation in parallel
 * const guardrailsPromise = raceGuardrails(
 *   text,
 *   [regexGuardrail, llmGuardrail],
 *   controller.signal,
 *   {
 *     blockedMessage: "Content blocked",
 *     onBlock: () => controller.abort(),
 *   }
 * );
 *
 * const generation = agent.streamRaw({
 *   messages,
 *   signal: controller.signal,
 * });
 *
 * // Wait for guardrails to pass (or throw)
 * await guardrailsPromise;
 * ```
 */
export async function raceGuardrails(
  text: string,
  guardrails: Guardrail[],
  signal?: AbortSignal,
  options: RaceGuardrailsOptions = {},
): Promise<void> {
  if (guardrails.length === 0) return;

  // Run all guardrails in parallel
  const results = await Promise.all(guardrails.map((guardrail) => guardrail(text, signal)));

  // Check for any failures
  const failed = results.find((r) => r.blocked);
  if (failed) {
    throw new GeneratePermissionDeniedError(
      options.blockedMessage || failed.reason || "Content blocked by guardrail",
      {
        reason: failed.reason,
        blockedMessageIds: failed.blockedMessageIds || options.blockedMessageIds,
      },
    );
  }
}

/**
 * Run guardrails in parallel with generation, aborting on first failure.
 *
 * This is a convenience wrapper that sets up the abort controller and
 * coordinates guardrails with the generation function.
 *
 * @example
 * ```typescript
 * const result = await runWithGuardrails(
 *   extractText(messages),
 *   [regexGuardrail, llmGuardrail],
 *   (signal) => agent.generate({ messages, signal })
 * );
 * ```
 */
export async function runWithGuardrails<T>(
  text: string,
  guardrails: Guardrail[],
  generateFn: (signal: AbortSignal) => Promise<T>,
  options: RaceGuardrailsOptions = {},
): Promise<T> {
  const controller = new AbortController();

  // Start guardrails check
  const guardrailsPromise = raceGuardrails(text, guardrails, controller.signal, options).catch(
    (error) => {
      // On guardrail failure, abort generation
      controller.abort();
      throw error;
    },
  );

  // Start generation in parallel
  const generationPromise = generateFn(controller.signal);

  // Wait for both - guardrails failure will abort generation
  try {
    const [, result] = await Promise.all([guardrailsPromise, generationPromise]);
    return result;
  } catch (error) {
    // If it's already a GeneratePermissionDeniedError, rethrow
    if (error instanceof GeneratePermissionDeniedError) {
      throw error;
    }
    // If generation was aborted due to guardrail, the guardrailsPromise
    // will have the actual error
    throw error;
  }
}

// =============================================================================
// Helper Factories
// =============================================================================

/**
 * Create a regex-based guardrail.
 *
 * @example
 * ```typescript
 * const noSecrets = createRegexGuardrail([
 *   /SECRET_API_KEY/i,
 *   /password\s*=\s*["'][^"']+["']/i,
 * ], "Contains sensitive data");
 * ```
 */
export function createRegexGuardrail(patterns: RegExp[], reason?: string): Guardrail {
  return async (text) => {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return {
          blocked: true,
          reason: reason || `Content matches blocked pattern: ${pattern}`,
        };
      }
    }
    return { blocked: false };
  };
}

/**
 * Create a guardrail with a timeout.
 *
 * If the guardrail doesn't complete within the timeout, it returns
 * a non-blocking result (fail-open behavior).
 *
 * @example
 * ```typescript
 * const timedLLMGuardrail = withTimeout(llmGuardrail, 5000);
 * ```
 */
export function withTimeout(guardrail: Guardrail, timeoutMs: number, failOpen = true): Guardrail {
  return async (text, signal) => {
    const timeoutPromise = new Promise<GuardrailCheckResult>((resolve) => {
      setTimeout(() => {
        if (failOpen) {
          resolve({ blocked: false });
        } else {
          resolve({ blocked: true, reason: "Guardrail check timed out" });
        }
      }, timeoutMs);
    });

    return Promise.race([guardrail(text, signal), timeoutPromise]);
  };
}

// =============================================================================
// Text Extraction Utilities
// =============================================================================

/**
 * Extract text content from UI messages.
 */
export function extractTextFromMessages(messages: UIMessage[]): string {
  const texts: string[] = [];

  for (const msg of messages) {
    if (msg.parts) {
      for (const part of msg.parts) {
        if (part.type === "text" && part.text) {
          texts.push(part.text);
        }
      }
    }
  }

  return texts.join("\n");
}

/**
 * Find the last user message ID from a list of messages.
 */
export function findLastUserMessageId(messages: UIMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === "user") {
      return msg.id;
    }
  }
  return undefined;
}

// =============================================================================
// Buffered Output Guardrails
// =============================================================================

/**
 * Configuration for buffered output guardrails.
 */
export interface OutputGuardrailConfig {
  /**
   * Guardrail to run on accumulated output.
   * Can be a single guardrail or multiple that will be raced.
   */
  guardrails: Guardrail | Guardrail[];

  /**
   * Minimum buffer size (in characters) before running checks.
   * Helps avoid excessive API calls for small outputs.
   * @default 100
   */
  minBufferSize?: number;

  /**
   * Check interval in milliseconds.
   * If set, runs periodic checks on accumulated buffer.
   * @default undefined (only check at end)
   */
  checkIntervalMs?: number;

  /**
   * Timeout for guardrail checks in milliseconds.
   * @default 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Message to show when content is blocked.
   * @default "Output blocked by guardrail"
   */
  blockedMessage?: string;
}

/**
 * State of the buffered output guardrail.
 */
export type BufferedGuardrailState = "buffering" | "passed" | "blocked" | "error";

/**
 * Controller for buffered output guardrails.
 *
 * Buffers output content and runs guardrail checks before releasing
 * content to the client.
 */
export class BufferedOutputGuardrail {
  private buffer = "";
  private chunks: unknown[] = [];
  private state: BufferedGuardrailState = "buffering";
  private blockReason: string | null = null;
  private abortController: AbortController;
  private checkPromise: Promise<void> | null = null;
  private lastCheckTime = 0;
  private guardrails: Guardrail[];
  private config: Required<
    Pick<OutputGuardrailConfig, "minBufferSize" | "timeout" | "blockedMessage">
  > &
    OutputGuardrailConfig;

  constructor(config: OutputGuardrailConfig) {
    this.abortController = new AbortController();
    this.guardrails = Array.isArray(config.guardrails) ? config.guardrails : [config.guardrails];
    this.config = {
      minBufferSize: 100,
      timeout: 30000,
      blockedMessage: "Output blocked by guardrail",
      ...config,
    };
  }

  /** Get current state of the guardrail. */
  get currentState(): BufferedGuardrailState {
    return this.state;
  }

  /** Get the block reason (if blocked). */
  get reason(): string | null {
    return this.blockReason;
  }

  /** Get the abort signal. */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /** Check if guardrail is still buffering. */
  isBuffering(): boolean {
    return this.state === "buffering";
  }

  /** Check if guardrail has passed. */
  hasPassed(): boolean {
    return this.state === "passed";
  }

  /** Check if guardrail has blocked content. */
  hasBlocked(): boolean {
    return this.state === "blocked";
  }

  /**
   * Add content to the buffer.
   * Returns true if content should be forwarded, false if blocked.
   */
  addContent(text: string): boolean {
    if (this.state === "blocked") {
      return false;
    }

    this.buffer += text;

    // Check if we should run async check
    const shouldCheck = this.buffer.length >= this.config.minBufferSize && !this.checkPromise;

    // Check if periodic check is due
    const periodicCheckDue =
      this.config.checkIntervalMs && Date.now() - this.lastCheckTime >= this.config.checkIntervalMs;

    if (shouldCheck || periodicCheckDue) {
      this.startCheck();
    }

    return true;
  }

  /**
   * Add a chunk to the buffer for later flushing.
   */
  addChunk(chunk: unknown): boolean {
    if (this.state === "blocked") {
      return false;
    }
    this.chunks.push(chunk);
    return true;
  }

  private startCheck(): void {
    if (this.checkPromise) return;

    this.lastCheckTime = Date.now();

    const timedGuardrails = this.guardrails.map((g) => withTimeout(g, this.config.timeout));

    this.checkPromise = raceGuardrails(this.buffer, timedGuardrails, this.abortController.signal, {
      blockedMessage: this.config.blockedMessage,
    })
      .catch((error) => {
        if (error instanceof GeneratePermissionDeniedError) {
          this.state = "blocked";
          this.blockReason = error.reason || this.config.blockedMessage;
          this.abortController.abort();
        }
        throw error;
      })
      .finally(() => {
        this.checkPromise = null;
      });
  }

  /**
   * Finalize the guardrail check.
   * Call this when output is complete to ensure final check passes.
   */
  async finalize(): Promise<void> {
    if (this.state === "blocked") {
      throw new GeneratePermissionDeniedError(this.config.blockedMessage, {
        reason: this.blockReason || this.config.blockedMessage,
      });
    }

    // Wait for any pending check - if it failed, the error will propagate
    if (this.checkPromise) {
      await this.checkPromise;
    }

    // Run final check if we have content
    if (this.buffer.length > 0) {
      const timedGuardrails = this.guardrails.map((g) => withTimeout(g, this.config.timeout));

      try {
        await raceGuardrails(this.buffer, timedGuardrails, this.abortController.signal, {
          blockedMessage: this.config.blockedMessage,
        });
      } catch (error) {
        if (error instanceof GeneratePermissionDeniedError) {
          this.state = "blocked";
          this.blockReason = error.reason || this.config.blockedMessage;
          throw error;
        }
        throw error;
      }
    }

    this.state = "passed";
  }

  /** Get the buffered content. */
  getBuffer(): string {
    return this.buffer;
  }

  /** Get the buffered chunks. */
  getChunks(): unknown[] {
    return this.chunks;
  }

  /** Clear the buffer and chunks. */
  clear(): void {
    this.buffer = "";
    this.chunks = [];
  }

  /** Abort the guardrail. */
  abort(): void {
    this.abortController.abort();
    this.state = "error";
  }
}

/**
 * Creates a buffered output guardrail.
 *
 * @example
 * ```typescript
 * const guardrail = createBufferedOutputGuardrail({
 *   guardrails: [noSecretsGuardrail, noPIIGuardrail],
 *   minBufferSize: 100,
 * });
 *
 * for await (const chunk of stream) {
 *   if (chunk.type === 'text-delta') {
 *     if (!guardrail.addContent(chunk.delta)) break;
 *   }
 *   guardrail.addChunk(chunk);
 * }
 *
 * await guardrail.finalize();
 * for (const chunk of guardrail.getChunks()) {
 *   writer.write(chunk);
 * }
 * ```
 */
export function createBufferedOutputGuardrail(
  config: OutputGuardrailConfig,
): BufferedOutputGuardrail {
  return new BufferedOutputGuardrail(config);
}

/**
 * Wraps a ReadableStream with buffered output guardrails.
 *
 * @example
 * ```typescript
 * const guardedStream = wrapStreamWithOutputGuardrail(sourceStream, {
 *   guardrails: noSecretsGuardrail,
 * });
 *
 * for await (const chunk of guardedStream) {
 *   writer.write(chunk);
 * }
 * ```
 */
export function wrapStreamWithOutputGuardrail<
  T extends { type?: string; delta?: string; text?: string },
>(stream: ReadableStream<T>, config: OutputGuardrailConfig): ReadableStream<T> {
  const guardrail = createBufferedOutputGuardrail(config);
  const chunks: T[] = [];

  return new ReadableStream<T>({
    async start(controller) {
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            await guardrail.finalize();
            for (const chunk of chunks) {
              controller.enqueue(chunk);
            }
            controller.close();
            break;
          }

          if (value) {
            let textContent: string | undefined;
            if (value.type === "text-delta" && value.delta) {
              textContent = value.delta;
            } else if (value.type === "text" && value.text) {
              textContent = value.text;
            }

            if (textContent && !guardrail.addContent(textContent)) {
              controller.error(
                new GeneratePermissionDeniedError(
                  config.blockedMessage || "Output blocked by guardrail",
                  { reason: guardrail.reason || undefined },
                ),
              );
              return;
            }

            chunks.push(value);
          }
        }
      } catch (error) {
        reader.releaseLock();
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
}
