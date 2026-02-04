/**
 * Structured Logging System.
 *
 * Provides a flexible, structured logging system with support for:
 * - Log levels (debug, info, warn, error)
 * - Structured context/metadata
 * - Custom formatters and transports
 * - Child loggers with inherited context
 *
 * @packageDocumentation
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Log levels in order of severity.
 *
 * @category Observability
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Numeric values for log levels, used for filtering.
 *
 * @internal
 */
export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * A structured log entry.
 *
 * @category Observability
 */
export interface LogEntry {
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** ISO timestamp */
  timestamp: string;
  /** Optional context/metadata */
  context?: Record<string, unknown>;
  /** Optional error object */
  error?: Error;
  /** Optional duration in milliseconds */
  durationMs?: number;
  /** Logger name/namespace */
  logger?: string;
}

/**
 * A transport writes log entries to a destination.
 *
 * @category Observability
 */
export interface LogTransport {
  /** Transport name for identification */
  name: string;
  /** Write a log entry */
  write(entry: LogEntry): void | Promise<void>;
  /** Optional flush for async transports */
  flush?(): void | Promise<void>;
  /** Optional close for cleanup */
  close?(): void | Promise<void>;
}

/**
 * A formatter converts log entries to strings.
 *
 * @category Observability
 */
export interface LogFormatter {
  /** Format a log entry to a string */
  format(entry: LogEntry): string;
}

/**
 * Options for creating a logger.
 *
 * @category Observability
 */
export interface LoggerOptions {
  /** Logger name/namespace */
  name?: string;
  /** Minimum log level to emit */
  level?: LogLevel;
  /** Transports to write to */
  transports?: LogTransport[];
  /** Base context to include in all log entries */
  context?: Record<string, unknown>;
  /** Custom formatter */
  formatter?: LogFormatter;
}

/**
 * A structured logger interface.
 *
 * @category Observability
 */
export interface Logger {
  /** Logger name */
  readonly name: string;
  /** Current log level */
  level: LogLevel;

  /** Log at debug level */
  debug(message: string, context?: Record<string, unknown>): void;
  /** Log at info level */
  info(message: string, context?: Record<string, unknown>): void;
  /** Log at warn level */
  warn(message: string, context?: Record<string, unknown>): void;
  /** Log at error level */
  error(
    message: string,
    errorOrContext?: Error | Record<string, unknown>,
    context?: Record<string, unknown>,
  ): void;

  /**
   * Log with explicit level.
   */
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void;

  /**
   * Create a child logger with additional context.
   */
  child(contextOrName: string | Record<string, unknown>): Logger;

  /**
   * Create a timed operation that logs duration.
   *
   * @example
   * ```typescript
   * const timer = logger.startTimer("api-call");
   * await fetch(url);
   * timer.end(); // logs with durationMs
   * ```
   */
  startTimer(operation: string, context?: Record<string, unknown>): LogTimer;

  /**
   * Flush all transports.
   */
  flush(): Promise<void>;

  /**
   * Close all transports.
   */
  close(): Promise<void>;
}

/**
 * A timer for measuring operation duration.
 *
 * @category Observability
 */
export interface LogTimer {
  /** End the timer and log the duration */
  end(context?: Record<string, unknown>): void;
  /** End with error */
  error(error: Error, context?: Record<string, unknown>): void;
}

// =============================================================================
// Formatters
// =============================================================================

/**
 * Creates a JSON formatter for structured logging.
 *
 * @returns A JSON formatter
 *
 * @example
 * ```typescript
 * const logger = createLogger({
 *   formatter: createJsonFormatter(),
 * });
 * ```
 *
 * @category Observability
 */
export function createJsonFormatter(): LogFormatter {
  return {
    format(entry: LogEntry): string {
      const output: Record<string, unknown> = {
        level: entry.level,
        message: entry.message,
        timestamp: entry.timestamp,
      };

      if (entry.logger) {
        output.logger = entry.logger;
      }

      if (entry.durationMs !== undefined) {
        output.durationMs = entry.durationMs;
      }

      if (entry.context && Object.keys(entry.context).length > 0) {
        output.context = entry.context;
      }

      if (entry.error) {
        output.error = {
          name: entry.error.name,
          message: entry.error.message,
          stack: entry.error.stack,
        };
      }

      return JSON.stringify(output);
    },
  };
}

/**
 * Creates a human-readable formatter with colors.
 *
 * @param options - Formatter options
 * @returns A pretty formatter
 *
 * @example
 * ```typescript
 * const logger = createLogger({
 *   formatter: createPrettyFormatter({ colors: true }),
 * });
 * ```
 *
 * @category Observability
 */
export function createPrettyFormatter(options?: {
  /** Enable ANSI colors */
  colors?: boolean;
  /** Include timestamp */
  timestamp?: boolean;
}): LogFormatter {
  const { colors = true, timestamp = true } = options ?? {};

  const COLORS = {
    debug: "\x1b[36m", // Cyan
    info: "\x1b[32m", // Green
    warn: "\x1b[33m", // Yellow
    error: "\x1b[31m", // Red
    reset: "\x1b[0m",
    dim: "\x1b[2m",
  };

  const LEVEL_LABELS: Record<LogLevel, string> = {
    debug: "DEBUG",
    info: "INFO ",
    warn: "WARN ",
    error: "ERROR",
  };

  return {
    format(entry: LogEntry): string {
      const parts: string[] = [];

      // Timestamp
      if (timestamp) {
        const ts = entry.timestamp.split("T")[1]?.replace("Z", "") ?? "";
        parts.push(colors ? `${COLORS.dim}${ts}${COLORS.reset}` : ts);
      }

      // Level
      const levelLabel = LEVEL_LABELS[entry.level];
      if (colors) {
        parts.push(`${COLORS[entry.level]}${levelLabel}${COLORS.reset}`);
      } else {
        parts.push(levelLabel);
      }

      // Logger name
      if (entry.logger) {
        parts.push(colors ? `${COLORS.dim}[${entry.logger}]${COLORS.reset}` : `[${entry.logger}]`);
      }

      // Message
      parts.push(entry.message);

      // Duration
      if (entry.durationMs !== undefined) {
        parts.push(
          colors
            ? `${COLORS.dim}(${entry.durationMs}ms)${COLORS.reset}`
            : `(${entry.durationMs}ms)`,
        );
      }

      // Context
      if (entry.context && Object.keys(entry.context).length > 0) {
        const contextStr = Object.entries(entry.context)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ");
        parts.push(colors ? `${COLORS.dim}${contextStr}${COLORS.reset}` : contextStr);
      }

      // Error
      if (entry.error) {
        parts.push(`\n${entry.error.stack ?? entry.error.message}`);
      }

      return parts.join(" ");
    },
  };
}

// =============================================================================
// Transports
// =============================================================================

/**
 * Creates a console transport.
 *
 * @param options - Transport options
 * @returns A console transport
 *
 * @example
 * ```typescript
 * const logger = createLogger({
 *   transports: [createConsoleTransport()],
 * });
 * ```
 *
 * @category Observability
 */
export function createConsoleTransport(options?: {
  /** Custom formatter */
  formatter?: LogFormatter;
  /** Output stream for each level */
  streams?: Partial<Record<LogLevel, (message: string) => void>>;
}): LogTransport {
  const formatter = options?.formatter ?? createPrettyFormatter();
  const streams = options?.streams ?? {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  return {
    name: "console",
    write(entry: LogEntry): void {
      const formatted = formatter.format(entry);
      const output = streams[entry.level] ?? console.log;
      output(formatted);
    },
  };
}

/**
 * Creates a memory transport that stores log entries.
 *
 * Useful for testing or collecting logs for later analysis.
 *
 * @param options - Transport options
 * @returns A memory transport with access to stored entries
 *
 * @example
 * ```typescript
 * const memoryTransport = createMemoryTransport({ maxEntries: 100 });
 * const logger = createLogger({ transports: [memoryTransport] });
 *
 * logger.info("Test");
 * console.log(memoryTransport.entries); // [{ level: "info", ... }]
 * ```
 *
 * @category Observability
 */
export function createMemoryTransport(options?: {
  /** Maximum entries to store (default: 1000) */
  maxEntries?: number;
}): LogTransport & { entries: LogEntry[]; clear(): void } {
  const maxEntries = options?.maxEntries ?? 1000;
  const entries: LogEntry[] = [];

  return {
    name: "memory",
    entries,
    write(entry: LogEntry): void {
      entries.push(entry);
      if (entries.length > maxEntries) {
        entries.shift();
      }
    },
    clear(): void {
      entries.length = 0;
    },
  };
}

/**
 * Creates a callback transport that invokes a function for each entry.
 *
 * @param callback - Function to call for each log entry
 * @returns A callback transport
 *
 * @example
 * ```typescript
 * const transport = createCallbackTransport((entry) => {
 *   sendToExternalService(entry);
 * });
 * ```
 *
 * @category Observability
 */
export function createCallbackTransport(
  callback: (entry: LogEntry) => void | Promise<void>,
): LogTransport {
  return {
    name: "callback",
    write: callback,
  };
}

/**
 * Creates a filtered transport that only passes entries matching criteria.
 *
 * @param transport - The underlying transport
 * @param filter - Filter function
 * @returns A filtered transport
 *
 * @example
 * ```typescript
 * // Only log errors
 * const errorTransport = createFilteredTransport(
 *   createConsoleTransport(),
 *   (entry) => entry.level === "error"
 * );
 * ```
 *
 * @category Observability
 */
export function createFilteredTransport(
  transport: LogTransport,
  filter: (entry: LogEntry) => boolean,
): LogTransport {
  return {
    name: `filtered:${transport.name}`,
    write(entry: LogEntry): void | Promise<void> {
      if (filter(entry)) {
        return transport.write(entry);
      }
    },
    flush: transport.flush,
    close: transport.close,
  };
}

// =============================================================================
// Logger Implementation
// =============================================================================

/**
 * Creates a structured logger.
 *
 * @param options - Logger options
 * @returns A logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger({
 *   name: "my-agent",
 *   level: "info",
 *   context: { version: "1.0.0" },
 * });
 *
 * logger.info("Agent started", { model: "claude-3" });
 * logger.debug("Debug info"); // Not logged (level is info)
 *
 * const childLogger = logger.child("tools");
 * childLogger.info("Tool called"); // Logs with logger="my-agent:tools"
 * ```
 *
 * @category Observability
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    name = "agent",
    level: initialLevel = "info",
    transports = [createConsoleTransport()],
    context: baseContext = {},
  } = options;

  let currentLevel = initialLevel;

  /**
   * Write an entry to all transports.
   */
  function writeEntry(entry: LogEntry): void {
    // Check level
    if (LOG_LEVEL_VALUES[entry.level] < LOG_LEVEL_VALUES[currentLevel]) {
      return;
    }

    // Merge base context
    const mergedEntry: LogEntry = {
      ...entry,
      context:
        Object.keys(baseContext).length > 0 ? { ...baseContext, ...entry.context } : entry.context,
    };

    // Write to all transports
    for (const transport of transports) {
      try {
        transport.write(mergedEntry);
      } catch {
        // Silently ignore transport errors to prevent logging loops
      }
    }
  }

  /**
   * Create a log entry.
   */
  function createEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error,
    durationMs?: number,
  ): LogEntry {
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      logger: name,
      context,
      error,
      durationMs,
    };
  }

  const logger: Logger = {
    name,

    get level(): LogLevel {
      return currentLevel;
    },
    set level(newLevel: LogLevel) {
      currentLevel = newLevel;
    },

    debug(message: string, context?: Record<string, unknown>): void {
      writeEntry(createEntry("debug", message, context));
    },

    info(message: string, context?: Record<string, unknown>): void {
      writeEntry(createEntry("info", message, context));
    },

    warn(message: string, context?: Record<string, unknown>): void {
      writeEntry(createEntry("warn", message, context));
    },

    error(
      message: string,
      errorOrContext?: Error | Record<string, unknown>,
      context?: Record<string, unknown>,
    ): void {
      if (errorOrContext instanceof Error) {
        writeEntry(createEntry("error", message, context, errorOrContext));
      } else {
        writeEntry(createEntry("error", message, errorOrContext));
      }
    },

    log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
      writeEntry(createEntry(level, message, context));
    },

    child(contextOrName: string | Record<string, unknown>): Logger {
      if (typeof contextOrName === "string") {
        return createLogger({
          name: `${name}:${contextOrName}`,
          level: currentLevel,
          transports,
          context: baseContext,
        });
      } else {
        return createLogger({
          name,
          level: currentLevel,
          transports,
          context: { ...baseContext, ...contextOrName },
        });
      }
    },

    startTimer(operation: string, context?: Record<string, unknown>): LogTimer {
      const startTime = Date.now();

      return {
        end(endContext?: Record<string, unknown>): void {
          const durationMs = Date.now() - startTime;
          writeEntry(
            createEntry("info", operation, { ...context, ...endContext }, undefined, durationMs),
          );
        },
        error(error: Error, errorContext?: Record<string, unknown>): void {
          const durationMs = Date.now() - startTime;
          writeEntry(
            createEntry(
              "error",
              `${operation} failed`,
              { ...context, ...errorContext },
              error,
              durationMs,
            ),
          );
        },
      };
    },

    async flush(): Promise<void> {
      await Promise.all(transports.map((t) => (t.flush ? t.flush() : Promise.resolve())));
    },

    async close(): Promise<void> {
      await Promise.all(transports.map((t) => (t.close ? t.close() : Promise.resolve())));
    },
  };

  return logger;
}

// =============================================================================
// Default Logger
// =============================================================================

/**
 * The default global logger instance.
 *
 * Can be used directly or replaced with a custom logger.
 *
 * @example
 * ```typescript
 * import { defaultLogger } from "@lleverage-ai/agent-sdk";
 *
 * defaultLogger.info("Application started");
 * ```
 *
 * @category Observability
 */
export let defaultLogger: Logger = createLogger({ name: "agent-sdk" });

/**
 * Sets the default global logger.
 *
 * @param logger - The logger to use as default
 *
 * @example
 * ```typescript
 * const customLogger = createLogger({
 *   name: "my-app",
 *   level: "debug",
 * });
 *
 * setDefaultLogger(customLogger);
 * ```
 *
 * @category Observability
 */
export function setDefaultLogger(logger: Logger): void {
  defaultLogger = logger;
}
