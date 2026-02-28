/**
 * Logging middleware.
 *
 * Provides middleware for logging agent lifecycle events using the SDK's
 * logging primitives. The middleware is transport-agnostic - users provide
 * their own transport which determines where logs go.
 *
 * @packageDocumentation
 */

import type { LogLevel, LogTransport } from "../observability/logger.js";
import { createLogger } from "../observability/logger.js";
import type {
  InterruptRequestedInput,
  InterruptResolvedInput,
  PostCompactInput,
  PostGenerateFailureInput,
  PostGenerateInput,
  PostToolUseFailureInput,
  PostToolUseInput,
  PreCompactInput,
  PreGenerateInput,
  PreToolUseInput,
  SubagentStartInput,
  SubagentStopInput,
} from "../types.js";
import type { AgentMiddleware, MiddlewareContext } from "./types.js";

/**
 * Options for configuring logging middleware.
 *
 * @category Middleware
 */
export interface LoggingMiddlewareOptions {
  /**
   * Transport to write logs to.
   *
   * The transport determines where logs go - could be console, file,
   * or streaming to a client. SDK is agnostic to the destination.
   *
   * @example
   * ```typescript
   * // Console logging
   * import { createConsoleTransport } from "@lleverage-ai/agent-sdk";
   * const transport = createConsoleTransport();
   *
   * // Custom transport (e.g., streaming to client)
   * const streamTransport: LogTransport = {
   *   name: "stream",
   *   write: (entry) => res.write(JSON.stringify(entry) + "\n"),
   * };
   * ```
   */
  transport: LogTransport;

  /**
   * Log level for filtering events.
   * @default "info"
   */
  level?: LogLevel;

  /**
   * Which events to log.
   * @default all enabled
   */
  events?: {
    /** Log generation start/end events */
    generation?: boolean;
    /** Log tool use events */
    tools?: boolean;
    /** Log context compaction events */
    compaction?: boolean;
    /** Log failure/error events */
    failures?: boolean;
    /** Log subagent events */
    subagents?: boolean;
    /** Log interrupt events (approval requests, custom interrupts) */
    interrupts?: boolean;
  };

  /**
   * Maximum content length for truncation.
   * @default 500
   */
  maxContentLength?: number;

  /**
   * Include timing information in logs.
   * @default true
   */
  includeTiming?: boolean;

  /**
   * Logger name for identification.
   * @default "agent"
   */
  name?: string;
}

/**
 * Truncates a string to the specified length.
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen)}...`;
}

/**
 * Safely stringifies a value for logging.
 */
function safeStringify(value: unknown, maxLen: number): string {
  try {
    const str = JSON.stringify(value);
    return truncate(str, maxLen);
  } catch {
    return "[Unable to stringify]";
  }
}

/**
 * Creates logging middleware that logs agent lifecycle events.
 *
 * The transport determines where logs go - SDK is agnostic. If you want
 * streaming to a client, create a transport that writes to your stream.
 *
 * @param options - Logging middleware configuration
 * @returns AgentMiddleware instance
 *
 * @example
 * ```typescript
 * // Console logging
 * import { createAgent, createLoggingMiddleware, createConsoleTransport } from "@lleverage-ai/agent-sdk";
 *
 * const agent = createAgent({
 *   model,
 *   middleware: [
 *     createLoggingMiddleware({ transport: createConsoleTransport() }),
 *   ],
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Custom transport (e.g., streaming to client)
 * const streamTransport: LogTransport = {
 *   name: "client-stream",
 *   write: (entry) => {
 *     // User decides how to get this to the client
 *     res.write(`data: ${JSON.stringify(entry)}\n\n`);
 *   },
 * };
 *
 * const agent = createAgent({
 *   model,
 *   middleware: [
 *     createLoggingMiddleware({ transport: streamTransport }),
 *   ],
 * });
 * ```
 *
 * @example
 * ```typescript
 * // External service (e.g., Datadog)
 * const datadogTransport: LogTransport = {
 *   name: "datadog",
 *   write: (entry) => datadog.log(entry.level, entry.message, entry.context),
 * };
 *
 * const agent = createAgent({
 *   model,
 *   middleware: [
 *     createLoggingMiddleware({ transport: datadogTransport }),
 *   ],
 * });
 * ```
 *
 * @category Middleware
 */
export function createLoggingMiddleware(options: LoggingMiddlewareOptions): AgentMiddleware {
  const {
    transport,
    level = "info",
    events = {},
    maxContentLength = 500,
    includeTiming = true,
    name = "agent",
  } = options;

  // Default all events to enabled
  const {
    generation = true,
    tools = true,
    compaction = true,
    failures = true,
    subagents = true,
    interrupts = true,
  } = events;

  // Create logger with the provided transport
  const logger = createLogger({
    name,
    level,
    transports: [transport],
  });

  // Track timing for operations
  const generationStartTimes = new Map<string, number>();
  const toolStartTimes = new Map<string, number>();
  const compactionStartTimes = new Map<string, number>();
  const subagentStartTimes = new Map<string, number>();

  return {
    name: "logging",

    register(ctx: MiddlewareContext): void {
      // Generation logging
      if (generation) {
        ctx.onPreGenerate(async (input) => {
          if (input.hook_event_name !== "PreGenerate") return {};
          const preInput = input as PreGenerateInput;

          if (includeTiming) {
            generationStartTimes.set(preInput.session_id, Date.now());
          }

          logger.info("Generation starting", {
            messageCount: preInput.options.messages?.length ?? 0,
            hasPrompt: !!preInput.options.prompt,
            threadId: preInput.options.threadId,
          });

          return {};
        });

        ctx.onPostGenerate(async (input) => {
          if (input.hook_event_name !== "PostGenerate") return {};
          const postInput = input as PostGenerateInput;

          const context: Record<string, unknown> = {
            finishReason: postInput.result.finishReason,
            text: truncate(postInput.result.text ?? "", maxContentLength),
            stepCount: postInput.result.steps?.length ?? 0,
          };

          if (postInput.result.usage) {
            context.tokens = {
              input: postInput.result.usage.inputTokens,
              output: postInput.result.usage.outputTokens,
              total: postInput.result.usage.totalTokens,
            };
          }

          if (includeTiming) {
            const startTime = generationStartTimes.get(postInput.session_id);
            if (startTime) {
              context.durationMs = Date.now() - startTime;
              generationStartTimes.delete(postInput.session_id);
            }
          }

          logger.info("Generation complete", context);

          return {};
        });
      }

      // Generation failure logging
      if (failures) {
        ctx.onPostGenerateFailure(async (input) => {
          if (input.hook_event_name !== "PostGenerateFailure") return {};
          const failInput = input as PostGenerateFailureInput;

          const context: Record<string, unknown> = {
            error: failInput.error?.message ?? "Unknown error",
          };

          if (includeTiming) {
            const startTime = generationStartTimes.get(failInput.session_id);
            if (startTime) {
              context.durationMs = Date.now() - startTime;
              generationStartTimes.delete(failInput.session_id);
            }
          }

          logger.error("Generation failed", failInput.error, context);

          return {};
        });
      }

      // Tool logging
      if (tools) {
        ctx.onPreToolUse(async (input, toolUseId) => {
          if (input.hook_event_name !== "PreToolUse") return {};
          const toolInput = input as PreToolUseInput;

          if (includeTiming && toolUseId) {
            toolStartTimes.set(toolUseId, Date.now());
          }

          logger.info(`Tool call: ${toolInput.tool_name}`, {
            toolName: toolInput.tool_name,
            input: safeStringify(toolInput.tool_input, maxContentLength),
          });

          return {};
        });

        ctx.onPostToolUse(async (input, toolUseId) => {
          if (input.hook_event_name !== "PostToolUse") return {};
          const toolInput = input as PostToolUseInput;

          const context: Record<string, unknown> = {
            toolName: toolInput.tool_name,
            output: safeStringify(toolInput.tool_response, maxContentLength),
          };

          if (includeTiming && toolUseId) {
            const startTime = toolStartTimes.get(toolUseId);
            if (startTime) {
              context.durationMs = Date.now() - startTime;
              toolStartTimes.delete(toolUseId);
            }
          }

          logger.info(`Tool complete: ${toolInput.tool_name}`, context);

          return {};
        });
      }

      // Tool failure logging
      if (failures) {
        ctx.onPostToolUseFailure(async (input, toolUseId) => {
          if (input.hook_event_name !== "PostToolUseFailure") return {};
          const toolInput = input as PostToolUseFailureInput;

          const errorMessage =
            typeof toolInput.error === "string"
              ? toolInput.error
              : (toolInput.error?.message ?? "Unknown error");

          const context: Record<string, unknown> = {
            toolName: toolInput.tool_name,
            error: errorMessage,
          };

          if (includeTiming && toolUseId) {
            const startTime = toolStartTimes.get(toolUseId);
            if (startTime) {
              context.durationMs = Date.now() - startTime;
              toolStartTimes.delete(toolUseId);
            }
          }

          logger.error(`Tool failed: ${toolInput.tool_name}`, context);

          return {};
        });
      }

      // Compaction logging
      if (compaction) {
        ctx.onPreCompact(async (input) => {
          if (input.hook_event_name !== "PreCompact") return {};
          const compactInput = input as PreCompactInput;

          if (includeTiming) {
            compactionStartTimes.set(compactInput.session_id, Date.now());
          }

          logger.info("Context compaction starting", {
            messageCount: compactInput.message_count,
            tokensBefore: compactInput.tokens_before,
          });

          return {};
        });

        ctx.onPostCompact(async (input) => {
          if (input.hook_event_name !== "PostCompact") return {};
          const compactInput = input as PostCompactInput;

          const reductionPercent =
            compactInput.tokens_before > 0
              ? ((compactInput.tokens_saved / compactInput.tokens_before) * 100).toFixed(1)
              : "0.0";

          const context: Record<string, unknown> = {
            messagesBefore: compactInput.messages_before,
            messagesAfter: compactInput.messages_after,
            tokensBefore: compactInput.tokens_before,
            tokensAfter: compactInput.tokens_after,
            tokensSaved: compactInput.tokens_saved,
            reductionPercent,
          };

          if (includeTiming) {
            const startTime = compactionStartTimes.get(compactInput.session_id);
            if (startTime) {
              context.durationMs = Date.now() - startTime;
              compactionStartTimes.delete(compactInput.session_id);
            }
          }

          logger.info("Context compaction complete", context);

          return {};
        });
      }

      // Subagent logging
      if (subagents) {
        ctx.onSubagentStart(async (input) => {
          if (input.hook_event_name !== "SubagentStart") return {};
          const subagentInput = input as SubagentStartInput;

          if (includeTiming) {
            subagentStartTimes.set(subagentInput.agent_id, Date.now());
          }

          logger.info(`Subagent started: ${subagentInput.agent_type}`, {
            agentId: subagentInput.agent_id,
            agentType: subagentInput.agent_type,
            prompt: subagentInput.prompt
              ? truncate(subagentInput.prompt, maxContentLength)
              : undefined,
          });

          return {};
        });

        ctx.onSubagentStop(async (input) => {
          if (input.hook_event_name !== "SubagentStop") return {};
          const subagentInput = input as SubagentStopInput;

          const context: Record<string, unknown> = {
            agentId: subagentInput.agent_id,
            agentType: subagentInput.agent_type,
          };

          if (subagentInput.error) {
            context.error = subagentInput.error.message;
          }

          if (includeTiming) {
            const startTime = subagentStartTimes.get(subagentInput.agent_id);
            if (startTime) {
              context.durationMs = Date.now() - startTime;
              subagentStartTimes.delete(subagentInput.agent_id);
            }
          }

          if (subagentInput.error) {
            logger.error(`Subagent failed: ${subagentInput.agent_type}`, context);
          } else {
            logger.info(`Subagent complete: ${subagentInput.agent_type}`, context);
          }

          return {};
        });
      }

      // Interrupt logging
      if (interrupts) {
        ctx.onInterruptRequested(async (input) => {
          if (input.hook_event_name !== "InterruptRequested") return {};
          const interruptInput = input as InterruptRequestedInput;

          const context: Record<string, unknown> = {
            interruptId: interruptInput.interrupt_id,
            interruptType: interruptInput.interrupt_type,
          };

          if (interruptInput.tool_name) {
            context.toolName = interruptInput.tool_name;
          }
          if (interruptInput.tool_call_id) {
            context.toolCallId = interruptInput.tool_call_id;
          }

          // For approval interrupts, log the request details
          if (interruptInput.interrupt_type === "approval") {
            logger.info(`Approval requested: ${interruptInput.tool_name}`, context);
          } else {
            logger.info(`Interrupt requested: ${interruptInput.interrupt_type}`, context);
          }

          return {};
        });

        ctx.onInterruptResolved(async (input) => {
          if (input.hook_event_name !== "InterruptResolved") return {};
          const interruptInput = input as InterruptResolvedInput;

          const context: Record<string, unknown> = {
            interruptId: interruptInput.interrupt_id,
            interruptType: interruptInput.interrupt_type,
          };

          if (interruptInput.tool_name) {
            context.toolName = interruptInput.tool_name;
          }
          if (interruptInput.tool_call_id) {
            context.toolCallId = interruptInput.tool_call_id;
          }

          // For approval interrupts, log the approval decision
          if (interruptInput.interrupt_type === "approval") {
            context.approved = interruptInput.approved;
            const decision = interruptInput.approved ? "approved" : "denied";
            logger.info(`Approval ${decision}: ${interruptInput.tool_name}`, context);
          } else {
            logger.info(`Interrupt resolved: ${interruptInput.interrupt_type}`, context);
          }

          return {};
        });
      }
    },

    async teardown(): Promise<void> {
      // Flush and close the logger
      await logger.flush();
      await logger.close();
    },
  };
}
