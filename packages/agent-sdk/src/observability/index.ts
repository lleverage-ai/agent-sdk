/**
 * Observability Module.
 *
 * Provides comprehensive observability features for the agent SDK:
 * - **Logging**: Structured logging with levels, formatters, and transports
 * - **Metrics**: Counters, gauges, histograms for performance tracking
 * - **Tracing**: OpenTelemetry-compatible distributed tracing
 * - **Hooks**: Pre-built hooks for integrating observability with agents
 *
 * @example
 * ```typescript
 * import {
 *   createLogger,
 *   createMetricsRegistry,
 *   createAgentMetrics,
 *   createTracer,
 *   createObservabilityHooks,
 *   registerObservabilityHooks,
 * } from "@lleverage-ai/agent-sdk";
 *
 * // Set up observability
 * const logger = createLogger({ name: "my-agent", level: "info" });
 * const registry = createMetricsRegistry();
 * const metrics = createAgentMetrics(registry);
 * const tracer = createTracer({
 *   name: "my-agent",
 *   exporters: [createConsoleSpanExporter()],
 * });
 *
 * // Create and register hooks
 * const observabilityHooks = createObservabilityHooks({
 *   logger,
 *   metrics,
 *   tracer,
 * });
 *
 * const hookManager = createHookManager();
 * registerObservabilityHooks(hookManager, observabilityHooks);
 *
 * // Create agent with observability
 * const agent = createAgent({
 *   model,
 *   hooks: hookManager,
 * });
 * ```
 *
 * @packageDocumentation
 */

// Events
export {
  createObservabilityEventHooks,
  createObservabilityEventStore,
  type EventExporterOptions,
  type EventSeverity,
  exportEventsJSONLines,
  exportEventsPrometheus,
  // Types
  type ObservabilityEvent,
  type ObservabilityEventStore,
  type ObservabilityEventStoreOptions,
  type StructuredEvent,
  // Functions
  toStructuredEvent,
} from "./events.js";
// Logger
export {
  createCallbackTransport,
  // Transports
  createConsoleTransport,
  createFilteredTransport,
  // Formatters
  createJsonFormatter,
  // Logger
  createLogger,
  createMemoryTransport,
  createPrettyFormatter,
  defaultLogger,
  LOG_LEVEL_VALUES,
  type LogEntry,
  type LogFormatter,
  type Logger,
  type LoggerOptions,
  // Types
  type LogLevel,
  type LogTimer,
  type LogTransport,
  setDefaultLogger,
} from "./logger.js";
// Metrics
export {
  type AgentMetrics,
  type Counter,
  // Agent Metrics
  createAgentMetrics,
  createCallbackMetricsExporter,
  // Exporters
  createConsoleMetricsExporter,
  createMemoryMetricsExporter,
  // Registry
  createMetricsRegistry,
  // Constants
  DEFAULT_LATENCY_BUCKETS,
  DEFAULT_TOKEN_BUCKETS,
  defaultMetricsRegistry,
  type Gauge,
  type Histogram,
  type HistogramBucket,
  type HistogramData,
  type MetricLabels,
  type MetricPoint,
  type MetricsExporter,
  type MetricsRegistry,
  type MetricsRegistryOptions,
  // Types
  type MetricType,
  setDefaultMetricsRegistry,
} from "./metrics.js";
// Preset
export {
  createObservabilityPreset,
  type ObservabilityPreset,
  type ObservabilityPresetOptions,
} from "./preset.js";

// Streaming
export {
  // Factories
  createStreamingLogTransport,
  createStreamingObservability,
  // Types
  type StreamingLogTransportOptions,
  type StreamingObservabilityOptions,
} from "./streaming.js";

// Tracing
export {
  createCallbackSpanExporter,
  // Exporters
  createConsoleSpanExporter,
  createMemorySpanExporter,
  createOTLPSpanExporter,
  // Tracer
  createTracer,
  // Default
  defaultTracer,
  // Semantic Conventions
  SemanticAttributes,
  type Span,
  type SpanAttributes,
  type SpanContext,
  type SpanData,
  type SpanEvent,
  type SpanExporter,
  type SpanKind,
  type SpanLink,
  type SpanStatus,
  // Types
  type SpanStatusCode,
  type StartSpanOptions,
  setDefaultTracer,
  type Tracer,
  type TracerOptions,
} from "./tracing.js";
