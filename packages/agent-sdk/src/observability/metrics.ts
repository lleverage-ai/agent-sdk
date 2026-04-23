/**
 * Metrics Collection System.
 *
 * Provides a flexible metrics system for tracking:
 * - Token usage (input/output tokens)
 * - Latency (request duration)
 * - Error rates
 * - Custom counters, gauges, and histograms
 *
 * @packageDocumentation
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Metric types supported by the system.
 *
 * @category Observability
 */
export type MetricType = "counter" | "gauge" | "histogram";

/**
 * Labels/tags for metrics.
 *
 * @category Observability
 */
export type MetricLabels = Record<string, string>;

/**
 * A single metric data point.
 *
 * @category Observability
 */
export interface MetricPoint {
  /** Metric name */
  name: string;
  /** Metric type */
  type: MetricType;
  /** Metric value */
  value: number;
  /** Labels/tags */
  labels: MetricLabels;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Histogram bucket definition.
 *
 * @category Observability
 */
export interface HistogramBucket {
  /** Upper bound */
  le: number;
  /** Count of observations <= le */
  count: number;
}

/**
 * Histogram metric data.
 *
 * @category Observability
 */
export interface HistogramData {
  /** Bucket counts */
  buckets: HistogramBucket[];
  /** Total sum of all observations */
  sum: number;
  /** Total count of observations */
  count: number;
}

/**
 * A counter metric that can only increase.
 *
 * @category Observability
 */
export interface Counter {
  /** Increment the counter */
  inc(value?: number, labels?: MetricLabels): void;
  /** Get current value */
  get(labels?: MetricLabels): number;
  /** Reset to zero */
  reset(labels?: MetricLabels): void;
}

/**
 * A gauge metric that can go up and down.
 *
 * @category Observability
 */
export interface Gauge {
  /** Set the gauge value */
  set(value: number, labels?: MetricLabels): void;
  /** Increment the gauge */
  inc(value?: number, labels?: MetricLabels): void;
  /** Decrement the gauge */
  dec(value?: number, labels?: MetricLabels): void;
  /** Get current value */
  get(labels?: MetricLabels): number;
}

/**
 * A histogram metric for measuring distributions.
 *
 * @category Observability
 */
export interface Histogram {
  /** Observe a value */
  observe(value: number, labels?: MetricLabels): void;
  /** Get histogram data */
  get(labels?: MetricLabels): HistogramData;
  /** Start a timer that observes duration when stopped */
  startTimer(labels?: MetricLabels): () => number;
  /** Reset the histogram */
  reset(labels?: MetricLabels): void;
}

/**
 * A metrics exporter sends metrics to an external system.
 *
 * @category Observability
 */
export interface MetricsExporter {
  /** Exporter name */
  name: string;
  /** Export metrics */
  export(metrics: MetricPoint[]): void | Promise<void>;
  /** Optional flush for batch exporters */
  flush?(): void | Promise<void>;
  /** Optional close for cleanup */
  close?(): void | Promise<void>;
}

/**
 * Options for creating a metrics registry.
 *
 * @category Observability
 */
export interface MetricsRegistryOptions {
  /** Default labels for all metrics */
  defaultLabels?: MetricLabels;
  /** Exporters to send metrics to */
  exporters?: MetricsExporter[];
  /** Export interval in milliseconds (0 = manual only) */
  exportInterval?: number;
  /** Prefix for all metric names */
  prefix?: string;
}

/**
 * A registry for managing metrics.
 *
 * @category Observability
 */
export interface MetricsRegistry {
  /** Create or get a counter */
  counter(name: string, description?: string): Counter;
  /** Create or get a gauge */
  gauge(name: string, description?: string): Gauge;
  /** Create or get a histogram */
  histogram(name: string, buckets?: number[], description?: string): Histogram;
  /** Get all current metric values */
  getMetrics(): MetricPoint[];
  /** Export metrics to all exporters */
  export(): Promise<void>;
  /** Close the registry and exporters */
  close(): Promise<void>;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Serialize labels to a string key.
 * @internal
 */
function labelsToKey(labels: MetricLabels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join(",");
}

/**
 * Default histogram buckets (latency in ms).
 */
export const DEFAULT_LATENCY_BUCKETS = [
  5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 10000,
];

/**
 * Default histogram buckets for token counts.
 */
export const DEFAULT_TOKEN_BUCKETS = [
  10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000,
];

// =============================================================================
// Implementation
// =============================================================================

/**
 * Creates a counter metric.
 *
 * @internal
 */
function createCounter(name: string, defaultLabels: MetricLabels): Counter {
  const values = new Map<string, number>();

  return {
    inc(value = 1, labels = {}): void {
      const key = labelsToKey({ ...defaultLabels, ...labels });
      values.set(key, (values.get(key) ?? 0) + value);
    },
    get(labels = {}): number {
      const key = labelsToKey({ ...defaultLabels, ...labels });
      return values.get(key) ?? 0;
    },
    reset(labels = {}): void {
      const key = labelsToKey({ ...defaultLabels, ...labels });
      values.delete(key);
    },
  };
}

/**
 * Creates a gauge metric.
 *
 * @internal
 */
function createGauge(name: string, defaultLabels: MetricLabels): Gauge {
  const values = new Map<string, number>();

  return {
    set(value: number, labels = {}): void {
      const key = labelsToKey({ ...defaultLabels, ...labels });
      values.set(key, value);
    },
    inc(value = 1, labels = {}): void {
      const key = labelsToKey({ ...defaultLabels, ...labels });
      values.set(key, (values.get(key) ?? 0) + value);
    },
    dec(value = 1, labels = {}): void {
      const key = labelsToKey({ ...defaultLabels, ...labels });
      values.set(key, (values.get(key) ?? 0) - value);
    },
    get(labels = {}): number {
      const key = labelsToKey({ ...defaultLabels, ...labels });
      return values.get(key) ?? 0;
    },
  };
}

/**
 * Creates a histogram metric.
 *
 * @internal
 */
function createHistogram(name: string, buckets: number[], defaultLabels: MetricLabels): Histogram {
  const sortedBuckets = [...buckets].sort((a, b) => a - b);
  const data = new Map<string, { bucketCounts: number[]; sum: number; count: number }>();

  function getData(labels: MetricLabels): { bucketCounts: number[]; sum: number; count: number } {
    const key = labelsToKey({ ...defaultLabels, ...labels });
    let entry = data.get(key);
    if (!entry) {
      entry = {
        bucketCounts: new Array(sortedBuckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      data.set(key, entry);
    }
    return entry;
  }

  return {
    observe(value: number, labels = {}): void {
      const d = getData(labels);
      d.sum += value;
      d.count += 1;
      for (let i = 0; i < sortedBuckets.length; i++) {
        if (value <= sortedBuckets[i]!) {
          d.bucketCounts[i] = (d.bucketCounts[i] ?? 0) + 1;
        }
      }
    },
    get(labels = {}): HistogramData {
      const d = getData(labels);
      return {
        buckets: sortedBuckets.map((le, i) => ({
          le,
          count: d.bucketCounts[i] ?? 0,
        })),
        sum: d.sum,
        count: d.count,
      };
    },
    startTimer(labels = {}): () => number {
      const start = Date.now();
      return () => {
        const duration = Date.now() - start;
        this.observe(duration, labels);
        return duration;
      };
    },
    reset(labels = {}): void {
      const key = labelsToKey({ ...defaultLabels, ...labels });
      data.delete(key);
    },
  };
}

/**
 * Creates a metrics registry.
 *
 * @param options - Registry options
 * @returns A metrics registry
 *
 * @example
 * ```typescript
 * const registry = createMetricsRegistry({
 *   defaultLabels: { service: "my-agent" },
 * });
 *
 * const requestCounter = registry.counter("requests_total");
 * const latencyHistogram = registry.histogram("request_duration_ms");
 *
 * requestCounter.inc();
 * latencyHistogram.observe(150);
 * ```
 *
 * @category Observability
 */
export function createMetricsRegistry(options: MetricsRegistryOptions = {}): MetricsRegistry {
  const { defaultLabels = {}, exporters = [], exportInterval = 0, prefix = "" } = options;

  const counters = new Map<string, { counter: Counter; description?: string }>();
  const gauges = new Map<string, { gauge: Gauge; description?: string }>();
  const histograms = new Map<
    string,
    { histogram: Histogram; buckets: number[]; description?: string }
  >();

  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  // Start export interval if configured
  if (exportInterval > 0 && exporters.length > 0) {
    intervalHandle = setInterval(async () => {
      await registry.export();
    }, exportInterval);
  }

  function prefixName(name: string): string {
    return prefix ? `${prefix}_${name}` : name;
  }

  const registry: MetricsRegistry = {
    counter(name: string, description?: string): Counter {
      const prefixedName = prefixName(name);
      let entry = counters.get(prefixedName);
      if (!entry) {
        entry = {
          counter: createCounter(prefixedName, defaultLabels),
          description,
        };
        counters.set(prefixedName, entry);
      }
      return entry.counter;
    },

    gauge(name: string, description?: string): Gauge {
      const prefixedName = prefixName(name);
      let entry = gauges.get(prefixedName);
      if (!entry) {
        entry = {
          gauge: createGauge(prefixedName, defaultLabels),
          description,
        };
        gauges.set(prefixedName, entry);
      }
      return entry.gauge;
    },

    histogram(
      name: string,
      buckets: number[] = DEFAULT_LATENCY_BUCKETS,
      description?: string,
    ): Histogram {
      const prefixedName = prefixName(name);
      let entry = histograms.get(prefixedName);
      if (!entry) {
        entry = {
          histogram: createHistogram(prefixedName, buckets, defaultLabels),
          buckets,
          description,
        };
        histograms.set(prefixedName, entry);
      }
      return entry.histogram;
    },

    getMetrics(): MetricPoint[] {
      const points: MetricPoint[] = [];
      const timestamp = new Date().toISOString();

      // Collect counter values
      for (const [name, { counter }] of counters) {
        const value = counter.get();
        points.push({
          name,
          type: "counter",
          value,
          labels: { ...defaultLabels },
          timestamp,
        });
      }

      // Collect gauge values
      for (const [name, { gauge }] of gauges) {
        const value = gauge.get();
        points.push({
          name,
          type: "gauge",
          value,
          labels: { ...defaultLabels },
          timestamp,
        });
      }

      // Collect histogram values
      for (const [name, { histogram }] of histograms) {
        const data = histogram.get();
        // Export sum and count
        points.push({
          name: `${name}_sum`,
          type: "histogram",
          value: data.sum,
          labels: { ...defaultLabels },
          timestamp,
        });
        points.push({
          name: `${name}_count`,
          type: "histogram",
          value: data.count,
          labels: { ...defaultLabels },
          timestamp,
        });
        // Export buckets
        for (const bucket of data.buckets) {
          points.push({
            name: `${name}_bucket`,
            type: "histogram",
            value: bucket.count,
            labels: { ...defaultLabels, le: String(bucket.le) },
            timestamp,
          });
        }
      }

      return points;
    },

    async export(): Promise<void> {
      const metrics = this.getMetrics();
      await Promise.all(
        exporters.map((e) =>
          Promise.resolve(e.export(metrics)).catch(() => {
            // Silently ignore export errors
          }),
        ),
      );
    },

    async close(): Promise<void> {
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      await Promise.all(
        exporters.map((e) =>
          e.close ? Promise.resolve(e.close()).catch(() => {}) : Promise.resolve(),
        ),
      );
    },
  };

  return registry;
}

// =============================================================================
// Exporters
// =============================================================================

/**
 * Creates a console exporter for debugging.
 *
 * @returns A console exporter
 *
 * @example
 * ```typescript
 * const registry = createMetricsRegistry({
 *   exporters: [createConsoleMetricsExporter()],
 * });
 * ```
 *
 * @category Observability
 */
export function createConsoleMetricsExporter(): MetricsExporter {
  return {
    name: "console",
    export(metrics: MetricPoint[]): void {
      console.log("[Metrics]", JSON.stringify(metrics, null, 2));
    },
  };
}

/**
 * Creates a memory exporter that stores metrics.
 *
 * @returns A memory exporter with access to stored metrics
 *
 * @example
 * ```typescript
 * const exporter = createMemoryMetricsExporter();
 * const registry = createMetricsRegistry({ exporters: [exporter] });
 *
 * registry.counter("test").inc();
 * await registry.export();
 *
 * console.log(exporter.metrics);
 * ```
 *
 * @category Observability
 */
export function createMemoryMetricsExporter(): MetricsExporter & {
  metrics: MetricPoint[];
  clear(): void;
} {
  const metrics: MetricPoint[] = [];

  return {
    name: "memory",
    metrics,
    export(points: MetricPoint[]): void {
      metrics.push(...points);
    },
    clear(): void {
      metrics.length = 0;
    },
  };
}

/**
 * Creates a callback exporter that invokes a function for each export.
 *
 * @param callback - Function to call with metrics
 * @returns A callback exporter
 *
 * @example
 * ```typescript
 * const exporter = createCallbackMetricsExporter((metrics) => {
 *   sendToPrometheus(metrics);
 * });
 * ```
 *
 * @category Observability
 */
export function createCallbackMetricsExporter(
  callback: (metrics: MetricPoint[]) => void | Promise<void>,
): MetricsExporter {
  return {
    name: "callback",
    export: callback,
  };
}

// =============================================================================
// Agent-Specific Metrics
// =============================================================================

/**
 * Pre-defined metrics for agent SDK.
 *
 * @category Observability
 */
export interface AgentMetrics {
  /** Total requests made */
  requestsTotal: Counter;
  /** Requests in progress */
  requestsInProgress: Gauge;
  /** Request duration in milliseconds */
  requestDurationMs: Histogram;
  /** Input tokens used */
  inputTokensTotal: Counter;
  /** Output tokens used */
  outputTokensTotal: Counter;
  /** Total tokens used */
  tokensTotal: Counter;
  /** Tool calls made */
  toolCallsTotal: Counter;
  /** Tool execution duration in milliseconds */
  toolDurationMs: Histogram;
  /** Tool call errors */
  toolErrorsTotal: Counter;
  /** Subagent spawns */
  subagentSpawnsTotal: Counter;
  /** Errors by type */
  errorsTotal: Counter;
  /** Retry attempts by classification */
  retryAttemptsTotal: Counter;
  /** Rate-limit errors */
  rateLimitErrorsTotal: Counter;
  /** Context compactions */
  compactionsTotal: Counter;
  /** Context compaction duration in milliseconds */
  compactionDurationMs: Histogram;
  /** Prompt cache write tokens */
  cacheCreationInputTokensTotal: Counter;
  /** Prompt cache read tokens */
  cacheReadInputTokensTotal: Counter;
  /** Streaming time-to-first-token in milliseconds */
  streamTimeToFirstTokenMs: Histogram;
  /** Streaming output throughput in tokens/sec */
  streamOutputTokensPerSecond: Histogram;
  /** Checkpoint operations */
  checkpointsTotal: Counter;
}

/**
 * Creates pre-defined agent metrics.
 *
 * @param registry - The metrics registry to use
 * @returns Agent metrics object
 *
 * @example
 * ```typescript
 * const registry = createMetricsRegistry();
 * const metrics = createAgentMetrics(registry);
 *
 * // Use in agent hooks
 * hooks.on("PostGenerate", (ctx) => {
 *   metrics.requestsTotal.inc({ model: "claude-3" });
 *   if (ctx.data.type === "PostGenerate" && ctx.data.result.usage) {
 *     metrics.inputTokensTotal.inc(ctx.data.result.usage.inputTokens);
 *     metrics.outputTokensTotal.inc(ctx.data.result.usage.outputTokens);
 *   }
 * });
 * ```
 *
 * @category Observability
 */
export function createAgentMetrics(registry: MetricsRegistry): AgentMetrics {
  return {
    requestsTotal: registry.counter("agent_requests_total", "Total number of agent requests"),
    requestsInProgress: registry.gauge(
      "agent_requests_in_progress",
      "Number of requests currently in progress",
    ),
    requestDurationMs: registry.histogram(
      "agent_request_duration_ms",
      DEFAULT_LATENCY_BUCKETS,
      "Request duration in milliseconds",
    ),
    inputTokensTotal: registry.counter("agent_input_tokens_total", "Total input tokens used"),
    outputTokensTotal: registry.counter("agent_output_tokens_total", "Total output tokens used"),
    tokensTotal: registry.counter("agent_tokens_total", "Total tokens used (input + output)"),
    toolCallsTotal: registry.counter("agent_tool_calls_total", "Total tool calls made"),
    toolDurationMs: registry.histogram(
      "agent_tool_duration_ms",
      DEFAULT_LATENCY_BUCKETS,
      "Tool execution duration in milliseconds",
    ),
    toolErrorsTotal: registry.counter("agent_tool_errors_total", "Total tool call errors"),
    subagentSpawnsTotal: registry.counter("agent_subagent_spawns_total", "Total subagent spawns"),
    errorsTotal: registry.counter("agent_errors_total", "Total errors by type"),
    retryAttemptsTotal: registry.counter("agent_retry_attempts_total", "Total retry attempts"),
    rateLimitErrorsTotal: registry.counter(
      "agent_rate_limit_errors_total",
      'Total rate-limit errors (only incremented for subtype === "rate_limit")',
    ),
    compactionsTotal: registry.counter("agent_compactions_total", "Total context compactions"),
    compactionDurationMs: registry.histogram(
      "agent_compaction_duration_ms",
      DEFAULT_LATENCY_BUCKETS,
      "Context compaction duration in milliseconds",
    ),
    cacheCreationInputTokensTotal: registry.counter(
      "agent_cache_creation_input_tokens_total",
      "Total prompt-cache write tokens",
    ),
    cacheReadInputTokensTotal: registry.counter(
      "agent_cache_read_input_tokens_total",
      "Total prompt-cache read tokens",
    ),
    streamTimeToFirstTokenMs: registry.histogram(
      "agent_stream_ttft_ms",
      DEFAULT_LATENCY_BUCKETS,
      "Streaming time-to-first-token in milliseconds",
    ),
    streamOutputTokensPerSecond: registry.histogram(
      "agent_stream_output_tokens_per_second",
      DEFAULT_TOKEN_BUCKETS,
      "Streaming output throughput in tokens per second",
    ),
    checkpointsTotal: registry.counter("agent_checkpoints_total", "Total checkpoint operations"),
  };
}

// =============================================================================
// Metrics Hooks
// =============================================================================

import type {
  GenerationRetryDecisionInput,
  HookCallback,
  PostCompactInput,
  PostGenerateFailureInput,
  PostGenerateInput,
  PostToolUseFailureInput,
  PostToolUseInput,
  PreCompactInput,
  PreGenerateInput,
  PreToolUseInput,
  SubagentStartInput,
} from "../types.js";
import { requestKey } from "./execution-metadata.js";

/**
 * Creates hooks that automatically update agent metrics.
 *
 * @param metrics - The agent metrics to update
 * @returns Hook callbacks for metrics collection
 *
 * @example
 * ```typescript
 * const registry = createMetricsRegistry();
 * const metrics = createAgentMetrics(registry);
 * const metricsHooks = createMetricsHooks(metrics);
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PostGenerate: [metricsHooks.PostGenerate],
 *     PostToolUse: [metricsHooks.PostToolUse],
 *     PostToolUseFailure: [metricsHooks.PostToolUseFailure],
 *     PostCompact: [metricsHooks.PostCompact],
 *   },
 * });
 * ```
 *
 * @category Observability
 */
export function createMetricsHooks(metrics: AgentMetrics): {
  PreGenerate: HookCallback;
  PostGenerate: HookCallback;
  PostGenerateFailure: HookCallback;
  GenerationRetryDecision: HookCallback;
  PreCompact: HookCallback;
  PreToolUse: HookCallback;
  PostToolUse: HookCallback;
  PostToolUseFailure: HookCallback;
  PostCompact: HookCallback;
  SubagentStart: HookCallback;
} {
  const requestStartTimes = new Map<string, number>();
  const toolStartTimes = new Map<string, number>();
  const compactionStartTimes = new Map<string, number>();
  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const staleTimingTtlMs = Number(process.env.AGENT_SDK_METRICS_TIMING_TTL_MS ?? 300000);

  const pruneStaleStartTimes = (map: Map<string, number>, maxAgeMs = staleTimingTtlMs): void => {
    const now = Date.now();
    for (const [key, startedAt] of map) {
      if (now - startedAt > maxAgeMs) {
        map.delete(key);
      }
    }
  };

  const pruneAllStartTimes = (): void => {
    pruneStaleStartTimes(requestStartTimes);
    pruneStaleStartTimes(toolStartTimes);
    pruneStaleStartTimes(compactionStartTimes);
  };

  const labelsFor = (input: {
    telemetry?: {
      modelId?: string;
      requestedModelId?: string;
      modelProvider?: string;
      requestedModelProvider?: string;
    };
    requestClass?: string;
    options?: { requestClass?: string };
  }): MetricLabels => {
    const labels: MetricLabels = {};
    const modelId = input.telemetry?.modelId ?? input.telemetry?.requestedModelId;
    const provider = input.telemetry?.modelProvider ?? input.telemetry?.requestedModelProvider;
    const requestClass = input.requestClass ?? input.options?.requestClass;
    if (modelId) labels.model = modelId;
    if (provider) labels.provider = provider;
    if (requestClass) labels.request_class = requestClass;
    return labels;
  };

  return {
    PreGenerate: async (input) => {
      if (input.hook_event_name !== "PreGenerate") return {};
      pruneAllStartTimes();
      const preGenInput = input as PreGenerateInput;
      const labels = labelsFor(preGenInput);
      requestStartTimes.set(requestKey(preGenInput), Date.now());
      metrics.requestsInProgress.inc(1, labels);
      return {};
    },

    PostGenerate: async (input) => {
      if (input.hook_event_name !== "PostGenerate") return {};
      const postGenInput = input as PostGenerateInput;
      const labels = labelsFor(postGenInput);

      metrics.requestsTotal.inc(1, labels);

      const key = requestKey(postGenInput);
      const startedAt = requestStartTimes.get(key);
      if (startedAt !== undefined) {
        metrics.requestsInProgress.dec(1, labels);
        metrics.requestDurationMs.observe(Date.now() - startedAt, labels);
        requestStartTimes.delete(key);
      } else if (postGenInput.result.telemetry?.durationMs !== undefined) {
        metrics.requestDurationMs.observe(postGenInput.result.telemetry.durationMs, labels);
      }

      if (postGenInput.result.usage) {
        const { inputTokens, outputTokens, totalTokens } = postGenInput.result.usage;
        if (isFiniteNumber(inputTokens)) {
          metrics.inputTokensTotal.inc(inputTokens, labels);
        }
        if (isFiniteNumber(outputTokens)) {
          metrics.outputTokensTotal.inc(outputTokens, labels);
        }
        if (isFiniteNumber(totalTokens)) {
          metrics.tokensTotal.inc(totalTokens, labels);
        }
      }

      const usageTelemetry = postGenInput.result.telemetry?.usage;
      if (usageTelemetry?.cacheCreationInputTokens !== undefined) {
        metrics.cacheCreationInputTokensTotal.inc(usageTelemetry.cacheCreationInputTokens, labels);
      }
      if (usageTelemetry?.cacheReadInputTokens !== undefined) {
        metrics.cacheReadInputTokensTotal.inc(usageTelemetry.cacheReadInputTokens, labels);
      }
      if (postGenInput.result.telemetry?.timeToFirstTokenMs !== undefined) {
        metrics.streamTimeToFirstTokenMs.observe(
          postGenInput.result.telemetry.timeToFirstTokenMs,
          labels,
        );
      }
      if (postGenInput.result.telemetry?.outputTokensPerSecond !== undefined) {
        metrics.streamOutputTokensPerSecond.observe(
          postGenInput.result.telemetry.outputTokensPerSecond,
          labels,
        );
      }

      return {};
    },

    PostGenerateFailure: async (input) => {
      if (input.hook_event_name !== "PostGenerateFailure") return {};
      const failureInput = input as PostGenerateFailureInput;
      const labels = labelsFor(failureInput);

      const key = requestKey(failureInput);
      const startedAt = requestStartTimes.get(key);
      if (startedAt !== undefined) {
        metrics.requestsInProgress.dec(1, labels);
      }
      metrics.errorsTotal.inc(1, {
        ...labels,
        type: failureInput.failureClassification?.type ?? "generation_error",
      });

      if (startedAt !== undefined) {
        metrics.requestDurationMs.observe(Date.now() - startedAt, labels);
        requestStartTimes.delete(key);
      }

      if (failureInput.failureClassification?.subtype === "rate_limit") {
        metrics.rateLimitErrorsTotal.inc(1, labels);
      }

      return {};
    },

    GenerationRetryDecision: async (input) => {
      if (input.hook_event_name !== "GenerationRetryDecision") return {};
      const retryInput = input as GenerationRetryDecisionInput;
      if (retryInput.decision !== "retry" && retryInput.decision !== "fallback") {
        return {};
      }

      metrics.retryAttemptsTotal.inc(1, {
        ...labelsFor(retryInput),
        decision: retryInput.decision,
        failure_type: retryInput.failureClassification.type,
      });
      return {};
    },

    PreCompact: async (input) => {
      if (input.hook_event_name !== "PreCompact") return {};
      pruneAllStartTimes();
      const preCompactInput = input as PreCompactInput;
      compactionStartTimes.set(requestKey(preCompactInput), Date.now());
      return {};
    },

    PreToolUse: async (input, toolUseId) => {
      if (input.hook_event_name !== "PreToolUse") return {};
      pruneAllStartTimes();
      const _preToolInput = input as PreToolUseInput;
      if (toolUseId) {
        toolStartTimes.set(toolUseId, Date.now());
      }
      return {};
    },

    PostToolUse: async (input, toolUseId) => {
      if (input.hook_event_name !== "PostToolUse") return {};
      const postToolInput = input as PostToolUseInput;
      const labels = {
        ...labelsFor(postToolInput),
        tool: postToolInput.tool_name,
      };

      metrics.toolCallsTotal.inc(1, labels);
      if (toolUseId && toolStartTimes.has(toolUseId)) {
        metrics.toolDurationMs.observe(Date.now() - (toolStartTimes.get(toolUseId) ?? 0), labels);
        toolStartTimes.delete(toolUseId);
      }

      return {};
    },

    PostToolUseFailure: async (input, toolUseId) => {
      if (input.hook_event_name !== "PostToolUseFailure") return {};
      const failureInput = input as PostToolUseFailureInput;
      const labels = {
        ...labelsFor(failureInput),
        tool: failureInput.tool_name,
      };

      metrics.toolErrorsTotal.inc(1, labels);
      metrics.errorsTotal.inc(1, { ...labels, type: "tool_error" });
      if (toolUseId) {
        const startedAt = toolStartTimes.get(toolUseId);
        if (startedAt !== undefined) {
          metrics.toolDurationMs.observe(Date.now() - startedAt, labels);
        }
        toolStartTimes.delete(toolUseId);
      }

      return {};
    },

    PostCompact: async (input) => {
      if (input.hook_event_name !== "PostCompact") return {};
      const postCompactInput = input as PostCompactInput;
      const labels = labelsFor(postCompactInput);

      metrics.compactionsTotal.inc(1, labels);
      const startedAt = compactionStartTimes.get(requestKey(postCompactInput));
      if (startedAt !== undefined) {
        metrics.compactionDurationMs.observe(Date.now() - startedAt, labels);
        compactionStartTimes.delete(requestKey(postCompactInput));
      }

      return {};
    },

    SubagentStart: async (input) => {
      if (input.hook_event_name !== "SubagentStart") return {};
      const subagentInput = input as SubagentStartInput;
      metrics.subagentSpawnsTotal.inc(1, {
        ...labelsFor(subagentInput),
        agent_type: subagentInput.agent_type,
      });

      return {};
    },
  };
}

// =============================================================================
// Default Registry
// =============================================================================

/**
 * The default global metrics registry.
 *
 * @category Observability
 */
export let defaultMetricsRegistry: MetricsRegistry = createMetricsRegistry();

/**
 * Sets the default global metrics registry.
 *
 * @param registry - The registry to use as default
 *
 * @category Observability
 */
export function setDefaultMetricsRegistry(registry: MetricsRegistry): void {
  defaultMetricsRegistry = registry;
}
