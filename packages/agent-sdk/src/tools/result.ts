/**
 * Failure-as-data contract for agent-facing tools.
 *
 * Expected operational failures (a dropped connection, a timeout, an upstream
 * 429, a record that does not exist) are returned to the model as data it can
 * reason over. Thrown errors are reserved for unexpected platform bugs.
 *
 * @packageDocumentation
 */

import type { Tool, ToolExecutionOptions } from "ai";
import { isInterruptSignal } from "../agent/tool-pipeline.js";
import { AgentError, type AgentErrorCode, wrapError } from "../errors/index.js";

/**
 * A successful tool result.
 *
 * @category Tools
 */
export interface ToolSuccess<T> {
  /** Discriminant: the call did what it was asked to do. */
  success: true;
  /** The tool's payload. */
  data: T;
  /** Optional guidance for the model, such as a caveat about the data. */
  note?: string;
}

/**
 * A failed tool result the model can reason over.
 *
 * `error` is safe to show the model and the user: it never carries a stack
 * trace or a low-level transport message.
 *
 * @category Tools
 */
export interface ToolFailure {
  /** Discriminant: the call did not do what it was asked to do. */
  success: false;
  /** Plain-language description of what went wrong. */
  error: string;
  /** Machine-readable failure kind, such as `RATE_LIMIT_ERROR` or a tool-specific code. */
  code?: AgentErrorCode | (string & {});
  /** Whether calling the tool again, as-is or with corrected input, may succeed. */
  recoverable?: boolean;
  /** Suggested wait before calling again, in milliseconds. */
  retryAfterMs?: number;
  /** Structured, model-safe context about the failure. */
  details?: unknown;
  /** Optional guidance for the model, such as what to try instead. */
  note?: string;
}

/**
 * Result of an agent-facing tool: success or failure as data.
 *
 * @example
 * ```typescript
 * const getOrder = tool({
 *   description: "Look up an order",
 *   inputSchema: z.object({ id: z.string() }),
 *   execute: async ({ id }): Promise<AgentToolResult<Order>> => {
 *     const order = await erp.findOrder(id);
 *     if (!order) {
 *       return toolFailure(`No order with id ${id}.`, { code: "ORDER_NOT_FOUND", recoverable: true });
 *     }
 *     return toolSuccess(order);
 *   },
 * });
 * ```
 *
 * @category Tools
 */
export type AgentToolResult<T> = ToolSuccess<T> | ToolFailure;

/**
 * Builds a {@link ToolSuccess}.
 *
 * @param data - The tool's payload
 * @param note - Optional guidance for the model
 * @returns A successful tool result
 *
 * @category Tools
 */
export function toolSuccess<T>(data: T, note?: string): ToolSuccess<T> {
  return note === undefined ? { success: true, data } : { success: true, data, note };
}

/**
 * Builds a {@link ToolFailure}.
 *
 * @param error - Plain-language description, safe to show the model and the user
 * @param options - Optional code, recoverability, retry delay, details and note
 * @returns A failed tool result
 *
 * @category Tools
 */
export function toolFailure(
  error: string,
  options: Omit<ToolFailure, "success" | "error"> = {},
): ToolFailure {
  return { success: false, error, ...options };
}

/**
 * Checks whether a tool output is a {@link ToolFailure}.
 *
 * @param value - Any tool output
 * @returns `true` when the output is `{ success: false, error: string }`
 *
 * @category Tools
 */
export function isToolFailure(value: unknown): value is ToolFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { success?: unknown }).success === false &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

const SAFE_MESSAGES: Partial<Record<AgentErrorCode, string>> = {
  NETWORK_ERROR: "The connection to the service dropped before the call finished.",
  TIMEOUT_ERROR: "The service did not respond in time.",
  RATE_LIMIT_ERROR: "The service is rate limiting requests.",
  AUTHENTICATION_ERROR: "The tool could not authenticate with the service.",
  AUTHORIZATION_ERROR: "The tool is not permitted to perform this action.",
  VALIDATION_ERROR: "The tool could not validate the data it received.",
  ABORT_ERROR: "The call was cancelled before it finished.",
};
const UNKNOWN_FAILURE_MESSAGE = "The tool failed unexpectedly.";
const RECOVERABLE_CODES = new Set<AgentErrorCode>([
  "NETWORK_ERROR",
  "TIMEOUT_ERROR",
  "RATE_LIMIT_ERROR",
]);

// Known Node/undici codes only; extend as new transports surface.
const TRANSPORT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "UND_ERR_SOCKET"]);
const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * Classifies transport failures that message heuristics miss, walking the
 * cause chain. Covers undici's `TypeError: terminated` (a stream cut off
 * mid-response) and `AbortSignal.timeout()` rejections.
 */
function classifyTransport(error: unknown): AgentErrorCode | undefined {
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (current.name === "TimeoutError" || TIMEOUT_CODES.has(code as string)) {
      return "TIMEOUT_ERROR";
    }
    if (
      TRANSPORT_CODES.has(code as string) ||
      (current.name === "TypeError" && current.message === "terminated")
    ) {
      return "NETWORK_ERROR";
    }
    current = current.cause;
  }
  return undefined;
}

/**
 * Converts a thrown value into a model-safe {@link ToolFailure}.
 *
 * An {@link AgentError} keeps its `code`, `retryable` and `retryAfterMs`, and
 * its `userMessage` becomes `error`, so set `userMessage` when the technical
 * message carries internals. Any other value is classified by kind and given
 * a fixed message: its own message and stack never reach the model.
 *
 * @param error - The thrown value
 * @returns A failed tool result
 *
 * @category Tools
 */
export function toToolFailure(error: unknown): ToolFailure {
  if (AgentError.is(error)) {
    return toolFailure(error.userMessage, {
      code: error.code,
      recoverable: error.retryable,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    });
  }
  const code = classifyTransport(error) ?? wrapError(error, UNKNOWN_FAILURE_MESSAGE).code;
  return toolFailure(SAFE_MESSAGES[code] ?? UNKNOWN_FAILURE_MESSAGE, {
    code,
    recoverable: RECOVERABLE_CODES.has(code),
  });
}

/**
 * Options for {@link safeTool}.
 *
 * @category Tools
 */
export interface SafeToolOptions {
  /**
   * Receives the original error before it is converted, for logging. The
   * model only ever sees the converted {@link ToolFailure}.
   */
  onError?: (error: unknown, context: { toolCallId: string }) => void;
}

/**
 * Wraps a tool so a thrown error comes back as a {@link ToolFailure} instead
 * of a raw tool error.
 *
 * Successful outputs pass through unchanged, so tools that already return
 * {@link AgentToolResult} (or any other shape) keep it. Interrupts and
 * cancellation of the run (`abortSignal` aborted) are re-thrown untouched.
 *
 * @param toolDef - The tool to wrap
 * @param options - Optional error callback
 * @returns The same tool with a guarded `execute`
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   model,
 *   tools: {
 *     submit_order: safeTool(submitOrder, {
 *       onError: (error) => logger.error("submit_order failed", { error }),
 *     }),
 *   },
 * });
 * // A dropped ERP connection now reaches the model as
 * // { success: false, error: "The connection to the service dropped before the call finished.",
 * //   code: "NETWORK_ERROR", recoverable: true }
 * ```
 *
 * @category Tools
 */
export function safeTool<INPUT, OUTPUT>(
  toolDef: Tool<INPUT, OUTPUT>,
  options: SafeToolOptions = {},
): Tool<INPUT, OUTPUT | ToolFailure> {
  const execute = toolDef.execute;
  if (!execute) {
    return toolDef as Tool<INPUT, OUTPUT | ToolFailure>;
  }

  // Awaits execute(), so streaming (async-iterable) outputs are not guarded,
  // matching the agent's own tool pipeline.
  return {
    ...toolDef,
    execute: async (input: INPUT, execOptions: ToolExecutionOptions<unknown>) => {
      try {
        return await execute.call(toolDef, input, execOptions);
      } catch (error) {
        if (isInterruptSignal(error) || execOptions.abortSignal?.aborted) {
          throw error;
        }
        options.onError?.(error, { toolCallId: execOptions.toolCallId });
        return toToolFailure(error);
      }
    },
  } as Tool<INPUT, OUTPUT | ToolFailure>;
}
