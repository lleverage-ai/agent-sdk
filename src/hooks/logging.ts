/**
 * Logging hook utilities.
 *
 * Provides logging hooks for observability and debugging using the unified
 * hook system.
 *
 * @packageDocumentation
 */

import type {
  HookCallback,
  PostCompactInput,
  PostGenerateFailureInput,
  PostGenerateInput,
  PostToolUseFailureInput,
  PostToolUseInput,
  PreCompactInput,
  PreGenerateInput,
  PreToolUseInput,
} from "../types.js";

/**
 * Options for creating logging hooks.
 *
 * @category Hooks
 */
export interface LoggingHooksOptions {
  /**
   * Custom logging function.
   * @defaultValue console.log
   */
  log?: (message: string) => void;

  /**
   * Whether to log generation requests.
   * @defaultValue true
   */
  logGeneration?: boolean;

  /**
   * Whether to log tool usage.
   * @defaultValue true
   */
  logTools?: boolean;

  /**
   * Whether to log timing information.
   * @defaultValue true
   */
  logTiming?: boolean;

  /**
   * Whether to log errors.
   * @defaultValue true
   */
  logErrors?: boolean;

  /**
   * Whether to log compaction events.
   * @defaultValue true
   */
  logCompaction?: boolean;

  /**
   * Maximum length for logged text content.
   * @defaultValue 200
   */
  maxTextLength?: number;

  /**
   * Prefix for all log messages.
   * @defaultValue "[Agent]"
   */
  prefix?: string;

  /**
   * Whether to log full message arrays.
   * @defaultValue false (just count)
   */
  logFullMessages?: boolean;
}

/**
 * Truncates text to maximum length with ellipsis.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

/**
 * Formats message count by role.
 */
function formatMessageCount(messages: unknown[] = []): string {
  const byRole: Record<string, number> = {};
  for (const msg of messages) {
    if (typeof msg === "object" && msg !== null && "role" in msg) {
      const role = String((msg as { role: unknown }).role);
      byRole[role] = (byRole[role] ?? 0) + 1;
    }
  }
  return Object.entries(byRole)
    .map(([role, count]) => `${count} ${role}`)
    .join(", ");
}

/**
 * Creates logging hooks for generation lifecycle events.
 *
 * Provides Pre/Post logging for generation with timing information,
 * usage statistics, and error logging.
 *
 * @param options - Configuration options
 * @returns Array of hooks for generation events
 *
 * @example
 * ```typescript
 * const logHooks = createLoggingHooks({
 *   prefix: "[MyAgent]",
 *   logTiming: true,
 *   maxTextLength: 100,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PreGenerate: [{ hooks: [logHooks[0]] }],
 *     PostGenerate: [{ hooks: [logHooks[1]] }],
 *     PostGenerateFailure: [{ hooks: [logHooks[2]] }],
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Custom logger (e.g., structured logging)
 * const logHooks = createLoggingHooks({
 *   log: (msg) => logger.info(msg),
 * });
 * ```
 *
 * @category Hooks
 */
export function createLoggingHooks(options: LoggingHooksOptions = {}): HookCallback[] {
  const {
    log = console.log,
    logGeneration = true,
    logTiming = true,
    maxTextLength = 200,
    prefix = "[Agent]",
    logFullMessages = false,
  } = options;

  const startTimes = new Map<string, number>();

  // PreGenerate: Log request
  const preGenerate: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreGenerate") return {};
    if (!logGeneration) return {};

    const preGenInput = input as PreGenerateInput;
    const { messages, temperature, maxTokens } = preGenInput.options;

    const messageInfo = logFullMessages ? JSON.stringify(messages) : formatMessageCount(messages);

    let logMsg = `${prefix} PreGenerate:`;
    logMsg += `\n  Messages: ${messageInfo}`;
    if (temperature !== undefined) logMsg += `\n  Temperature: ${temperature}`;
    if (maxTokens !== undefined) logMsg += `\n  MaxTokens: ${maxTokens}`;

    log(logMsg);

    // Track start time for this session
    if (logTiming) {
      startTimes.set(preGenInput.session_id, Date.now());
    }

    return {};
  };

  // PostGenerate: Log response
  const postGenerate: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostGenerate") return {};
    if (!logGeneration) return {};

    const postGenInput = input as PostGenerateInput;
    const { result } = postGenInput;

    let logMsg = `${prefix} PostGenerate:`;
    logMsg += `\n  Text: ${truncate(result.text || "", maxTextLength)}`;
    logMsg += `\n  Finish: ${result.finishReason}`;

    if (result.usage) {
      logMsg += `\n  Tokens: ${result.usage.totalTokens} (${result.usage.inputTokens} in, ${result.usage.outputTokens} out)`;
    }

    // Add timing if available
    if (logTiming) {
      const startTime = startTimes.get(postGenInput.session_id);
      if (startTime) {
        const duration = Date.now() - startTime;
        logMsg += `\n  Duration: ${duration}ms`;
        startTimes.delete(postGenInput.session_id);
      }
    }

    log(logMsg);

    return {};
  };

  // PostGenerateFailure: Log error
  const postGenerateFailure: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostGenerateFailure") return {};

    const failureInput = input as PostGenerateFailureInput;

    let logMsg = `${prefix} PostGenerateFailure:`;
    logMsg += `\n  Error: ${failureInput.error.message}`;

    // Add timing if available
    if (logTiming) {
      const startTime = startTimes.get(failureInput.session_id);
      if (startTime) {
        const duration = Date.now() - startTime;
        logMsg += `\n  Duration: ${duration}ms (failed)`;
        startTimes.delete(failureInput.session_id);
      }
    }

    log(logMsg);

    return {};
  };

  return [preGenerate, postGenerate, postGenerateFailure];
}

/**
 * Creates logging hooks for tool execution events.
 *
 * Provides Pre/Post logging for tool calls with arguments, results,
 * and error information.
 *
 * @param options - Configuration options
 * @returns Array of hooks for tool events
 *
 * @example
 * ```typescript
 * const toolLogHooks = createToolLoggingHooks({
 *   prefix: "[Tools]",
 *   maxTextLength: 150,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PreToolUse: [{ hooks: [toolLogHooks[0]] }],
 *     PostToolUse: [{ hooks: [toolLogHooks[1]] }],
 *     PostToolUseFailure: [{ hooks: [toolLogHooks[2]] }],
 *   },
 * });
 * ```
 *
 * @category Hooks
 */
export function createToolLoggingHooks(options: LoggingHooksOptions = {}): HookCallback[] {
  const {
    log = console.log,
    logTools = true,
    logTiming = true,
    logErrors = true,
    maxTextLength = 200,
    prefix = "[Agent]",
  } = options;

  const toolStartTimes = new Map<string, number>();

  // PreToolUse: Log tool call
  const preToolUse: HookCallback = async (input, toolUseId) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    if (!logTools) return {};

    const preToolInput = input as PreToolUseInput;

    let logMsg = `${prefix} PreToolUse: ${preToolInput.tool_name}`;
    logMsg += `\n  Input: ${truncate(JSON.stringify(preToolInput.tool_input), maxTextLength)}`;

    log(logMsg);

    // Track start time
    if (logTiming && toolUseId) {
      toolStartTimes.set(toolUseId, Date.now());
    }

    return {};
  };

  // PostToolUse: Log tool result
  const postToolUse: HookCallback = async (input, toolUseId) => {
    if (input.hook_event_name !== "PostToolUse") return {};
    if (!logTools) return {};

    const postToolInput = input as PostToolUseInput;

    let logMsg = `${prefix} PostToolUse: ${postToolInput.tool_name}`;
    logMsg += `\n  Result: ${truncate(String(postToolInput.tool_response), maxTextLength)}`;

    // Add timing if available
    if (logTiming && toolUseId) {
      const startTime = toolStartTimes.get(toolUseId);
      if (startTime) {
        const duration = Date.now() - startTime;
        logMsg += `\n  Duration: ${duration}ms`;
        toolStartTimes.delete(toolUseId);
      }
    }

    log(logMsg);

    return {};
  };

  // PostToolUseFailure: Log tool error
  const postToolUseFailure: HookCallback = async (input, toolUseId) => {
    if (input.hook_event_name !== "PostToolUseFailure") return {};
    if (!logErrors) return {};

    const failureInput = input as PostToolUseFailureInput;

    let logMsg = `${prefix} PostToolUseFailure: ${failureInput.tool_name}`;
    logMsg += `\n  Error: ${failureInput.error}`;

    // Add timing if available
    if (logTiming && toolUseId) {
      const startTime = toolStartTimes.get(toolUseId);
      if (startTime) {
        const duration = Date.now() - startTime;
        logMsg += `\n  Duration: ${duration}ms (failed)`;
        toolStartTimes.delete(toolUseId);
      }
    }

    log(logMsg);

    return {};
  };

  return [preToolUse, postToolUse, postToolUseFailure];
}

/**
 * Creates logging hooks for context compaction events.
 *
 * Provides Pre/Post logging for compaction with token savings
 * and message count information.
 *
 * @param options - Configuration options
 * @returns Array of hooks for compaction events
 *
 * @example
 * ```typescript
 * const compactLogHooks = createCompactionLoggingHooks({
 *   prefix: "[Compaction]",
 * });
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PreCompact: [compactLogHooks[0]],
 *     PostCompact: [compactLogHooks[1]],
 *   },
 * });
 * ```
 *
 * @category Hooks
 */
export function createCompactionLoggingHooks(options: LoggingHooksOptions = {}): HookCallback[] {
  const { log = console.log, logCompaction = true, logTiming = true, prefix = "[Agent]" } = options;

  const compactionStartTimes = new Map<string, number>();

  // PreCompact: Log compaction start
  const preCompact: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreCompact") return {};
    if (!logCompaction) return {};

    const preCompactInput = input as PreCompactInput;

    let logMsg = `${prefix} PreCompact:`;
    logMsg += `\n  Messages: ${preCompactInput.message_count}`;
    logMsg += `\n  Tokens: ${preCompactInput.tokens_before}`;

    log(logMsg);

    // Track start time
    if (logTiming) {
      compactionStartTimes.set(preCompactInput.session_id, Date.now());
    }

    return {};
  };

  // PostCompact: Log compaction result
  const postCompact: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostCompact") return {};
    if (!logCompaction) return {};

    const postCompactInput = input as PostCompactInput;

    const reductionPercent =
      postCompactInput.tokens_before > 0
        ? ((postCompactInput.tokens_saved / postCompactInput.tokens_before) * 100).toFixed(1)
        : "0.0";

    let logMsg = `${prefix} PostCompact:`;
    logMsg += `\n  Messages: ${postCompactInput.messages_before} → ${postCompactInput.messages_after}`;
    logMsg += `\n  Tokens: ${postCompactInput.tokens_before} → ${postCompactInput.tokens_after} (saved ${postCompactInput.tokens_saved}, ${reductionPercent}% reduction)`;

    // Add timing if available
    if (logTiming) {
      const startTime = compactionStartTimes.get(postCompactInput.session_id);
      if (startTime) {
        const duration = Date.now() - startTime;
        logMsg += `\n  Duration: ${duration}ms`;
        compactionStartTimes.delete(postCompactInput.session_id);
      }
    }

    log(logMsg);

    return {};
  };

  return [preCompact, postCompact];
}

/**
 * Creates comprehensive logging hooks for all lifecycle events.
 *
 * Combines generation, tool, and compaction logging into a single set of hooks.
 *
 * @param options - Configuration options
 * @returns Object with hooks for all events
 *
 * @example
 * ```typescript
 * const { generationHooks, toolHooks, compactionHooks } = createComprehensiveLoggingHooks({
 *   prefix: "[MyAgent]",
 *   logTiming: true,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PreGenerate: [generationHooks[0]],
 *     PostGenerate: [generationHooks[1]],
 *     PostGenerateFailure: [generationHooks[2]],
 *     PreToolUse: [toolHooks[0]],
 *     PostToolUse: [toolHooks[1]],
 *     PostToolUseFailure: [toolHooks[2]],
 *     PreCompact: [compactionHooks[0]],
 *     PostCompact: [compactionHooks[1]],
 *   },
 * });
 * ```
 *
 * @category Hooks
 */
export function createComprehensiveLoggingHooks(options: LoggingHooksOptions = {}): {
  generationHooks: HookCallback[];
  toolHooks: HookCallback[];
  compactionHooks: HookCallback[];
} {
  return {
    generationHooks: createLoggingHooks(options),
    toolHooks: createToolLoggingHooks(options),
    compactionHooks: createCompactionLoggingHooks(options),
  };
}
