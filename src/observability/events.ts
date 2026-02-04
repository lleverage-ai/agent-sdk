/**
 * Observability event types and exporters for MCP and tool registry lifecycle events.
 *
 * @packageDocumentation
 */

import type {
  MCPConnectionFailedInput,
  MCPConnectionRestoredInput,
  PostCompactInput,
  PreCompactInput,
  ToolLoadErrorInput,
  ToolRegisteredInput,
} from "../types.js";

/**
 * Union type of all observability events.
 * @category Observability
 */
export type ObservabilityEvent =
  | MCPConnectionFailedInput
  | MCPConnectionRestoredInput
  | ToolRegisteredInput
  | ToolLoadErrorInput
  | PreCompactInput
  | PostCompactInput;

/**
 * Event severity levels for alerting.
 * @category Observability
 */
export type EventSeverity = "info" | "warning" | "error" | "critical";

/**
 * Structured event for export with standardized fields.
 * @category Observability
 */
export interface StructuredEvent {
  /** Timestamp in ISO format */
  timestamp: string;

  /** Event type */
  event_type: string;

  /** Severity level */
  severity: EventSeverity;

  /** Human-readable message */
  message: string;

  /** Structured metadata */
  metadata: Record<string, unknown>;

  /** Session ID (if available) */
  session_id?: string;
}

/**
 * Options for event exporters.
 * @category Observability
 */
export interface EventExporterOptions {
  /** Minimum severity to export */
  minSeverity?: EventSeverity;

  /** Whether to include full error stack traces */
  includeStackTraces?: boolean;
}

/**
 * Convert an observability event to a structured event.
 *
 * @param event - The hook input event
 * @returns Structured event ready for export
 *
 * @category Observability
 */
export function toStructuredEvent(event: ObservabilityEvent): StructuredEvent {
  const timestamp = new Date().toISOString();

  switch (event.hook_event_name) {
    case "MCPConnectionFailed": {
      return {
        timestamp,
        event_type: "mcp_connection_failed",
        severity: "error",
        message: `MCP server '${event.server_name}' failed to connect: ${event.error.message}`,
        metadata: {
          server_name: event.server_name,
          config_type: event.config.type,
          error_name: event.error.name,
          error_message: event.error.message,
        },
        session_id: event.session_id,
      };
    }

    case "MCPConnectionRestored": {
      return {
        timestamp,
        event_type: "mcp_connection_restored",
        severity: "info",
        message: `MCP server '${event.server_name}' connected successfully with ${event.tool_count} tools`,
        metadata: {
          server_name: event.server_name,
          tool_count: event.tool_count,
        },
        session_id: event.session_id,
      };
    }

    case "ToolRegistered": {
      return {
        timestamp,
        event_type: "tool_registered",
        severity: "info",
        message: `Tool '${event.tool_name}' registered${event.source ? ` from ${event.source}` : ""}`,
        metadata: {
          tool_name: event.tool_name,
          description: event.description,
          source: event.source,
        },
        session_id: event.session_id,
      };
    }

    case "ToolLoadError": {
      return {
        timestamp,
        event_type: "tool_load_error",
        severity: "warning",
        message: `Failed to load tool '${event.tool_name}': ${event.error.message}`,
        metadata: {
          tool_name: event.tool_name,
          error_name: event.error.name,
          error_message: event.error.message,
          source: event.source,
        },
        session_id: event.session_id,
      };
    }

    case "PreCompact": {
      return {
        timestamp,
        event_type: "context_compaction_started",
        severity: "info",
        message: `Context compaction started: ${event.message_count} messages, ${event.tokens_before} tokens`,
        metadata: {
          message_count: event.message_count,
          tokens_before: event.tokens_before,
        },
        session_id: event.session_id,
      };
    }

    case "PostCompact": {
      const reductionPercent =
        event.tokens_before > 0
          ? ((event.tokens_saved / event.tokens_before) * 100).toFixed(1)
          : "0.0";
      return {
        timestamp,
        event_type: "context_compaction_completed",
        severity: "info",
        message: `Context compaction completed: ${event.messages_before} → ${event.messages_after} messages, saved ${event.tokens_saved} tokens (${reductionPercent}%)`,
        metadata: {
          messages_before: event.messages_before,
          messages_after: event.messages_after,
          tokens_before: event.tokens_before,
          tokens_after: event.tokens_after,
          tokens_saved: event.tokens_saved,
          reduction_percent: Number.parseFloat(reductionPercent),
        },
        session_id: event.session_id,
      };
    }
  }
}

/**
 * Export events as JSON Lines format for log aggregation tools.
 *
 * @param events - Array of observability events
 * @param options - Export options
 * @returns JSON Lines string (one JSON object per line)
 *
 * @example
 * ```typescript
 * const events = [mcpFailedEvent, toolRegisteredEvent];
 * const jsonl = exportEventsJSONLines(events);
 * await fs.writeFile("events.jsonl", jsonl);
 * ```
 *
 * @category Observability
 */
export function exportEventsJSONLines(
  events: ObservabilityEvent[],
  options: EventExporterOptions = {},
): string {
  const { minSeverity = "info" } = options;
  const severityLevels = ["info", "warning", "error", "critical"];
  const minLevel = severityLevels.indexOf(minSeverity);

  return events
    .map((event) => {
      const structured = toStructuredEvent(event);

      // Filter by severity
      const eventLevel = severityLevels.indexOf(structured.severity);
      if (eventLevel < minLevel) {
        return null;
      }

      return JSON.stringify(structured);
    })
    .filter((line): line is string => line !== null)
    .join("\n");
}

/**
 * Export events in a format suitable for Prometheus/OpenMetrics.
 *
 * @param events - Array of observability events
 * @returns Metrics in Prometheus text format
 *
 * @example
 * ```typescript
 * const events = [mcpFailedEvent, mcpRestoredEvent];
 * const metrics = exportEventsPrometheus(events);
 * // Send to Pushgateway or expose via /metrics endpoint
 * ```
 *
 * @category Observability
 */
export function exportEventsPrometheus(events: ObservabilityEvent[]): string {
  const metrics: Map<string, number> = new Map();

  for (const event of events) {
    switch (event.hook_event_name) {
      case "MCPConnectionFailed": {
        const key = `mcp_connection_failures_total{server="${event.server_name}"}`;
        metrics.set(key, (metrics.get(key) ?? 0) + 1);
        break;
      }

      case "MCPConnectionRestored": {
        const key = `mcp_connections_total{server="${event.server_name}"}`;
        metrics.set(key, (metrics.get(key) ?? 0) + 1);

        const toolKey = `mcp_tools_available{server="${event.server_name}"}`;
        metrics.set(toolKey, event.tool_count);
        break;
      }

      case "ToolRegistered": {
        const source = event.source ?? "unknown";
        const key = `tools_registered_total{source="${source}"}`;
        metrics.set(key, (metrics.get(key) ?? 0) + 1);
        break;
      }

      case "ToolLoadError": {
        const source = event.source ?? "unknown";
        const key = `tool_load_errors_total{source="${source}"}`;
        metrics.set(key, (metrics.get(key) ?? 0) + 1);
        break;
      }

      case "PreCompact": {
        // Track compaction starts (for in-progress monitoring)
        const key = `context_compactions_started_total`;
        metrics.set(key, (metrics.get(key) ?? 0) + 1);
        break;
      }

      case "PostCompact": {
        // Track completed compactions
        const compactKey = `context_compactions_total`;
        metrics.set(compactKey, (metrics.get(compactKey) ?? 0) + 1);

        // Track tokens saved
        const tokensSavedKey = `context_compaction_tokens_saved_total`;
        metrics.set(tokensSavedKey, (metrics.get(tokensSavedKey) ?? 0) + event.tokens_saved);

        // Track messages compacted
        const messagesCompactedKey = `context_compaction_messages_removed_total`;
        const messagesRemoved = event.messages_before - event.messages_after;
        metrics.set(
          messagesCompactedKey,
          (metrics.get(messagesCompactedKey) ?? 0) + messagesRemoved,
        );
        break;
      }
    }
  }

  const lines: string[] = [];

  for (const [metric, value] of metrics) {
    lines.push(`${metric} ${value}`);
  }

  return lines.join("\n");
}

/**
 * In-memory store for collecting observability events.
 *
 * @example
 * ```typescript
 * const store = createObservabilityEventStore({ maxSize: 1000 });
 *
 * // Add events
 * store.add(mcpFailedEvent);
 * store.add(toolRegisteredEvent);
 *
 * // Export periodically
 * setInterval(() => {
 *   const jsonl = exportEventsJSONLines(store.getAll());
 *   await sendToLogAggregator(jsonl);
 *   store.clear();
 * }, 60000);
 * ```
 *
 * @category Observability
 */
export interface ObservabilityEventStore {
  /** Add an event to the store */
  add: (event: ObservabilityEvent) => void;

  /** Get all events */
  getAll: () => ObservabilityEvent[];

  /** Get events by type */
  getByType: (type: ObservabilityEvent["hook_event_name"]) => ObservabilityEvent[];

  /** Clear all events */
  clear: () => void;

  /** Get current event count */
  size: () => number;
}

/**
 * Options for creating an observability event store.
 * @category Observability
 */
export interface ObservabilityEventStoreOptions {
  /** Maximum number of events to store (LRU eviction) */
  maxSize?: number;
}

/**
 * Create an in-memory observability event store.
 *
 * @param options - Store configuration
 * @returns Event store instance
 *
 * @category Observability
 */
export function createObservabilityEventStore(
  options: ObservabilityEventStoreOptions = {},
): ObservabilityEventStore {
  const { maxSize = 10000 } = options;
  const events: ObservabilityEvent[] = [];

  return {
    add: (event) => {
      events.push(event);

      // LRU eviction
      if (events.length > maxSize) {
        events.shift();
      }
    },

    getAll: () => [...events],

    getByType: (type) => events.filter((e) => e.hook_event_name === type),

    clear: () => {
      events.length = 0;
    },

    size: () => events.length,
  };
}

/**
 * Create hooks for collecting observability events.
 *
 * @param store - Event store to collect events in
 * @returns Hook callbacks for all observability event types
 *
 * @example
 * ```typescript
 * const store = createObservabilityEventStore();
 * const hooks = createObservabilityEventHooks(store);
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     MCPConnectionFailed: hooks.MCPConnectionFailed,
 *     MCPConnectionRestored: hooks.MCPConnectionRestored,
 *     ToolRegistered: hooks.ToolRegistered,
 *     ToolLoadError: hooks.ToolLoadError,
 *     PreCompact: hooks.PreCompact,
 *     PostCompact: hooks.PostCompact,
 *   },
 * });
 * ```
 *
 * @category Observability
 */
export function createObservabilityEventHooks(store: ObservabilityEventStore) {
  return {
    MCPConnectionFailed: [
      async (input: MCPConnectionFailedInput): Promise<{ continue: boolean }> => {
        store.add(input);
        return { continue: true };
      },
    ],

    MCPConnectionRestored: [
      async (input: MCPConnectionRestoredInput): Promise<{ continue: boolean }> => {
        store.add(input);
        return { continue: true };
      },
    ],

    ToolRegistered: [
      async (input: ToolRegisteredInput): Promise<{ continue: boolean }> => {
        store.add(input);
        return { continue: true };
      },
    ],

    ToolLoadError: [
      async (input: ToolLoadErrorInput): Promise<{ continue: boolean }> => {
        store.add(input);
        return { continue: true };
      },
    ],

    PreCompact: [
      async (input: PreCompactInput): Promise<{ continue: boolean }> => {
        store.add(input);
        return { continue: true };
      },
    ],

    PostCompact: [
      async (input: PostCompactInput): Promise<{ continue: boolean }> => {
        store.add(input);
        return { continue: true };
      },
    ],
  };
}
