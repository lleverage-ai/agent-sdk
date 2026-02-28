/**
 * Error Handling System.
 *
 * Provides typed error classes, utilities, and patterns for robust error handling
 * across the agent SDK.
 *
 * @packageDocumentation
 */

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Error codes for categorizing errors.
 *
 * @category Errors
 */
export type AgentErrorCode =
  | "AGENT_ERROR"
  | "CONFIGURATION_ERROR"
  | "VALIDATION_ERROR"
  | "TOOL_ERROR"
  | "MODEL_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT_ERROR"
  | "RATE_LIMIT_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "CHECKPOINT_ERROR"
  | "BACKEND_ERROR"
  | "CONTEXT_ERROR"
  | "SUBAGENT_ERROR"
  | "MEMORY_ERROR"
  | "ABORT_ERROR"
  | "UNKNOWN_ERROR";

/**
 * Severity levels for errors.
 *
 * - `fatal`: The operation cannot continue and the agent should stop
 * - `error`: The operation failed but the agent can continue with other tasks
 * - `warning`: Something unexpected happened but the operation completed
 *
 * @category Errors
 */
export type ErrorSeverity = "fatal" | "error" | "warning";

/**
 * Base error class for all agent SDK errors.
 *
 * Provides consistent structure with error codes, user-friendly messages,
 * and metadata support.
 *
 * @example
 * ```typescript
 * throw new AgentError("Something went wrong", {
 *   code: "TOOL_ERROR",
 *   userMessage: "The operation failed. Please try again.",
 *   cause: originalError,
 *   metadata: { toolName: "read_file", path: "/path/to/file" },
 * });
 * ```
 *
 * @category Errors
 */
export class AgentError extends Error {
  /**
   * Error code for categorization.
   */
  readonly code: AgentErrorCode;

  /**
   * User-friendly error message suitable for display.
   */
  readonly userMessage: string;

  /**
   * Severity level of the error.
   */
  readonly severity: ErrorSeverity;

  /**
   * Whether this error can be retried.
   */
  readonly retryable: boolean;

  /**
   * Suggested delay before retry in milliseconds.
   */
  readonly retryAfterMs?: number;

  /**
   * Additional metadata about the error.
   */
  readonly metadata: Record<string, unknown>;

  /**
   * The original error that caused this error.
   */
  override readonly cause?: Error;

  /**
   * Timestamp when the error occurred.
   */
  readonly timestamp: number;

  constructor(
    message: string,
    options: {
      code?: AgentErrorCode;
      userMessage?: string;
      severity?: ErrorSeverity;
      retryable?: boolean;
      retryAfterMs?: number;
      metadata?: Record<string, unknown>;
      cause?: Error;
    } = {},
  ) {
    super(message);
    this.name = "AgentError";
    this.code = options.code ?? "AGENT_ERROR";
    this.userMessage = options.userMessage ?? this.generateUserMessage(message);
    this.severity = options.severity ?? "error";
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.metadata = options.metadata ?? {};
    this.cause = options.cause;
    this.timestamp = Date.now();

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Generate a user-friendly message from the technical message.
   */
  private generateUserMessage(message: string): string {
    // Remove technical details for user display
    return message
      .replace(/\b[A-Z_]+Error\b/g, "An error")
      .replace(/\{[^}]+\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Get a structured representation of the error for logging.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      severity: this.severity,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
      metadata: this.metadata,
      cause: this.cause?.message,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }

  /**
   * Check if an error is a specific type of AgentError.
   */
  static is(error: unknown): error is AgentError {
    return error instanceof AgentError;
  }

  /**
   * Check if an error has a specific code.
   */
  static hasCode(error: unknown, code: AgentErrorCode): boolean {
    return AgentError.is(error) && error.code === code;
  }
}

// =============================================================================
// Specific Error Classes
// =============================================================================

/**
 * Error thrown when agent configuration is invalid.
 *
 * @category Errors
 */
export class ConfigurationError extends AgentError {
  constructor(
    message: string,
    options: {
      configKey?: string;
      expectedType?: string;
      actualValue?: unknown;
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    super(message, {
      code: "CONFIGURATION_ERROR",
      severity: "fatal",
      userMessage: `Configuration error: ${options.configKey ? `Invalid value for '${options.configKey}'` : message}`,
      metadata: {
        configKey: options.configKey,
        expectedType: options.expectedType,
        actualValue: options.actualValue,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "ConfigurationError";
  }
}

/**
 * Error thrown when input validation fails.
 *
 * @category Errors
 */
export class ValidationError extends AgentError {
  /**
   * Validation errors for specific fields.
   */
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    message: string,
    options: {
      fieldErrors?: Record<string, string[]>;
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    super(message, {
      code: "VALIDATION_ERROR",
      severity: "error",
      userMessage: "The provided input is invalid. Please check and try again.",
      metadata: {
        fieldErrors: options.fieldErrors,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "ValidationError";
    this.fieldErrors = options.fieldErrors ?? {};
  }

  /**
   * Get a formatted list of validation errors.
   */
  getErrorList(): string[] {
    const errors: string[] = [];
    for (const [field, messages] of Object.entries(this.fieldErrors)) {
      for (const msg of messages) {
        errors.push(`${field}: ${msg}`);
      }
    }
    return errors;
  }
}

/**
 * Error thrown when a tool execution fails.
 *
 * @category Errors
 */
export class ToolExecutionError extends AgentError {
  /**
   * Name of the tool that failed.
   */
  readonly toolName: string;

  /**
   * Input that was passed to the tool.
   */
  readonly toolInput: unknown;

  constructor(
    message: string,
    options: {
      toolName: string;
      toolInput?: unknown;
      cause?: Error;
      metadata?: Record<string, unknown>;
    },
  ) {
    super(message, {
      code: "TOOL_ERROR",
      severity: "error",
      userMessage: `The tool '${options.toolName}' encountered an error. Please try again or use a different approach.`,
      retryable: true,
      metadata: {
        toolName: options.toolName,
        toolInput: options.toolInput,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "ToolExecutionError";
    this.toolName = options.toolName;
    this.toolInput = options.toolInput;
  }
}

/**
 * Error thrown when a tool execution is denied by a PreToolUse hook.
 *
 * @category Errors
 */
export class ToolPermissionDeniedError extends AgentError {
  /**
   * Name of the tool that was denied.
   */
  readonly toolName: string;

  /**
   * Input that was attempted.
   */
  readonly toolInput: unknown;

  /**
   * Reason provided by the hook (if any).
   */
  readonly reason?: string;

  constructor(
    message: string,
    options: {
      toolName: string;
      toolInput?: unknown;
      reason?: string;
      cause?: Error;
      metadata?: Record<string, unknown>;
    },
  ) {
    super(message, {
      code: "AUTHORIZATION_ERROR",
      severity: "error",
      userMessage: `Tool '${options.toolName}' was blocked: ${options.reason || "Permission denied"}`,
      retryable: false,
      metadata: {
        toolName: options.toolName,
        toolInput: options.toolInput,
        reason: options.reason,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "ToolPermissionDeniedError";
    this.toolName = options.toolName;
    this.toolInput = options.toolInput;
    this.reason = options.reason;
  }
}

/**
 * Error thrown when a generation request is denied by a PreGenerate hook.
 *
 * @category Errors
 */
export class GeneratePermissionDeniedError extends AgentError {
  /**
   * Reason provided by the hook (if any).
   */
  readonly reason?: string;

  /**
   * IDs of messages that caused the block (for client-side cleanup).
   */
  readonly blockedMessageIds?: string[];

  constructor(
    message: string,
    options: {
      reason?: string;
      blockedMessageIds?: string[];
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    super(message, {
      code: "AUTHORIZATION_ERROR",
      severity: "error",
      userMessage: options.reason || "Generation blocked by content policy",
      retryable: false,
      metadata: {
        reason: options.reason,
        blockedMessageIds: options.blockedMessageIds,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "GeneratePermissionDeniedError";
    this.reason = options.reason;
    this.blockedMessageIds = options.blockedMessageIds;
  }
}

/**
 * Error thrown when the AI model fails or returns an error.
 *
 * @category Errors
 */
export class ModelError extends AgentError {
  /**
   * Model identifier that failed.
   */
  readonly modelId?: string;

  constructor(
    message: string,
    options: {
      modelId?: string;
      statusCode?: number;
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    const isRateLimit = options.statusCode === 429 || message.toLowerCase().includes("rate limit");
    const isTimeout =
      message.toLowerCase().includes("timeout") || message.toLowerCase().includes("timed out");

    super(message, {
      code: isRateLimit ? "RATE_LIMIT_ERROR" : isTimeout ? "TIMEOUT_ERROR" : "MODEL_ERROR",
      severity: "error",
      userMessage: isRateLimit
        ? "The AI service is busy. Please wait a moment and try again."
        : isTimeout
          ? "The request took too long. Please try again."
          : "The AI service encountered an error. Please try again.",
      retryable: isRateLimit || isTimeout,
      retryAfterMs: isRateLimit ? 30000 : isTimeout ? 5000 : undefined,
      metadata: {
        modelId: options.modelId,
        statusCode: options.statusCode,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "ModelError";
    this.modelId = options.modelId;
  }
}

/**
 * Error thrown when a network request fails.
 *
 * @category Errors
 */
export class NetworkError extends AgentError {
  constructor(
    message: string,
    options: {
      url?: string;
      statusCode?: number;
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    super(message, {
      code: "NETWORK_ERROR",
      severity: "error",
      userMessage: "A network error occurred. Please check your connection and try again.",
      retryable: true,
      retryAfterMs: 2000,
      metadata: {
        url: options.url,
        statusCode: options.statusCode,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "NetworkError";
  }
}

/**
 * Error thrown when an operation times out.
 *
 * @category Errors
 */
export class TimeoutError extends AgentError {
  /**
   * Timeout duration in milliseconds.
   */
  readonly timeoutMs: number;

  /**
   * Operation that timed out.
   */
  readonly operation: string;

  constructor(
    message: string,
    options: {
      timeoutMs: number;
      operation: string;
      cause?: Error;
      metadata?: Record<string, unknown>;
    },
  ) {
    super(message, {
      code: "TIMEOUT_ERROR",
      severity: "error",
      userMessage: `The operation '${options.operation}' took too long and was stopped.`,
      retryable: true,
      retryAfterMs: 1000,
      metadata: {
        timeoutMs: options.timeoutMs,
        operation: options.operation,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "TimeoutError";
    this.timeoutMs = options.timeoutMs;
    this.operation = options.operation;
  }
}

/**
 * Error thrown when rate limits are exceeded.
 *
 * @category Errors
 */
export class RateLimitError extends AgentError {
  /**
   * When to retry after (Date or ms).
   */
  readonly retryAfter?: Date | number;

  constructor(
    message: string,
    options: {
      retryAfter?: Date | number;
      limit?: number;
      remaining?: number;
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    const retryMs =
      options.retryAfter instanceof Date
        ? options.retryAfter.getTime() - Date.now()
        : (options.retryAfter ?? 60000);

    super(message, {
      code: "RATE_LIMIT_ERROR",
      severity: "error",
      userMessage: "Rate limit reached. Please wait a moment before trying again.",
      retryable: true,
      retryAfterMs: Math.max(retryMs, 1000),
      metadata: {
        retryAfter: options.retryAfter,
        limit: options.limit,
        remaining: options.remaining,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "RateLimitError";
    this.retryAfter = options.retryAfter;
  }
}

/**
 * Error thrown when authentication fails.
 *
 * @category Errors
 */
export class AuthenticationError extends AgentError {
  constructor(
    message: string,
    options: {
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    super(message, {
      code: "AUTHENTICATION_ERROR",
      severity: "fatal",
      userMessage: "Authentication failed. Please check your credentials.",
      retryable: false,
      metadata: options.metadata,
      cause: options.cause,
    });
    this.name = "AuthenticationError";
  }
}

/**
 * Error thrown when authorization fails.
 *
 * @category Errors
 */
export class AuthorizationError extends AgentError {
  constructor(
    message: string,
    options: {
      resource?: string;
      action?: string;
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    super(message, {
      code: "AUTHORIZATION_ERROR",
      severity: "error",
      userMessage: "You don't have permission to perform this action.",
      retryable: false,
      metadata: {
        resource: options.resource,
        action: options.action,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "AuthorizationError";
  }
}

/**
 * Error thrown when checkpoint operations fail.
 *
 * @category Errors
 */
export class CheckpointError extends AgentError {
  /**
   * Thread ID associated with the checkpoint.
   */
  readonly threadId?: string;

  /**
   * Operation that failed (save, load, delete, fork).
   */
  readonly operation: "save" | "load" | "delete" | "list" | "fork";

  constructor(
    message: string,
    options: {
      operation: "save" | "load" | "delete" | "list" | "fork";
      threadId?: string;
      cause?: Error;
      metadata?: Record<string, unknown>;
    },
  ) {
    super(message, {
      code: "CHECKPOINT_ERROR",
      severity: "error",
      userMessage: `Failed to ${options.operation} session state. Your progress may not be saved.`,
      retryable: options.operation === "save" || options.operation === "fork",
      metadata: {
        operation: options.operation,
        threadId: options.threadId,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "CheckpointError";
    this.threadId = options.threadId;
    this.operation = options.operation;
  }
}

/**
 * Error thrown when backend operations fail.
 *
 * @category Errors
 */
export class BackendError extends AgentError {
  /**
   * Backend operation that failed.
   */
  readonly operation: string;

  /**
   * Path involved in the operation.
   */
  readonly path?: string;

  constructor(
    message: string,
    options: {
      operation: string;
      path?: string;
      cause?: Error;
      metadata?: Record<string, unknown>;
    },
  ) {
    super(message, {
      code: "BACKEND_ERROR",
      severity: "error",
      userMessage: `Failed to ${options.operation}${options.path ? ` for '${options.path}'` : ""}. Please try again.`,
      retryable: true,
      metadata: {
        operation: options.operation,
        path: options.path,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "BackendError";
    this.operation = options.operation;
    this.path = options.path;
  }
}

/**
 * Error thrown when context management fails.
 *
 * @category Errors
 */
export class ContextError extends AgentError {
  constructor(
    message: string,
    options: {
      operation?: "compact" | "count" | "summarize";
      currentTokens?: number;
      maxTokens?: number;
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    super(message, {
      code: "CONTEXT_ERROR",
      severity: "warning",
      userMessage: "Context management encountered an issue. The conversation may be truncated.",
      retryable: false,
      metadata: {
        operation: options.operation,
        currentTokens: options.currentTokens,
        maxTokens: options.maxTokens,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "ContextError";
  }
}

/**
 * Error thrown when subagent operations fail.
 *
 * @category Errors
 */
export class SubagentError extends AgentError {
  /**
   * Name of the subagent that failed.
   */
  readonly subagentName: string;

  /**
   * Task that was being executed.
   */
  readonly task?: string;

  constructor(
    message: string,
    options: {
      subagentName: string;
      task?: string;
      cause?: Error;
      metadata?: Record<string, unknown>;
    },
  ) {
    super(message, {
      code: "SUBAGENT_ERROR",
      severity: "error",
      userMessage: `The assistant '${options.subagentName}' encountered an error while working on your request.`,
      retryable: true,
      metadata: {
        subagentName: options.subagentName,
        task: options.task,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "SubagentError";
    this.subagentName = options.subagentName;
    this.task = options.task;
  }
}

/**
 * Error thrown when memory operations fail.
 *
 * @category Errors
 */
export class MemoryError extends AgentError {
  /**
   * Memory path that was being accessed.
   */
  readonly memoryPath?: string;

  /**
   * Operation that failed.
   */
  readonly operation: "read" | "write" | "delete" | "list" | "load";

  constructor(
    message: string,
    options: {
      operation: "read" | "write" | "delete" | "list" | "load";
      memoryPath?: string;
      cause?: Error;
      metadata?: Record<string, unknown>;
    },
  ) {
    super(message, {
      code: "MEMORY_ERROR",
      severity: "warning",
      userMessage: `Failed to ${options.operation} memory${options.memoryPath ? ` at '${options.memoryPath}'` : ""}.`,
      retryable: options.operation !== "delete",
      metadata: {
        operation: options.operation,
        memoryPath: options.memoryPath,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "MemoryError";
    this.memoryPath = options.memoryPath;
    this.operation = options.operation;
  }
}

/**
 * Error thrown when an operation is aborted.
 *
 * @category Errors
 */
export class AbortError extends AgentError {
  /**
   * Reason for the abort.
   */
  readonly reason?: string;

  constructor(
    message = "Operation was aborted",
    options: {
      reason?: string;
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    super(message, {
      code: "ABORT_ERROR",
      severity: "warning",
      userMessage: options.reason ?? "The operation was cancelled.",
      retryable: false,
      metadata: {
        reason: options.reason,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "AbortError";
    this.reason = options.reason;
  }
}

// =============================================================================
// Error Utilities
// =============================================================================

/**
 * Options for wrapping errors.
 *
 * @category Errors
 */
export interface WrapErrorOptions {
  /** Error code to use */
  code?: AgentErrorCode;
  /** User-friendly message */
  userMessage?: string;
  /** Severity level */
  severity?: ErrorSeverity;
  /** Whether the error is retryable */
  retryable?: boolean;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Wrap any error as an AgentError.
 *
 * Preserves existing AgentErrors while wrapping other errors with additional context.
 *
 * @param error - The error to wrap
 * @param message - Additional context message
 * @param options - Options for the wrapped error
 * @returns An AgentError instance
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   throw wrapError(error, "Failed to perform risky operation", {
 *     code: "BACKEND_ERROR",
 *     metadata: { operation: "risky" },
 *   });
 * }
 * ```
 *
 * @category Errors
 */
export function wrapError(
  error: unknown,
  message: string,
  options: WrapErrorOptions = {},
): AgentError {
  // Already an AgentError - preserve it
  if (AgentError.is(error)) {
    return error;
  }

  // Wrap standard Error
  if (error instanceof Error) {
    return new AgentError(message, {
      code: options.code ?? inferErrorCode(error),
      userMessage: options.userMessage,
      severity: options.severity,
      retryable: options.retryable ?? isRetryable(error),
      metadata: options.metadata,
      cause: error,
    });
  }

  // Wrap unknown error
  return new AgentError(message, {
    code: options.code ?? "UNKNOWN_ERROR",
    userMessage: options.userMessage,
    severity: options.severity,
    retryable: options.retryable ?? false,
    metadata: {
      ...options.metadata,
      originalError: String(error),
    },
  });
}

/**
 * Infer error code from an Error instance.
 */
function inferErrorCode(error: Error): AgentErrorCode {
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  if (name.includes("abort") || message.includes("abort")) {
    return "ABORT_ERROR";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "TIMEOUT_ERROR";
  }
  if (message.includes("rate limit") || message.includes("429")) {
    return "RATE_LIMIT_ERROR";
  }
  if (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("econnrefused") ||
    message.includes("econnreset")
  ) {
    return "NETWORK_ERROR";
  }
  if (message.includes("auth") || message.includes("401")) {
    return "AUTHENTICATION_ERROR";
  }
  if (message.includes("permission") || message.includes("forbidden") || message.includes("403")) {
    return "AUTHORIZATION_ERROR";
  }
  if (message.includes("validation") || message.includes("invalid")) {
    return "VALIDATION_ERROR";
  }

  return "UNKNOWN_ERROR";
}

/**
 * Check if an error is retryable.
 *
 * @param error - The error to check
 * @returns Whether the error is retryable
 *
 * @category Errors
 */
export function isRetryable(error: unknown): boolean {
  if (AgentError.is(error)) {
    return error.retryable;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Retryable conditions
    if (
      message.includes("rate limit") ||
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("network") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("503") ||
      message.includes("502") ||
      message.includes("504")
    ) {
      return true;
    }

    // Non-retryable conditions
    if (
      message.includes("invalid") ||
      message.includes("validation") ||
      message.includes("auth") ||
      message.includes("permission") ||
      message.includes("not found")
    ) {
      return false;
    }
  }

  return false;
}

/**
 * Get a user-friendly error message from any error.
 *
 * @param error - The error to get a message from
 * @param fallback - Fallback message if extraction fails
 * @returns A user-friendly error message
 *
 * @category Errors
 */
export function getUserMessage(
  error: unknown,
  fallback = "An unexpected error occurred. Please try again.",
): string {
  if (AgentError.is(error)) {
    return error.userMessage;
  }

  if (error instanceof Error) {
    // Try to make the message more user-friendly
    const message = error.message;

    // Common error patterns to user-friendly messages
    if (message.toLowerCase().includes("rate limit")) {
      return "The service is busy. Please wait a moment and try again.";
    }
    if (message.toLowerCase().includes("timeout") || message.toLowerCase().includes("timed out")) {
      return "The request took too long. Please try again.";
    }
    if (message.toLowerCase().includes("network")) {
      return "A network error occurred. Please check your connection.";
    }
    if (message.toLowerCase().includes("auth") || message.toLowerCase().includes("401")) {
      return "Authentication failed. Please check your credentials.";
    }
    if (message.toLowerCase().includes("permission") || message.toLowerCase().includes("403")) {
      return "You don't have permission to perform this action.";
    }
    if (message.toLowerCase().includes("not found") || message.includes("404")) {
      return "The requested resource was not found.";
    }

    // Return the original message if it's reasonably short
    if (message.length < 100 && !message.includes("Error:")) {
      return message;
    }
  }

  return fallback;
}

/**
 * Format an error for logging.
 *
 * @param error - The error to format
 * @returns A structured object suitable for logging
 *
 * @category Errors
 */
export function formatErrorForLogging(error: unknown): Record<string, unknown> {
  if (AgentError.is(error)) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error ? error.cause.message : error.cause,
    };
  }

  return {
    type: typeof error,
    value: String(error),
  };
}

/**
 * Create an error handler that catches and transforms errors.
 *
 * @param options - Handler options
 * @returns A function that wraps async operations with error handling
 *
 * @example
 * ```typescript
 * const handle = createErrorHandler({
 *   onError: (error) => console.error(error),
 *   transform: (error) => wrapError(error, "Operation failed"),
 * });
 *
 * const result = await handle(async () => {
 *   return await riskyOperation();
 * });
 * ```
 *
 * @category Errors
 */
export function createErrorHandler(options: {
  onError?: (error: AgentError) => void | Promise<void>;
  transform?: (error: unknown) => AgentError;
}): <T>(fn: () => Promise<T>) => Promise<T> {
  const { onError, transform } = options;

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      const agentError = transform ? transform(error) : wrapError(error, "An error occurred");

      if (onError) {
        await onError(agentError);
      }

      throw agentError;
    }
  };
}

// =============================================================================
// Graceful Degradation Utilities
// =============================================================================

/**
 * Options for graceful degradation.
 *
 * @category Errors
 */
export interface FallbackOptions<T> {
  /** Fallback value to use on error */
  fallback: T;
  /** Whether to log the error */
  logError?: boolean;
  /** Error callback */
  onError?: (error: AgentError) => void | Promise<void>;
  /** Whether to rethrow fatal errors */
  rethrowFatal?: boolean;
}

/**
 * Execute an operation with a fallback value on error.
 *
 * Provides graceful degradation by returning a fallback value when
 * the primary operation fails.
 *
 * @param fn - The operation to execute
 * @param options - Fallback options
 * @returns The result or fallback value
 *
 * @example
 * ```typescript
 * const memory = await withFallback(
 *   () => loadAgentMemory("/path/to/memory.md"),
 *   { fallback: "", logError: true }
 * );
 * ```
 *
 * @category Errors
 */
export async function withFallback<T>(
  fn: () => Promise<T>,
  options: FallbackOptions<T>,
): Promise<T> {
  const { fallback, logError = true, onError, rethrowFatal = true } = options;

  try {
    return await fn();
  } catch (error) {
    const agentError = wrapError(error, "Operation failed");

    // Rethrow fatal errors
    if (rethrowFatal && agentError.severity === "fatal") {
      throw agentError;
    }

    // Log if requested
    if (logError) {
      console.warn(`[withFallback] Using fallback due to error: ${agentError.message}`);
    }

    // Call error handler
    if (onError) {
      await onError(agentError);
    }

    return fallback;
  }
}

/**
 * Execute an operation with a fallback function on error.
 *
 * Similar to withFallback but allows computing the fallback value.
 *
 * @param fn - The primary operation
 * @param fallbackFn - Function to compute the fallback
 * @param onError - Optional error callback
 * @returns The result or computed fallback
 *
 * @example
 * ```typescript
 * const data = await withFallbackFn(
 *   () => fetchFromPrimary(),
 *   (error) => fetchFromBackup(error)
 * );
 * ```
 *
 * @category Errors
 */
export async function withFallbackFn<T>(
  fn: () => Promise<T>,
  fallbackFn: (error: AgentError) => T | Promise<T>,
  onError?: (error: AgentError) => void | Promise<void>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const agentError = wrapError(error, "Operation failed");

    if (onError) {
      await onError(agentError);
    }

    return fallbackFn(agentError);
  }
}

/**
 * Execute multiple operations until one succeeds.
 *
 * Tries each operation in order and returns the first successful result.
 *
 * @param operations - Array of operations to try
 * @param options - Options including error handling
 * @returns The first successful result
 * @throws The last error if all operations fail
 *
 * @example
 * ```typescript
 * const result = await tryOperations([
 *   () => fetchFromPrimaryAPI(),
 *   () => fetchFromSecondaryAPI(),
 *   () => fetchFromCache(),
 * ]);
 * ```
 *
 * @category Errors
 */
export async function tryOperations<T>(
  operations: Array<() => Promise<T>>,
  options: {
    onError?: (error: AgentError, index: number) => void | Promise<void>;
  } = {},
): Promise<T> {
  const { onError } = options;
  let lastError: AgentError | undefined;

  for (let i = 0; i < operations.length; i++) {
    try {
      const operation = operations[i];
      if (!operation) continue;
      return await operation();
    } catch (error) {
      lastError = wrapError(error, `Operation ${i + 1} failed`);

      if (onError) {
        await onError(lastError, i);
      }
    }
  }

  throw (
    lastError ??
    new AgentError("All operations failed", {
      code: "UNKNOWN_ERROR",
    })
  );
}

/**
 * Create a circuit breaker for error protection.
 *
 * Opens the circuit after threshold failures to prevent cascading failures.
 *
 * @param options - Circuit breaker options
 * @returns A function that wraps operations with circuit breaker protection
 *
 * @example
 * ```typescript
 * const breaker = createCircuitBreaker({
 *   failureThreshold: 5,
 *   resetTimeout: 60000,
 * });
 *
 * const result = await breaker(() => callExternalService());
 * ```
 *
 * @category Errors
 */
export function createCircuitBreaker(options: {
  failureThreshold?: number;
  resetTimeout?: number;
  onStateChange?: (state: "closed" | "open" | "half-open") => void;
}): <T>(fn: () => Promise<T>) => Promise<T> {
  const { failureThreshold = 5, resetTimeout = 60000, onStateChange } = options;

  let failures = 0;
  let state: "closed" | "open" | "half-open" = "closed";
  let lastFailureTime = 0;

  function setState(newState: "closed" | "open" | "half-open") {
    if (state !== newState) {
      state = newState;
      onStateChange?.(newState);
    }
  }

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    // Check if circuit should be opened
    if (state === "open") {
      if (Date.now() - lastFailureTime >= resetTimeout) {
        setState("half-open");
      } else {
        throw new AgentError("Circuit breaker is open", {
          code: "NETWORK_ERROR",
          userMessage: "Service temporarily unavailable. Please try again later.",
          retryable: true,
          retryAfterMs: Math.max(1000, resetTimeout - (Date.now() - lastFailureTime)),
        });
      }
    }

    try {
      const result = await fn();
      failures = 0;
      setState("closed");
      return result;
    } catch (error) {
      failures++;
      lastFailureTime = Date.now();

      if (failures >= failureThreshold) {
        setState("open");
      }

      throw error;
    }
  };
}
