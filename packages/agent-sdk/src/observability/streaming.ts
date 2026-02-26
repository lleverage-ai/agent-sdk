/**
 * Streaming Observability Support.
 *
 * Provides transports and utilities for streaming observability data
 * (logs, metrics, traces) to clients via the data stream.
 *
 * @packageDocumentation
 */

import type { UIMessageStreamWriter } from "ai";
import type { LogEntry, LogFormatter, LogTransport } from "./logger.js";

/**
 * Options for creating a streaming log transport.
 *
 * @category Observability
 */
export interface StreamingLogTransportOptions {
  /**
   * The UI message stream writer to send logs to.
   */
  writer: UIMessageStreamWriter;

  /**
   * Optional formatter for converting log entries to data.
   * If not provided, logs are sent as structured objects.
   */
  formatter?: LogFormatter;

  /**
   * The data type to use when sending logs.
   * @default "log"
   */
  dataType?: string;

  /**
   * Whether to include the raw log entry object.
   * @default true
   */
  includeRawEntry?: boolean;
}

/**
 * Creates a log transport that streams logs to clients via the data stream.
 *
 * This transport is designed to be used with `streamDataResponse()` to send
 * real-time log data to the frontend.
 *
 * @param options - Transport options
 * @returns A log transport that writes to the data stream
 *
 * @example
 * ```typescript
 * import { createStreamingLogTransport } from "@lleverage-ai/agent-sdk";
 *
 * // In streamDataResponse execute function:
 * const streamingContext: StreamingContext = { writer };
 *
 * const streamingTransport = createStreamingLogTransport({
 *   writer: streamingContext.writer,
 * });
 *
 * const logger = createLogger({
 *   name: "agent",
 *   transports: [streamingTransport],
 * });
 *
 * // Logs will be streamed to the frontend
 * logger.info("Agent started");
 * ```
 *
 * @category Observability
 */
export function createStreamingLogTransport(options: StreamingLogTransportOptions): LogTransport {
  const { writer, formatter, dataType = "log", includeRawEntry = true } = options;

  return {
    name: "streaming",
    write(entry: LogEntry): void {
      // Build the data payload
      const payload: Record<string, unknown> = {
        type: dataType,
      };

      if (includeRawEntry) {
        // Send the full entry for rich client-side handling
        payload.entry = {
          level: entry.level,
          message: entry.message,
          timestamp: entry.timestamp,
          logger: entry.logger,
          context: entry.context,
          durationMs: entry.durationMs,
          // Serialize error if present
          error: entry.error
            ? {
                name: entry.error.name,
                message: entry.error.message,
                stack: entry.error.stack,
              }
            : undefined,
        };
      }

      if (formatter) {
        // Also include formatted text if a formatter is provided
        payload.formatted = formatter.format(entry);
      }

      // Write to the data stream
      // Use type assertion to bypass strict stream part type checking
      // This follows the same pattern as task.ts for custom data streaming
      writer.write({
        type: "data-log",
        data: payload,
      } as Parameters<typeof writer.write>[0]);
    },
  };
}

/**
 * Options for creating observability streaming support.
 *
 * @category Observability
 */
export interface StreamingObservabilityOptions {
  /**
   * The UI message stream writer.
   */
  writer: UIMessageStreamWriter;

  /**
   * Whether to stream logs.
   * @default true
   */
  streamLogs?: boolean;

  /**
   * Log formatter to use.
   */
  logFormatter?: LogFormatter;
}

/**
 * Creates a complete streaming observability setup.
 *
 * Returns transports configured to stream observability data to clients.
 *
 * @param options - Streaming options
 * @returns An object with configured transports
 *
 * @example
 * ```typescript
 * const { logTransport } = createStreamingObservability({
 *   writer: streamingContext.writer,
 * });
 *
 * const logger = createLogger({
 *   transports: [logTransport],
 * });
 * ```
 *
 * @category Observability
 */
export function createStreamingObservability(options: StreamingObservabilityOptions): {
  logTransport: LogTransport | null;
} {
  const { writer, streamLogs = true, logFormatter } = options;

  return {
    logTransport: streamLogs
      ? createStreamingLogTransport({
          writer,
          formatter: logFormatter,
        })
      : null,
  };
}
