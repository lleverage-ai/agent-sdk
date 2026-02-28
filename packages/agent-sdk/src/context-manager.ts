/**
 * Context management for token tracking and auto-compaction.
 *
 * This module provides tools for managing conversation context, including:
 * - Token counting and budget tracking
 * - Automatic context compaction/summarization
 * - Message history management
 *
 * @packageDocumentation
 */

import type { LanguageModel, ModelMessage } from "ai";
import type { Agent } from "./types.js";

// =============================================================================
// Token Counter
// =============================================================================

/**
 * Interface for counting tokens in text and messages.
 *
 * Implementations can use different tokenization strategies:
 * - Approximate counting (4 chars ≈ 1 token)
 * - Model-specific tokenizers (tiktoken, etc.)
 *
 * @category Context
 */
export interface TokenCounter {
  /**
   * Count tokens in a text string.
   * @param text - The text to count tokens in
   * @returns The estimated token count
   */
  count(text: string): number;

  /**
   * Count tokens in an array of messages.
   * @param messages - The messages to count tokens in
   * @returns The estimated token count
   */
  countMessages(messages: ModelMessage[]): number;

  /**
   * Invalidate cached token counts.
   * Call this when messages have been modified.
   */
  invalidateCache?(): void;
}

/**
 * Helper function to create a hash for a message for caching purposes.
 * Uses a simple hash of the serialized message content.
 *
 * @param message - The message to hash
 * @returns A hash string for the message
 */
function hashMessage(message: ModelMessage): string {
  // Create a stable string representation
  let content: string;
  if (typeof message.content === "string") {
    content = message.content;
  } else if (Array.isArray(message.content)) {
    // For array content, create a hash-friendly representation
    // For images/files, include type and a marker (not the full data)
    content = message.content
      .map((part) => {
        if ("text" in part) return `text:${part.text}`;
        if ("image" in part) return `image:${part.type}`;
        if ("data" in part && part.type === "file") return `file:${part.type}`;
        if ("toolName" in part) return `tool:${part.toolName}`;
        if ("result" in part) return `result:${JSON.stringify(part.result)}`;
        if ("output" in part) return `output:${JSON.stringify(part.output)}`;
        return JSON.stringify(part);
      })
      .join("|");
  } else {
    content = JSON.stringify(message.content);
  }

  // Simple hash function (djb2)
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash << 5) + hash + content.charCodeAt(i); /* hash * 33 + c */
  }

  return `${message.role}:${hash}`;
}

/**
 * Creates a simple token counter using character approximation.
 *
 * Uses the common approximation of 4 characters per token.
 * This is faster but less accurate than model-specific tokenizers.
 * Includes a message-level cache to avoid re-counting identical messages.
 *
 * @returns A token counter using character approximation
 *
 * @example
 * ```typescript
 * const counter = createApproximateTokenCounter();
 * const tokens = counter.count("Hello, world!"); // ~3 tokens
 * ```
 *
 * @category Context
 */
export function createApproximateTokenCounter(): TokenCounter {
  const CHARS_PER_TOKEN = 4;
  const messageCache = new Map<string, number>();

  const count = (text: string): number => {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  };

  const countSingleMessage = (message: ModelMessage): number => {
    const hash = hashMessage(message);

    // Check cache
    const cached = messageCache.get(hash);
    if (cached !== undefined) {
      return cached;
    }

    let total = 0;

    // Count message overhead (role, structure)
    total += 4; // Approximate overhead per message

    // Count content
    if (typeof message.content === "string") {
      total += count(message.content);
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if ("text" in part && typeof part.text === "string") {
          total += count(part.text);
        } else if ("toolName" in part) {
          // Tool call - count name and args
          total += count(part.toolName);
          if ("args" in part) {
            total += count(JSON.stringify(part.args));
          }
          if ("input" in part) {
            total += count(JSON.stringify(part.input));
          }
        } else if ("result" in part || "output" in part) {
          // Tool result - count output
          const output = "result" in part ? part.result : part.output;
          total += count(typeof output === "string" ? output : JSON.stringify(output));
        } else if ("image" in part) {
          // Image part - count ~1000 tokens for image (approximate vision model cost)
          // Images are expensive in terms of tokens, varies by size and model
          total += 1000;
        } else if ("data" in part && part.type === "file") {
          // File part - count as ~500 tokens per file (placeholder)
          // Actual token count depends on file size and content
          total += 500;
        }
      }
    }

    // Store in cache
    messageCache.set(hash, total);

    return total;
  };

  const countMessages = (messages: ModelMessage[]): number => {
    let total = 0;
    for (const message of messages) {
      total += countSingleMessage(message);
    }
    return total;
  };

  const invalidateCache = (): void => {
    messageCache.clear();
  };

  return { count, countMessages, invalidateCache };
}

/**
 * Options for creating a custom token counter.
 *
 * @category Context
 */
export interface CustomTokenCounterOptions {
  /**
   * Custom function to count tokens in text.
   * Use this to integrate model-specific tokenizers like tiktoken.
   */
  countFn: (text: string) => number;

  /**
   * Overhead tokens per message (default: 4).
   * Accounts for message structure tokens.
   */
  messageOverhead?: number;
}

/**
 * Creates a token counter with a custom counting function.
 *
 * Use this to integrate model-specific tokenizers for more accurate counts.
 * Includes a message-level cache to avoid re-counting identical messages.
 *
 * @param options - Configuration for the token counter
 * @returns A token counter using the custom function
 *
 * @example
 * ```typescript
 * import { encoding_for_model } from "tiktoken";
 *
 * const encoder = encoding_for_model("gpt-4");
 * const counter = createCustomTokenCounter({
 *   countFn: (text) => encoder.encode(text).length,
 * });
 * ```
 *
 * @category Context
 */
export function createCustomTokenCounter(options: CustomTokenCounterOptions): TokenCounter {
  const { countFn, messageOverhead = 4 } = options;
  const messageCache = new Map<string, number>();

  const countSingleMessage = (message: ModelMessage): number => {
    const hash = hashMessage(message);

    // Check cache
    const cached = messageCache.get(hash);
    if (cached !== undefined) {
      return cached;
    }

    let total = messageOverhead;

    if (typeof message.content === "string") {
      total += countFn(message.content);
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if ("text" in part && typeof part.text === "string") {
          total += countFn(part.text);
        } else if ("toolName" in part) {
          total += countFn(part.toolName);
          if ("args" in part) {
            total += countFn(JSON.stringify(part.args));
          }
          if ("input" in part) {
            total += countFn(JSON.stringify(part.input));
          }
        } else if ("result" in part || "output" in part) {
          const output = "result" in part ? part.result : part.output;
          total += countFn(typeof output === "string" ? output : JSON.stringify(output));
        } else if ("image" in part) {
          // Image part - count ~1000 tokens for image (approximate vision model cost)
          // Images are expensive in terms of tokens, varies by size and model
          total += 1000;
        } else if ("data" in part && part.type === "file") {
          // File part - count as ~500 tokens per file (placeholder)
          // Actual token count depends on file size and content
          total += 500;
        }
      }
    }

    // Store in cache
    messageCache.set(hash, total);

    return total;
  };

  const countMessages = (messages: ModelMessage[]): number => {
    let total = 0;
    for (const message of messages) {
      total += countSingleMessage(message);
    }
    return total;
  };

  const invalidateCache = (): void => {
    messageCache.clear();
  };

  return { count: countFn, countMessages, invalidateCache };
}

// =============================================================================
// Token Budget
// =============================================================================

/**
 * Token budget tracking for context management.
 *
 * @category Context
 */
export interface TokenBudget {
  /** Maximum tokens allowed in context */
  maxTokens: number;

  /** Current token count in context */
  currentTokens: number;

  /** Usage percentage (0-1) */
  usage: number;

  /** Remaining tokens available */
  remaining: number;

  /**
   * Whether this budget is based on actual usage from the model.
   * True if updated with real usage data, false if estimated.
   */
  isActual?: boolean;
}

/**
 * Creates a token budget from current usage.
 *
 * @param maxTokens - Maximum tokens allowed
 * @param currentTokens - Current token count
 * @param isActual - Whether this is based on actual model usage (default: false)
 * @returns A token budget object
 *
 * @category Context
 */
export function createTokenBudget(
  maxTokens: number,
  currentTokens: number,
  isActual = false,
): TokenBudget {
  return {
    maxTokens,
    currentTokens,
    usage: currentTokens / maxTokens,
    remaining: Math.max(0, maxTokens - currentTokens),
    isActual,
  };
}

// =============================================================================
// Compaction Policy
// =============================================================================

/**
 * Compaction trigger reason.
 *
 * @category Context
 */
export type CompactionTrigger =
  | "token_threshold" // Token usage exceeded threshold
  | "hard_cap" // Token count approaching hard limit
  | "growth_rate" // Growth rate suggests next call will exceed cap
  | "error_fallback"; // Triggered by context length error

/**
 * Policy for determining when to trigger context compaction.
 *
 * Provides multi-signal triggering beyond simple threshold checks:
 * - Token usage threshold (default: 80% of max)
 * - Hard cap safety (force compaction at 95% to prevent errors)
 * - Growth rate prediction (preemptive compaction)
 * - Error-triggered fallback (emergency compaction on context errors)
 *
 * @category Context
 */
export interface CompactionPolicy {
  /**
   * Enable compaction (default: true).
   */
  enabled: boolean;

  /**
   * Token usage threshold to trigger compaction (0-1).
   * Compaction occurs when usage >= threshold.
   * @defaultValue 0.8 (80% of max tokens)
   */
  tokenThreshold: number;

  /**
   * Hard cap threshold for safety (0-1).
   * Forces compaction when usage >= hardCapThreshold to prevent errors.
   * @defaultValue 0.95 (95% of max tokens)
   */
  hardCapThreshold: number;

  /**
   * Enable growth rate prediction (default: false).
   * If true, triggers compaction when growth rate suggests next call will exceed threshold.
   */
  enableGrowthRatePrediction: boolean;

  /**
   * Enable error-triggered fallback compaction (default: true).
   * If true, automatically triggers emergency compaction on context length errors.
   */
  enableErrorFallback: boolean;

  /**
   * Custom function to decide if compaction is needed.
   * If provided, overrides default policy logic.
   * @param budget - Current token budget
   * @param messages - Current message history
   * @returns True if compaction should be triggered, and optional trigger reason
   */
  shouldCompact?: (
    budget: TokenBudget,
    messages: ModelMessage[],
  ) => { trigger: boolean; reason?: CompactionTrigger };
}

/**
 * Default compaction policy.
 *
 * @category Context
 */
export const DEFAULT_COMPACTION_POLICY: CompactionPolicy = {
  enabled: true,
  tokenThreshold: 0.8,
  hardCapThreshold: 0.95,
  enableGrowthRatePrediction: false,
  enableErrorFallback: true,
};

// =============================================================================
// Summarization Configuration
// =============================================================================

/**
 * Compaction strategy type.
 *
 * - **rollup**: Summarize older messages into a single summary (default)
 * - **tiered**: Create multiple summary layers (summary of summary)
 * - **structured**: Generate structured summaries with sections (decisions, tasks, etc.)
 *
 * @category Context
 */
export type CompactionStrategy = "rollup" | "tiered" | "structured";

/**
 * Structured summary format with distinct sections.
 * Provides better context organization and parsing.
 *
 * @category Context
 */
export interface StructuredSummary {
  /** Key decisions made in the conversation */
  decisions: string[];

  /** User preferences and requirements */
  preferences: string[];

  /** Current state of tasks or projects */
  currentState: string[];

  /** Open questions or unresolved issues */
  openQuestions: string[];

  /** Important references (files, IDs, URLs, etc.) */
  references: string[];
}

/**
 * Metadata for pinned messages that should always be kept.
 *
 * @category Context
 */
export interface PinnedMessageMetadata {
  /** Index of the pinned message */
  messageIndex: number;

  /** Reason this message is pinned */
  reason: string;

  /** Timestamp when pinned */
  pinnedAt: number;
}

/**
 * Configuration for automatic context summarization.
 *
 * @category Context
 */
export interface SummarizationConfig {
  /**
   * Number of recent messages to always keep uncompacted.
   * These messages are preserved to maintain recent context.
   * @defaultValue 10
   */
  keepMessageCount: number;

  /**
   * Number of recent tool results to preserve.
   * Tool results are often referenced, so keep some recent ones.
   * @defaultValue 5
   */
  keepToolResultCount: number;

  /**
   * Custom summarization prompt.
   * If not provided, a default prompt is used.
   */
  summaryPrompt?: string;

  /**
   * Compaction strategy to use.
   * @defaultValue "rollup"
   */
  strategy?: CompactionStrategy;

  /**
   * Enable tiered summaries (requires strategy: "tiered").
   * When enabled, creates multiple summary layers over time.
   * @defaultValue false
   */
  enableTieredSummaries?: boolean;

  /**
   * Maximum number of summary tiers (for tiered strategy).
   * @defaultValue 3
   */
  maxSummaryTiers?: number;

  /**
   * Messages per tier (for tiered strategy).
   * Each tier summarizes this many previous summaries.
   * @defaultValue 5
   */
  messagesPerTier?: number;

  /**
   * Enable structured summary format.
   * When true, generates summaries with distinct sections.
   * @defaultValue false
   */
  enableStructuredSummary?: boolean;
}

/**
 * Default summarization configuration.
 *
 * @category Context
 */
export const DEFAULT_SUMMARIZATION_CONFIG: SummarizationConfig = {
  keepMessageCount: 10,
  keepToolResultCount: 5,
  strategy: "rollup",
  enableTieredSummaries: false,
  maxSummaryTiers: 3,
  messagesPerTier: 5,
  enableStructuredSummary: false,
};

// =============================================================================
// Compaction Result
// =============================================================================

/**
 * Result from a context compaction operation.
 *
 * @category Context
 */
export interface CompactionResult {
  /** Number of messages before compaction */
  messagesBefore: number;

  /** Number of messages after compaction */
  messagesAfter: number;

  /** Token count before compaction */
  tokensBefore: number;

  /** Token count after compaction */
  tokensAfter: number;

  /** The generated summary of compacted content */
  summary: string;

  /** Messages that were compacted */
  compactedMessages: ModelMessage[];

  /** New message history after compaction */
  newMessages: ModelMessage[];

  /** Reason compaction was triggered */
  trigger: CompactionTrigger;

  /** Strategy used for compaction */
  strategy?: CompactionStrategy;

  /** Structured summary (if structured format enabled) */
  structuredSummary?: StructuredSummary;

  /** Summary tier level (for tiered summaries) */
  summaryTier?: number;
}

// =============================================================================
// Compaction Scheduler
// =============================================================================

/**
 * Status of a background compaction task.
 *
 * @category Context
 */
export type CompactionTaskStatus = "pending" | "running" | "completed" | "failed";

/**
 * A background compaction task.
 *
 * @category Context
 */
export interface CompactionTask {
  /** Unique identifier for this task */
  id: string;

  /** Current status */
  status: CompactionTaskStatus;

  /** Messages to compact */
  messages: ModelMessage[];

  /** Timestamp when task was created */
  createdAt: number;

  /** Timestamp when task started (if running) */
  startedAt?: number;

  /** Timestamp when task completed (if done) */
  completedAt?: number;

  /** Compaction result (if completed) */
  result?: CompactionResult;

  /** Error (if failed) */
  error?: Error;

  /** Reason compaction was triggered */
  trigger: CompactionTrigger;
}

/**
 * Options for creating a compaction scheduler.
 *
 * @category Context
 */
export interface CompactionSchedulerOptions {
  /**
   * Enable background compaction (default: false).
   * When enabled, compaction runs asynchronously after generation completes.
   */
  enableBackgroundCompaction?: boolean;

  /**
   * Debounce delay in milliseconds (default: 5000).
   * Prevents multiple compactions from running in rapid succession.
   */
  debounceDelayMs?: number;

  /**
   * Maximum pending tasks before dropping oldest (default: 3).
   * Prevents unbounded queue growth.
   */
  maxPendingTasks?: number;

  /**
   * Callback when a compaction task completes.
   */
  onTaskComplete?: (task: CompactionTask) => void;

  /**
   * Callback when a compaction task fails.
   */
  onTaskError?: (task: CompactionTask) => void;
}

/**
 * Scheduler for managing background compaction tasks.
 *
 * Provides:
 * - Debouncing to avoid rapid consecutive compactions
 * - Background task queue with configurable depth
 * - Task status tracking
 * - Automatic cleanup of completed tasks
 *
 * @category Context
 */
export interface CompactionScheduler {
  /**
   * Schedule a compaction task.
   * @param messages - Messages to compact
   * @param agent - Agent to use for summarization
   * @param trigger - Reason compaction was triggered
   * @returns Task ID
   */
  schedule(messages: ModelMessage[], agent: Agent, trigger: CompactionTrigger): string;

  /**
   * Get a task by ID.
   * @param id - Task ID
   * @returns The task, or undefined if not found
   */
  getTask(id: string): CompactionTask | undefined;

  /**
   * Get all pending tasks.
   * @returns Array of pending tasks
   */
  getPendingTasks(): CompactionTask[];

  /**
   * Get the most recent completed task result.
   * This can be applied to the next generation if available.
   * @returns The most recent completed result, or undefined
   */
  getLatestResult(): CompactionResult | undefined;

  /**
   * Cancel a pending task.
   * @param id - Task ID
   * @returns True if task was cancelled
   */
  cancel(id: string): boolean;

  /**
   * Clear all completed and failed tasks from history.
   */
  cleanup(): void;

  /**
   * Shutdown the scheduler and cancel all pending tasks.
   */
  shutdown(): void;
}

/**
 * Creates a compaction scheduler for managing background compaction tasks.
 *
 * @param contextManager - The context manager to use for compaction
 * @param options - Scheduler configuration options
 * @returns A compaction scheduler instance
 *
 * @example
 * ```typescript
 * const scheduler = createCompactionScheduler(contextManager, {
 *   enableBackgroundCompaction: true,
 *   debounceDelayMs: 5000,
 *   onTaskComplete: (task) => {
 *     console.log(`Compaction saved ${task.result?.tokensBefore - task.result?.tokensAfter} tokens`);
 *   },
 * });
 *
 * // Schedule a compaction
 * const taskId = scheduler.schedule(messages, agent, "token_threshold");
 *
 * // Later, get the result
 * const result = scheduler.getLatestResult();
 * if (result) {
 *   messages = result.newMessages;
 * }
 * ```
 *
 * @category Context
 */
export function createCompactionScheduler(
  contextManager: ContextManager,
  options: CompactionSchedulerOptions = {},
): CompactionScheduler {
  const {
    enableBackgroundCompaction = false,
    debounceDelayMs = 5000,
    maxPendingTasks = 3,
    onTaskComplete,
    onTaskError,
  } = options;

  const tasks = new Map<string, CompactionTask>();
  const taskAgents = new Map<string, Agent>(); // Store agents for each task
  let taskIdCounter = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isShutdown = false;

  const schedule = (messages: ModelMessage[], agent: Agent, trigger: CompactionTrigger): string => {
    if (isShutdown) {
      throw new Error("Scheduler has been shut down");
    }

    if (!enableBackgroundCompaction) {
      // When background compaction is disabled, return a placeholder ID
      // The caller should handle compaction synchronously
      return `sync-${Date.now()}`;
    }

    const taskId = `task-${++taskIdCounter}`;
    const task: CompactionTask = {
      id: taskId,
      status: "pending",
      messages: [...messages], // Clone to avoid mutation
      createdAt: Date.now(),
      trigger,
    };

    // Enforce max pending tasks - drop oldest pending task
    const pendingTasks = Array.from(tasks.values())
      .filter((t) => t.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt);

    if (pendingTasks.length >= maxPendingTasks) {
      const oldestTask = pendingTasks[0];
      if (oldestTask) {
        tasks.delete(oldestTask.id);
      }
    }

    tasks.set(taskId, task);
    taskAgents.set(taskId, agent); // Store agent for this task

    // Debounce execution
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      executeNextTask();
      debounceTimer = null;
    }, debounceDelayMs);

    return taskId;
  };

  const executeNextTask = async (): Promise<void> => {
    if (isShutdown) {
      return;
    }

    // Find the oldest pending task
    const pendingTask = Array.from(tasks.values())
      .filter((t) => t.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt)[0];

    if (!pendingTask) {
      return;
    }

    // Get the agent for this task
    const agent = taskAgents.get(pendingTask.id);
    if (!agent) {
      // This shouldn't happen, but handle gracefully
      pendingTask.status = "failed";
      pendingTask.completedAt = Date.now();
      pendingTask.error = new Error("Agent not found for task");
      onTaskError?.(pendingTask);
      return;
    }

    // Mark as running
    pendingTask.status = "running";
    pendingTask.startedAt = Date.now();

    try {
      // Execute compaction
      const result = await contextManager.compact(pendingTask.messages, agent, pendingTask.trigger);

      // Mark as completed
      pendingTask.status = "completed";
      pendingTask.completedAt = Date.now();
      pendingTask.result = result;

      onTaskComplete?.(pendingTask);
    } catch (error) {
      // Mark as failed
      pendingTask.status = "failed";
      pendingTask.completedAt = Date.now();
      pendingTask.error = error instanceof Error ? error : new Error(String(error));

      onTaskError?.(pendingTask);
    }

    // Execute next task if any
    const hasMorePending = Array.from(tasks.values()).some((t) => t.status === "pending");
    if (hasMorePending) {
      // Schedule next task with debounce
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        executeNextTask();
        debounceTimer = null;
      }, debounceDelayMs);
    }
  };

  const getTask = (id: string): CompactionTask | undefined => {
    return tasks.get(id);
  };

  const getPendingTasks = (): CompactionTask[] => {
    return Array.from(tasks.values())
      .filter((t) => t.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt);
  };

  const getLatestResult = (): CompactionResult | undefined => {
    // Find the most recent completed task
    const completedTasks = Array.from(tasks.values())
      .filter((t) => t.status === "completed" && t.result)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

    return completedTasks[0]?.result;
  };

  const cancel = (id: string): boolean => {
    const task = tasks.get(id);
    if (!task || task.status !== "pending") {
      return false;
    }

    tasks.delete(id);
    taskAgents.delete(id); // Clean up agent reference
    return true;
  };

  const cleanup = (): void => {
    // Remove completed and failed tasks
    for (const [id, task] of tasks.entries()) {
      if (task.status === "completed" || task.status === "failed") {
        tasks.delete(id);
        taskAgents.delete(id); // Clean up agent reference
      }
    }
  };

  const shutdown = (): void => {
    isShutdown = true;

    // Clear debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Cancel all pending tasks
    for (const [_id, task] of tasks.entries()) {
      if (task.status === "pending") {
        task.status = "failed";
        task.error = new Error("Scheduler shut down");
        task.completedAt = Date.now();
      }
    }
  };

  return {
    schedule,
    getTask,
    getPendingTasks,
    getLatestResult,
    cancel,
    cleanup,
    shutdown,
  };
}

// =============================================================================
// Context Manager
// =============================================================================

/**
 * Options for creating a context manager.
 *
 * @category Context
 */
export interface ContextManagerOptions {
  /** Maximum tokens allowed in context */
  maxTokens: number;

  /** Token counter to use (default: approximate counter) */
  tokenCounter?: TokenCounter;

  /** Compaction policy configuration */
  policy?: Partial<CompactionPolicy>;

  /** Summarization configuration */
  summarization?: Partial<SummarizationConfig>;

  /** Model to use for summarization (if different from agent model) */
  summarizationModel?: LanguageModel;

  /** Scheduler configuration for background compaction */
  scheduler?: CompactionSchedulerOptions;

  /**
   * Callback when context budget is updated.
   * Useful for emitting events or updating UI.
   */
  onBudgetUpdate?: (budget: TokenBudget) => void;

  /**
   * Callback when compaction occurs.
   * Useful for logging or emitting events.
   */
  onCompact?: (result: CompactionResult) => void;
}

/**
 * Manages conversation context with token tracking and auto-compaction.
 *
 * @category Context
 */
export interface ContextManager {
  /** Current token counter */
  readonly tokenCounter: TokenCounter;

  /** Current compaction policy */
  readonly policy: CompactionPolicy;

  /** Current summarization config */
  readonly summarizationConfig: SummarizationConfig;

  /** Maximum tokens allowed */
  readonly maxTokens: number;

  /** Compaction scheduler (if background compaction is enabled) */
  readonly scheduler?: CompactionScheduler;

  /** Pinned messages that should always be kept */
  readonly pinnedMessages: PinnedMessageMetadata[];

  /**
   * Get the current token budget.
   * @param messages - Current message history
   * @returns The token budget
   */
  getBudget(messages: ModelMessage[]): TokenBudget;

  /**
   * Check if compaction is needed based on current token usage.
   * @param messages - Current message history
   * @returns Object with trigger status and optional reason
   */
  shouldCompact(messages: ModelMessage[]): {
    trigger: boolean;
    reason?: CompactionTrigger;
  };

  /**
   * Compact the message history by summarizing older messages.
   * @param messages - Current message history
   * @param agent - Agent to use for summarization
   * @param trigger - Reason compaction was triggered (default: "token_threshold")
   * @returns Compaction result with new message history
   */
  compact(
    messages: ModelMessage[],
    agent: Agent,
    trigger?: CompactionTrigger,
  ): Promise<CompactionResult>;

  /**
   * Process messages, automatically compacting if needed.
   * @param messages - Current message history
   * @param agent - Agent to use for summarization
   * @returns The processed messages (may be compacted)
   */
  process(messages: ModelMessage[], agent: Agent): Promise<ModelMessage[]>;

  /**
   * Update token tracking with actual usage from a model response.
   * This provides more accurate token counts than estimation.
   *
   * @param usage - Token usage from the model response (AI SDK v6 format)
   * @param usage.inputTokens - Tokens used in the input/prompt
   * @param usage.outputTokens - Tokens used in the output/completion
   * @param usage.totalTokens - Total tokens used
   */
  updateUsage?(usage: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
  }): void;

  /**
   * Pin a message to prevent it from being compacted.
   * Pinned messages are always kept in the conversation history.
   *
   * @param messageIndex - Index of the message to pin
   * @param reason - Reason for pinning this message
   */
  pinMessage(messageIndex: number, reason: string): void;

  /**
   * Unpin a message.
   * @param messageIndex - Index of the message to unpin
   */
  unpinMessage(messageIndex: number): void;

  /**
   * Check if a message is pinned.
   * @param messageIndex - Index of the message to check
   * @returns True if the message is pinned
   */
  isPinned(messageIndex: number): boolean;
}

/**
 * Default prompt for generating conversation summaries.
 */
const DEFAULT_SUMMARY_PROMPT = `You are summarizing a conversation for context management. Create a concise summary that:

1. Preserves key decisions, facts, and user preferences
2. Maintains important technical details and code references
3. Notes any pending tasks or unresolved questions
4. Captures references to images, files, and media (e.g., "discussed screenshot of X", "analyzed document Y")
5. Uses bullet points for clarity
6. Is approximately 200-500 words

Do not include:
- Pleasantries or greetings
- Redundant information
- Tool call details (just outcomes)
- Verbose explanations
- Full image/file contents (just references and context)

Format:
## Conversation Summary
[Your summary here]`;

/**
 * Prompt for generating structured summaries with sections.
 */
const STRUCTURED_SUMMARY_PROMPT = `You are summarizing a conversation for context management. Generate a structured summary in JSON format with the following sections:

{
  "decisions": ["Key decision 1", "Key decision 2", ...],
  "preferences": ["User preference 1", "User preference 2", ...],
  "currentState": ["Current state fact 1", "Current state fact 2", ...],
  "openQuestions": ["Unresolved question 1", "Unresolved question 2", ...],
  "references": ["file.ts:123", "userId: abc123", "URL: https://...", "Image: screenshot.png showing X", "File: document.pdf containing Y", ...]
}

Guidelines:
- **decisions**: Important choices made (architecture, approach, tools)
- **preferences**: User requirements, constraints, style preferences
- **currentState**: What's been implemented, current progress, known issues
- **openQuestions**: Unresolved issues, pending decisions, items to revisit
- **references**: File paths, identifiers, URLs, config values, images, documents that may be needed later

Keep each item concise (1-2 sentences). Focus on information that will be useful for continuing the conversation.
For images and files, include what they contained or depicted, not just that they were present.
Respond ONLY with valid JSON, no additional text.`;

/**
 * Prompt for generating tiered summaries (summary of summaries).
 */
const TIERED_SUMMARY_PROMPT = `You are creating a higher-level summary from multiple conversation summaries. Consolidate the key information from these summaries:

Guidelines:
1. Merge related decisions and facts
2. Preserve the most important details
3. Remove redundancy across summaries
4. Maintain chronological context where relevant
5. Keep the summary concise but comprehensive

Format:
## Tiered Summary (Level {tier})
[Your consolidated summary here]`;

/**
 * Creates a context manager for tracking and managing conversation context.
 *
 * @param options - Configuration options
 * @returns A context manager instance
 *
 * @example
 * ```typescript
 * const contextManager = createContextManager({
 *   maxTokens: 100000,
 *   summarization: {
 *     tokenThreshold: 0.75,
 *     keepMessageCount: 15,
 *   },
 *   onBudgetUpdate: (budget) => {
 *     console.log(`Context usage: ${(budget.usage * 100).toFixed(1)}%`);
 *   },
 * });
 *
 * // Check budget
 * const budget = contextManager.getBudget(messages);
 *
 * // Process messages (auto-compacts if needed)
 * const processedMessages = await contextManager.process(messages, agent);
 * ```
 *
 * @category Context
 */
export function createContextManager(options: ContextManagerOptions): ContextManager {
  const tokenCounter = options.tokenCounter ?? createApproximateTokenCounter();
  const policy: CompactionPolicy = {
    ...DEFAULT_COMPACTION_POLICY,
    ...options.policy,
  };
  const summarizationConfig: SummarizationConfig = {
    ...DEFAULT_SUMMARIZATION_CONFIG,
    ...options.summarization,
  };
  const { maxTokens, onBudgetUpdate, onCompact } = options;

  // Track actual usage from model responses
  let lastActualUsage: { inputTokens: number | undefined; totalTokens: number | undefined } | null =
    null;

  // Track pinned messages
  const pinnedMessages: PinnedMessageMetadata[] = [];

  // Track summary tiers for tiered strategy
  let currentSummaryTier = 0;

  // Create scheduler if background compaction is enabled
  let scheduler: CompactionScheduler | undefined;
  if (options.scheduler?.enableBackgroundCompaction) {
    // We'll create the scheduler after defining the manager, to avoid circular dependency
    // For now, set it to undefined and assign it later
    scheduler = undefined;
  }

  const getBudget = (messages: ModelMessage[]): TokenBudget => {
    let currentTokens: number;
    let isActual = false;

    // If we have actual usage data from the last generation, use it
    if (lastActualUsage && lastActualUsage.totalTokens !== undefined) {
      currentTokens = lastActualUsage.totalTokens;
      isActual = true;
    } else {
      // Fall back to estimation
      currentTokens = tokenCounter.countMessages(messages);
    }

    const budget = createTokenBudget(maxTokens, currentTokens, isActual);
    onBudgetUpdate?.(budget);
    return budget;
  };

  const shouldCompact = (
    messages: ModelMessage[],
  ): { trigger: boolean; reason?: CompactionTrigger } => {
    if (!policy.enabled) {
      return { trigger: false };
    }

    const budget = getBudget(messages);

    // Custom policy override
    if (policy.shouldCompact) {
      return policy.shouldCompact(budget, messages);
    }

    // Hard cap safety - force compaction at 95% to prevent errors
    if (budget.usage >= policy.hardCapThreshold) {
      return { trigger: true, reason: "hard_cap" };
    }

    // Standard token threshold
    if (budget.usage >= policy.tokenThreshold) {
      return { trigger: true, reason: "token_threshold" };
    }

    // Growth rate prediction (simplified version)
    if (policy.enableGrowthRatePrediction && messages.length >= 2) {
      // Estimate growth: if last message was large relative to average
      const lastMessage = messages[messages.length - 1];
      if (lastMessage) {
        const lastMessageTokens = tokenCounter.countMessages([lastMessage]);
        const avgMessageTokens = budget.currentTokens / messages.length;

        // If last message is significantly larger than average, predict growth
        if (lastMessageTokens > avgMessageTokens * 2) {
          const predictedNext = budget.currentTokens + lastMessageTokens;
          const predictedUsage = predictedNext / maxTokens;

          if (predictedUsage >= policy.tokenThreshold) {
            return { trigger: true, reason: "growth_rate" };
          }
        }
      }
    }

    return { trigger: false };
  };

  const compact = async (
    messages: ModelMessage[],
    agent: Agent,
    trigger: CompactionTrigger = "token_threshold",
  ): Promise<CompactionResult> => {
    const tokensBefore = tokenCounter.countMessages(messages);
    const messagesBefore = messages.length;

    const {
      keepMessageCount,
      strategy = "rollup",
      enableStructuredSummary,
      enableTieredSummaries,
    } = summarizationConfig;

    // Always keep system messages
    const systemMessages = messages.filter((m) => m.role === "system");
    const _nonSystemMessages = messages.filter((m) => m.role !== "system");

    // Filter out pinned messages (keep them separate)
    // pinnedMessages indices refer to the original messages array
    const pinnedIndices = new Set(pinnedMessages.map((p) => p.messageIndex));
    const pinnedMessagesArray: ModelMessage[] = [];
    const unpinnedMessages: ModelMessage[] = [];

    messages.forEach((msg, idx) => {
      // Skip system messages (already handled)
      if (msg.role === "system") return;

      if (pinnedIndices.has(idx)) {
        pinnedMessagesArray.push(msg);
      } else {
        unpinnedMessages.push(msg);
      }
    });

    // Keep recent messages from unpinned messages
    const recentMessages = unpinnedMessages.slice(-keepMessageCount);
    const oldMessages = unpinnedMessages.slice(
      0,
      Math.max(0, unpinnedMessages.length - keepMessageCount),
    );

    // If nothing to compact, return unchanged
    if (oldMessages.length === 0) {
      return {
        messagesBefore,
        messagesAfter: messages.length,
        tokensBefore,
        tokensAfter: tokensBefore,
        summary: "",
        compactedMessages: [],
        newMessages: messages,
        trigger,
        strategy,
      };
    }

    // Execute strategy-specific compaction
    let summary: string;
    let structuredSummary: StructuredSummary | undefined;
    let summaryTier: number | undefined;

    if (strategy === "tiered" && enableTieredSummaries) {
      // Tiered strategy: check if we have existing summaries to tier
      const existingSummaries = messages.filter(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          m.content.includes("[Previous conversation summary]"),
      );

      if (existingSummaries.length >= (summarizationConfig.messagesPerTier ?? 5)) {
        // Create a higher-tier summary
        currentSummaryTier++;
        const summariesContent = existingSummaries.map((m) => m.content).join("\n\n");
        const tierPrompt = TIERED_SUMMARY_PROMPT.replace("{tier}", String(currentSummaryTier));

        const summaryResult = await agent.generate({
          messages: [
            { role: "system" as const, content: tierPrompt },
            {
              role: "user" as const,
              content: `Consolidate these summaries:\n\n${summariesContent}`,
            },
          ],
          maxTokens: 1000,
          _skipCompaction: true, // Prevent recursive compaction during summary generation
        });

        summary = summaryResult.status === "complete" ? summaryResult.text : "";
        summaryTier = currentSummaryTier;
      } else {
        // Create a first-tier summary
        const contentToSummarize = formatMessagesForSummary(oldMessages);
        const summaryPrompt = enableStructuredSummary
          ? STRUCTURED_SUMMARY_PROMPT
          : (summarizationConfig.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT);

        const summaryResult = await agent.generate({
          messages: [
            { role: "system" as const, content: summaryPrompt },
            {
              role: "user" as const,
              content: `Please summarize this conversation history:\n\n${contentToSummarize}`,
            },
          ],
          maxTokens: 1000,
          _skipCompaction: true, // Prevent recursive compaction during summary generation
        });

        summary = summaryResult.status === "complete" ? summaryResult.text : "";
        summaryTier = 0;

        // Try to parse structured summary if enabled
        if (enableStructuredSummary) {
          try {
            structuredSummary = JSON.parse(summary) as StructuredSummary;
          } catch {
            // If parsing fails, keep as plain text
          }
        }
      }
    } else if (strategy === "structured" || enableStructuredSummary) {
      // Structured strategy: generate JSON with sections
      const contentToSummarize = formatMessagesForSummary(oldMessages);

      const summaryResult = await agent.generate({
        messages: [
          { role: "system" as const, content: STRUCTURED_SUMMARY_PROMPT },
          {
            role: "user" as const,
            content: `Please summarize this conversation history:\n\n${contentToSummarize}`,
          },
        ],
        maxTokens: 1000,
        _skipCompaction: true, // Prevent recursive compaction during summary generation
      });

      summary = summaryResult.status === "complete" ? summaryResult.text : "";

      // Try to parse structured summary
      try {
        structuredSummary = JSON.parse(summary) as StructuredSummary;
      } catch {
        // If parsing fails, keep as plain text
      }
    } else {
      // Rollup strategy (default): single summary of old messages
      const contentToSummarize = formatMessagesForSummary(oldMessages);
      const summaryPrompt = summarizationConfig.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT;

      const summaryResult = await agent.generate({
        messages: [
          { role: "system" as const, content: summaryPrompt },
          {
            role: "user" as const,
            content: `Please summarize this conversation history:\n\n${contentToSummarize}`,
          },
        ],
        maxTokens: 1000,
        _skipCompaction: true, // Prevent recursive compaction during summary generation
      });

      summary = summaryResult.status === "complete" ? summaryResult.text : "";
    }

    // Build new message history
    const summaryPrefix =
      summaryTier !== undefined
        ? `[Previous conversation summary - Tier ${summaryTier}]`
        : "[Previous conversation summary]";

    const summaryMessage: ModelMessage = {
      role: "assistant" as const,
      content: structuredSummary
        ? `${summaryPrefix}\n\n${formatStructuredSummary(structuredSummary)}`
        : `${summaryPrefix}\n\n${summary}`,
    };

    const newMessages: ModelMessage[] = [
      ...systemMessages,
      summaryMessage,
      ...pinnedMessagesArray, // Include pinned messages
      ...recentMessages,
    ];

    const tokensAfter = tokenCounter.countMessages(newMessages);

    const result: CompactionResult = {
      messagesBefore,
      messagesAfter: newMessages.length,
      tokensBefore,
      tokensAfter,
      summary,
      compactedMessages: oldMessages,
      newMessages,
      trigger,
      strategy,
      structuredSummary,
      summaryTier,
    };

    onCompact?.(result);

    return result;
  };

  const process = async (messages: ModelMessage[], agent: Agent): Promise<ModelMessage[]> => {
    const { trigger, reason } = shouldCompact(messages);

    if (trigger && reason) {
      // If background compaction is enabled and scheduler exists
      if (scheduler && options.scheduler?.enableBackgroundCompaction) {
        // Check if there's a pending result from a previous background compaction
        const latestResult = scheduler.getLatestResult();

        if (latestResult) {
          // Apply the background compaction result
          scheduler.cleanup(); // Clean up old completed tasks
          return latestResult.newMessages;
        }

        // Schedule a new background compaction for next time
        scheduler.schedule(messages, agent, reason);

        // Return original messages (compaction will happen in background)
        return messages;
      } else {
        // Synchronous compaction (blocking)
        const result = await compact(messages, agent, reason);
        return result.newMessages;
      }
    }

    return messages;
  };

  const updateUsage = (usage: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
  }): void => {
    // Store actual usage for next budget calculation
    // Only store if totalTokens is defined
    if (usage.totalTokens !== undefined) {
      lastActualUsage = {
        inputTokens: usage.inputTokens,
        totalTokens: usage.totalTokens,
      };
    }
  };

  const pinMessage = (messageIndex: number, reason: string): void => {
    // Check if already pinned
    if (pinnedMessages.some((p) => p.messageIndex === messageIndex)) {
      return;
    }

    pinnedMessages.push({
      messageIndex,
      reason,
      pinnedAt: Date.now(),
    });
  };

  const unpinMessage = (messageIndex: number): void => {
    const index = pinnedMessages.findIndex((p) => p.messageIndex === messageIndex);
    if (index !== -1) {
      pinnedMessages.splice(index, 1);
    }
  };

  const isPinned = (messageIndex: number): boolean => {
    return pinnedMessages.some((p) => p.messageIndex === messageIndex);
  };

  // Create the manager object (needed for scheduler creation)
  const manager: ContextManager = {
    tokenCounter,
    policy,
    summarizationConfig,
    maxTokens,
    scheduler: undefined, // Will be set below if needed
    pinnedMessages,
    getBudget,
    shouldCompact,
    compact,
    process,
    updateUsage,
    pinMessage,
    unpinMessage,
    isPinned,
  };

  // Create scheduler after manager is defined (to pass to createCompactionScheduler)
  if (options.scheduler?.enableBackgroundCompaction) {
    scheduler = createCompactionScheduler(manager, options.scheduler);
    (manager as { scheduler?: CompactionScheduler }).scheduler = scheduler;
  }

  return manager;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Formats messages into a string suitable for summarization.
 *
 * @param messages - Messages to format
 * @returns Formatted string representation
 */
/**
 * Helper function to extract metadata from image parts for summarization.
 */
function extractImageMetadata(part: { type: "image"; image: unknown }): string {
  const image = part.image;

  // Handle URL case
  if (typeof image === "object" && image !== null && "toString" in image) {
    const url = image.toString();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return `[Image: ${url}]`;
    }
  }

  // Handle data content case (base64, Buffer, etc.)
  if (typeof image === "string") {
    // Check if it's a data URL
    if (image.startsWith("data:")) {
      const mimeMatch = image.match(/^data:([^;,]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : "unknown";
      return `[Image: ${mimeType}, base64 data]`;
    }
  }

  return "[Image: embedded data]";
}

/**
 * Helper function to extract metadata from file parts for summarization.
 */
function extractFileMetadata(part: { type: "file"; data: unknown; mimeType?: string }): string {
  const mimeType = part.mimeType ?? "unknown";

  // Handle URL case
  const data = part.data;
  if (typeof data === "object" && data !== null && "toString" in data) {
    const url = data.toString();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return `[File: ${mimeType}, URL: ${url}]`;
    }
  }

  // Handle data content case
  return `[File: ${mimeType}, embedded data]`;
}

function formatMessagesForSummary(messages: ModelMessage[]): string {
  const lines: string[] = [];

  for (const message of messages) {
    const role = message.role.toUpperCase();

    if (typeof message.content === "string") {
      lines.push(`${role}: ${message.content}`);
    } else if (Array.isArray(message.content)) {
      const parts: string[] = [];
      for (const part of message.content) {
        if ("text" in part && typeof part.text === "string") {
          parts.push(part.text);
        } else if ("toolName" in part) {
          parts.push(`[Tool call: ${part.toolName}]`);
        } else if ("result" in part || "output" in part) {
          const output = "result" in part ? part.result : part.output;
          const outputStr =
            typeof output === "string"
              ? output.slice(0, 200)
              : JSON.stringify(output).slice(0, 200);
          parts.push(`[Tool result: ${outputStr}...]`);
        } else if ("image" in part && part.type === "image") {
          parts.push(extractImageMetadata(part as { type: "image"; image: unknown }));
        } else if ("data" in part && part.type === "file") {
          parts.push(
            extractFileMetadata(part as { type: "file"; data: unknown; mimeType?: string }),
          );
        }
      }
      if (parts.length > 0) {
        lines.push(`${role}: ${parts.join("\n")}`);
      }
    }
  }

  return lines.join("\n\n");
}

/**
 * Extracts tool results from messages.
 *
 * @param messages - Messages to search
 * @returns Array of tool results with their context
 */
export function extractToolResults(messages: ModelMessage[]): Array<{
  toolName: string;
  output: unknown;
  messageIndex: number;
}> {
  const results: Array<{
    toolName: string;
    output: unknown;
    messageIndex: number;
  }> = [];

  messages.forEach((message, index) => {
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if ("result" in part || "output" in part) {
          results.push({
            toolName: "toolName" in part ? String(part.toolName) : "unknown",
            output: "result" in part ? part.result : part.output,
            messageIndex: index,
          });
        }
      }
    }
  });

  return results;
}

/**
 * Finds the last user message in the conversation.
 *
 * @param messages - Messages to search
 * @returns The last user message content, or undefined
 */
export function findLastUserMessage(messages: ModelMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    if (message.role === "user") {
      if (typeof message.content === "string") {
        return message.content;
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if ("text" in part && typeof part.text === "string") {
            return part.text;
          }
        }
      }
    }
  }
  return undefined;
}

/**
 * Counts messages by role.
 *
 * @param messages - Messages to count
 * @returns Object with counts per role
 */
export function countMessagesByRole(messages: ModelMessage[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const message of messages) {
    counts[message.role] = (counts[message.role] ?? 0) + 1;
  }
  return counts;
}

/**
 * Formats a structured summary into a readable markdown string.
 *
 * @param summary - Structured summary to format
 * @returns Formatted markdown string
 */
function formatStructuredSummary(summary: StructuredSummary): string {
  const sections: string[] = [];

  if (summary.decisions.length > 0) {
    sections.push(`## Decisions\n${summary.decisions.map((d) => `- ${d}`).join("\n")}`);
  }

  if (summary.preferences.length > 0) {
    sections.push(`## Preferences\n${summary.preferences.map((p) => `- ${p}`).join("\n")}`);
  }

  if (summary.currentState.length > 0) {
    sections.push(`## Current State\n${summary.currentState.map((s) => `- ${s}`).join("\n")}`);
  }

  if (summary.openQuestions.length > 0) {
    sections.push(`## Open Questions\n${summary.openQuestions.map((q) => `- ${q}`).join("\n")}`);
  }

  if (summary.references.length > 0) {
    sections.push(`## References\n${summary.references.map((r) => `- ${r}`).join("\n")}`);
  }

  return sections.join("\n\n");
}
