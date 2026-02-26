/**
 * Distributed Tracing System.
 *
 * Provides OpenTelemetry-compatible tracing for:
 * - Agent request tracing
 * - Tool execution spans
 * - Subagent spans
 * - Cross-service correlation
 *
 * The implementation is framework-agnostic and can be used with
 * actual OpenTelemetry or any compatible tracing system.
 *
 * @packageDocumentation
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Span status codes.
 *
 * @category Observability
 */
export type SpanStatusCode = "unset" | "ok" | "error";

/**
 * Span kind (direction of the span).
 *
 * @category Observability
 */
export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";

/**
 * Span attributes (key-value metadata).
 *
 * @category Observability
 */
export type SpanAttributes = Record<
  string,
  string | number | boolean | string[] | number[] | boolean[]
>;

/**
 * Span event (point-in-time occurrence).
 *
 * @category Observability
 */
export interface SpanEvent {
  /** Event name */
  name: string;
  /** Event timestamp (ISO string) */
  timestamp: string;
  /** Optional attributes */
  attributes?: SpanAttributes;
}

/**
 * Span link (reference to another span).
 *
 * @category Observability
 */
export interface SpanLink {
  /** Trace ID of linked span */
  traceId: string;
  /** Span ID of linked span */
  spanId: string;
  /** Optional attributes */
  attributes?: SpanAttributes;
}

/**
 * Span status.
 *
 * @category Observability
 */
export interface SpanStatus {
  /** Status code */
  code: SpanStatusCode;
  /** Optional status message */
  message?: string;
}

/**
 * A completed span data structure.
 *
 * @category Observability
 */
export interface SpanData {
  /** Unique trace identifier */
  traceId: string;
  /** Unique span identifier */
  spanId: string;
  /** Parent span ID (if any) */
  parentSpanId?: string;
  /** Span name/operation */
  name: string;
  /** Span kind */
  kind: SpanKind;
  /** Start time (ISO string) */
  startTime: string;
  /** End time (ISO string) */
  endTime: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Span attributes */
  attributes: SpanAttributes;
  /** Span events */
  events: SpanEvent[];
  /** Span links */
  links: SpanLink[];
  /** Span status */
  status: SpanStatus;
}

/**
 * An active span that can be modified.
 *
 * @category Observability
 */
export interface Span {
  /** Trace ID */
  readonly traceId: string;
  /** Span ID */
  readonly spanId: string;
  /** Span name */
  readonly name: string;

  /** Set an attribute */
  setAttribute(key: string, value: string | number | boolean): Span;
  /** Set multiple attributes */
  setAttributes(attributes: SpanAttributes): Span;
  /** Add an event */
  addEvent(name: string, attributes?: SpanAttributes): Span;
  /** Add a link to another span */
  addLink(traceId: string, spanId: string, attributes?: SpanAttributes): Span;
  /** Set status */
  setStatus(code: SpanStatusCode, message?: string): Span;
  /** Record an exception */
  recordException(error: Error, attributes?: SpanAttributes): Span;
  /** End the span */
  end(): void;
  /** Get span data (only valid after end) */
  getData(): SpanData | null;
  /** Check if span is recording */
  isRecording(): boolean;
}

/**
 * Span context for propagation.
 *
 * @category Observability
 */
export interface SpanContext {
  /** Trace ID */
  traceId: string;
  /** Span ID */
  spanId: string;
  /** Trace flags */
  traceFlags?: number;
  /** Trace state */
  traceState?: string;
}

/**
 * A span exporter sends spans to a backend.
 *
 * @category Observability
 */
export interface SpanExporter {
  /** Exporter name */
  name: string;
  /** Export spans */
  export(spans: SpanData[]): void | Promise<void>;
  /** Optional flush for batch exporters */
  flush?(): void | Promise<void>;
  /** Optional shutdown for cleanup */
  shutdown?(): void | Promise<void>;
}

/**
 * Options for creating a tracer.
 *
 * @category Observability
 */
export interface TracerOptions {
  /** Tracer/service name */
  name?: string;
  /** Tracer version */
  version?: string;
  /** Default attributes for all spans */
  defaultAttributes?: SpanAttributes;
  /** Span exporters */
  exporters?: SpanExporter[];
  /** Whether to enable tracing */
  enabled?: boolean;
  /** Sampling rate (0-1) */
  samplingRate?: number;
}

/**
 * Options for starting a span.
 *
 * @category Observability
 */
export interface StartSpanOptions {
  /** Span kind */
  kind?: SpanKind;
  /** Initial attributes */
  attributes?: SpanAttributes;
  /** Parent span context */
  parent?: SpanContext;
  /** Links to other spans */
  links?: SpanLink[];
}

/**
 * A tracer creates and manages spans.
 *
 * @category Observability
 */
export interface Tracer {
  /** Tracer name */
  readonly name: string;
  /** Whether tracing is enabled */
  readonly enabled: boolean;

  /** Start a new span */
  startSpan(name: string, options?: StartSpanOptions): Span;

  /**
   * Execute a function within a span.
   * The span is automatically ended when the function completes.
   */
  withSpan<T>(
    name: string,
    fn: (span: Span) => T | Promise<T>,
    options?: StartSpanOptions,
  ): Promise<T>;

  /** Get the current active span (if any) */
  getActiveSpan(): Span | null;

  /** Export all pending spans */
  flush(): Promise<void>;

  /** Shutdown the tracer */
  shutdown(): Promise<void>;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a random 128-bit trace ID (32 hex chars).
 */
function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a random 64-bit span ID (16 hex chars).
 */
function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// =============================================================================
// No-op Implementation
// =============================================================================

/**
 * A no-op span that does nothing.
 * Used when tracing is disabled.
 */
const NOOP_SPAN: Span = {
  traceId: "00000000000000000000000000000000",
  spanId: "0000000000000000",
  name: "noop",
  setAttribute: () => NOOP_SPAN,
  setAttributes: () => NOOP_SPAN,
  addEvent: () => NOOP_SPAN,
  addLink: () => NOOP_SPAN,
  setStatus: () => NOOP_SPAN,
  recordException: () => NOOP_SPAN,
  end: () => {},
  getData: () => null,
  isRecording: () => false,
};

// =============================================================================
// Implementation
// =============================================================================

/**
 * Creates a span implementation.
 *
 * @internal
 */
function createSpan(
  name: string,
  traceId: string,
  spanId: string,
  parentSpanId: string | undefined,
  kind: SpanKind,
  defaultAttributes: SpanAttributes,
  onEnd: (data: SpanData) => void,
): Span {
  const startTime = new Date();
  const attributes: SpanAttributes = { ...defaultAttributes };
  const events: SpanEvent[] = [];
  const links: SpanLink[] = [];
  let status: SpanStatus = { code: "unset" };
  let ended = false;
  let spanData: SpanData | null = null;

  return {
    traceId,
    spanId,
    name,

    setAttribute(key: string, value: string | number | boolean): Span {
      if (!ended) {
        attributes[key] = value;
      }
      return this;
    },

    setAttributes(attrs: SpanAttributes): Span {
      if (!ended) {
        Object.assign(attributes, attrs);
      }
      return this;
    },

    addEvent(eventName: string, attrs?: SpanAttributes): Span {
      if (!ended) {
        events.push({
          name: eventName,
          timestamp: new Date().toISOString(),
          attributes: attrs,
        });
      }
      return this;
    },

    addLink(linkTraceId: string, linkSpanId: string, attrs?: SpanAttributes): Span {
      if (!ended) {
        links.push({
          traceId: linkTraceId,
          spanId: linkSpanId,
          attributes: attrs,
        });
      }
      return this;
    },

    setStatus(code: SpanStatusCode, message?: string): Span {
      if (!ended) {
        status = { code, message };
      }
      return this;
    },

    recordException(error: Error, attrs?: SpanAttributes): Span {
      if (!ended) {
        events.push({
          name: "exception",
          timestamp: new Date().toISOString(),
          attributes: {
            "exception.type": error.name,
            "exception.message": error.message,
            "exception.stacktrace": error.stack ?? "",
            ...attrs,
          },
        });
        if (status.code === "unset") {
          status = { code: "error", message: error.message };
        }
      }
      return this;
    },

    end(): void {
      if (!ended) {
        ended = true;
        const endTime = new Date();
        spanData = {
          traceId,
          spanId,
          parentSpanId,
          name,
          kind,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          durationMs: endTime.getTime() - startTime.getTime(),
          attributes,
          events,
          links,
          status,
        };
        onEnd(spanData);
      }
    },

    getData(): SpanData | null {
      return spanData;
    },

    isRecording(): boolean {
      return !ended;
    },
  };
}

/**
 * Creates a tracer for distributed tracing.
 *
 * @param options - Tracer options
 * @returns A tracer instance
 *
 * @example
 * ```typescript
 * const tracer = createTracer({
 *   name: "my-agent",
 *   exporters: [createConsoleSpanExporter()],
 * });
 *
 * const span = tracer.startSpan("generate");
 * try {
 *   const result = await agent.generate({ prompt: "Hello" });
 *   span.setAttribute("tokens", result.usage?.totalTokens ?? 0);
 *   span.setStatus("ok");
 * } catch (error) {
 *   span.recordException(error as Error);
 * } finally {
 *   span.end();
 * }
 * ```
 *
 * @category Observability
 */
export function createTracer(options: TracerOptions = {}): Tracer {
  const {
    name = "agent",
    version = "1.0.0",
    defaultAttributes = {},
    exporters = [],
    enabled = true,
    samplingRate = 1.0,
  } = options;

  const pendingSpans: SpanData[] = [];
  let activeSpan: Span | null = null;

  /**
   * Decide whether to sample this trace.
   */
  function shouldSample(): boolean {
    return enabled && Math.random() < samplingRate;
  }

  /**
   * Handle span end.
   */
  function onSpanEnd(data: SpanData): void {
    pendingSpans.push(data);
    if (activeSpan?.spanId === data.spanId) {
      activeSpan = null;
    }
  }

  const tracer: Tracer = {
    name,
    enabled,

    startSpan(spanName: string, opts: StartSpanOptions = {}): Span {
      if (!shouldSample()) {
        return NOOP_SPAN;
      }

      const traceId = opts.parent?.traceId ?? generateTraceId();
      const spanId = generateSpanId();
      const parentSpanId = opts.parent?.spanId;
      const kind = opts.kind ?? "internal";

      const span = createSpan(
        spanName,
        traceId,
        spanId,
        parentSpanId,
        kind,
        {
          ...defaultAttributes,
          "service.name": name,
          "service.version": version,
          ...opts.attributes,
        },
        onSpanEnd,
      );

      // Add initial links
      if (opts.links) {
        for (const link of opts.links) {
          span.addLink(link.traceId, link.spanId, link.attributes);
        }
      }

      activeSpan = span;
      return span;
    },

    async withSpan<T>(
      spanName: string,
      fn: (span: Span) => T | Promise<T>,
      opts?: StartSpanOptions,
    ): Promise<T> {
      const span = this.startSpan(spanName, opts);
      try {
        const result = await fn(span);
        // Set status to ok before ending if not already set
        if (span.isRecording()) {
          span.setStatus("ok");
        }
        return result;
      } catch (error) {
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    },

    getActiveSpan(): Span | null {
      return activeSpan;
    },

    async flush(): Promise<void> {
      if (pendingSpans.length === 0) {
        return;
      }

      const spansToExport = [...pendingSpans];
      pendingSpans.length = 0;

      await Promise.all(
        exporters.map((e) =>
          Promise.resolve(e.export(spansToExport)).catch(() => {
            // Silently ignore export errors
          }),
        ),
      );
    },

    async shutdown(): Promise<void> {
      await this.flush();
      await Promise.all(
        exporters.map((e) =>
          e.shutdown ? Promise.resolve(e.shutdown()).catch(() => {}) : Promise.resolve(),
        ),
      );
    },
  };

  return tracer;
}

// =============================================================================
// Exporters
// =============================================================================

/**
 * Creates a console exporter for debugging.
 *
 * @returns A console span exporter
 *
 * @example
 * ```typescript
 * const tracer = createTracer({
 *   exporters: [createConsoleSpanExporter()],
 * });
 * ```
 *
 * @category Observability
 */
export function createConsoleSpanExporter(): SpanExporter {
  return {
    name: "console",
    export(spans: SpanData[]): void {
      for (const span of spans) {
        const statusIcon =
          span.status.code === "ok" ? "✓" : span.status.code === "error" ? "✗" : "?";
        console.log(
          `[Trace] ${statusIcon} ${span.name} (${span.durationMs}ms)`,
          `trace=${span.traceId.slice(0, 8)} span=${span.spanId.slice(0, 8)}`,
          Object.keys(span.attributes).length > 0 ? JSON.stringify(span.attributes) : "",
        );
      }
    },
  };
}

/**
 * Creates a memory exporter that stores spans.
 *
 * @returns A memory span exporter with access to stored spans
 *
 * @example
 * ```typescript
 * const exporter = createMemorySpanExporter();
 * const tracer = createTracer({ exporters: [exporter] });
 *
 * tracer.startSpan("test").end();
 * await tracer.flush();
 *
 * console.log(exporter.spans);
 * ```
 *
 * @category Observability
 */
export function createMemorySpanExporter(): SpanExporter & {
  spans: SpanData[];
  clear(): void;
} {
  const spans: SpanData[] = [];

  return {
    name: "memory",
    spans,
    export(newSpans: SpanData[]): void {
      spans.push(...newSpans);
    },
    clear(): void {
      spans.length = 0;
    },
  };
}

/**
 * Creates a callback exporter that invokes a function for each batch.
 *
 * @param callback - Function to call with spans
 * @returns A callback span exporter
 *
 * @example
 * ```typescript
 * const exporter = createCallbackSpanExporter((spans) => {
 *   sendToJaeger(spans);
 * });
 * ```
 *
 * @category Observability
 */
export function createCallbackSpanExporter(
  callback: (spans: SpanData[]) => void | Promise<void>,
): SpanExporter {
  return {
    name: "callback",
    export: callback,
  };
}

/**
 * Creates an OTLP-compatible exporter (OpenTelemetry Protocol).
 *
 * This exporter formats spans for OTLP collectors but does not
 * include HTTP transport. Use with a custom callback for actual sending.
 *
 * @param options - Exporter options
 * @returns An OTLP-compatible exporter
 *
 * @example
 * ```typescript
 * const exporter = createOTLPSpanExporter({
 *   onExport: async (payload) => {
 *     await fetch("http://collector:4318/v1/traces", {
 *       method: "POST",
 *       headers: { "Content-Type": "application/json" },
 *       body: JSON.stringify(payload),
 *     });
 *   },
 * });
 * ```
 *
 * @category Observability
 */
export function createOTLPSpanExporter(options: {
  /** Service name */
  serviceName?: string;
  /** Callback to handle OTLP payload */
  onExport: (payload: unknown) => void | Promise<void>;
}): SpanExporter {
  const { serviceName = "agent", onExport } = options;

  return {
    name: "otlp",
    async export(spans: SpanData[]): Promise<void> {
      // Convert to OTLP format
      const payload = {
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
            },
            scopeSpans: [
              {
                scope: { name: serviceName },
                spans: spans.map((span) => ({
                  traceId: span.traceId,
                  spanId: span.spanId,
                  parentSpanId: span.parentSpanId,
                  name: span.name,
                  kind: spanKindToOTLP(span.kind),
                  startTimeUnixNano: new Date(span.startTime).getTime() * 1_000_000,
                  endTimeUnixNano: new Date(span.endTime).getTime() * 1_000_000,
                  attributes: Object.entries(span.attributes).map(([k, v]) => ({
                    key: k,
                    value: attributeValueToOTLP(v),
                  })),
                  events: span.events.map((e) => ({
                    name: e.name,
                    timeUnixNano: new Date(e.timestamp).getTime() * 1_000_000,
                    attributes: e.attributes
                      ? Object.entries(e.attributes).map(([k, v]) => ({
                          key: k,
                          value: attributeValueToOTLP(v),
                        }))
                      : [],
                  })),
                  status: {
                    code: statusCodeToOTLP(span.status.code),
                    message: span.status.message,
                  },
                })),
              },
            ],
          },
        ],
      };

      await onExport(payload);
    },
  };
}

/**
 * Convert span kind to OTLP value.
 * @internal
 */
function spanKindToOTLP(kind: SpanKind): number {
  const mapping: Record<SpanKind, number> = {
    internal: 1,
    server: 2,
    client: 3,
    producer: 4,
    consumer: 5,
  };
  return mapping[kind];
}

/**
 * Convert status code to OTLP value.
 * @internal
 */
function statusCodeToOTLP(code: SpanStatusCode): number {
  const mapping: Record<SpanStatusCode, number> = {
    unset: 0,
    ok: 1,
    error: 2,
  };
  return mapping[code];
}

/**
 * Convert attribute value to OTLP format.
 * @internal
 */
function attributeValueToOTLP(
  value: string | number | boolean | string[] | number[] | boolean[],
): unknown {
  if (typeof value === "string") {
    return { stringValue: value };
  } else if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
  } else if (typeof value === "boolean") {
    return { boolValue: value };
  } else if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((v) => attributeValueToOTLP(v)),
      },
    };
  }
  return { stringValue: String(value) };
}

// =============================================================================
// Default Tracer
// =============================================================================

/**
 * The default global tracer instance.
 *
 * @category Observability
 */
export let defaultTracer: Tracer = createTracer({ name: "agent-sdk", enabled: false });

/**
 * Sets the default global tracer.
 *
 * @param tracer - The tracer to use as default
 *
 * @category Observability
 */
export function setDefaultTracer(tracer: Tracer): void {
  defaultTracer = tracer;
}

// =============================================================================
// Semantic Conventions
// =============================================================================

/**
 * Semantic attribute keys for AI/LLM operations.
 *
 * Based on emerging OpenTelemetry semantic conventions for GenAI.
 *
 * @category Observability
 */
export const SemanticAttributes = {
  // General
  SERVICE_NAME: "service.name",
  SERVICE_VERSION: "service.version",

  // LLM/GenAI
  GEN_AI_SYSTEM: "gen_ai.system",
  GEN_AI_REQUEST_MODEL: "gen_ai.request.model",
  GEN_AI_REQUEST_MAX_TOKENS: "gen_ai.request.max_tokens",
  GEN_AI_REQUEST_TEMPERATURE: "gen_ai.request.temperature",
  GEN_AI_RESPONSE_MODEL: "gen_ai.response.model",
  GEN_AI_RESPONSE_FINISH_REASONS: "gen_ai.response.finish_reasons",
  GEN_AI_USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  GEN_AI_USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  GEN_AI_USAGE_TOTAL_TOKENS: "gen_ai.usage.total_tokens",

  // Agent-specific
  AGENT_ID: "agent.id",
  AGENT_NAME: "agent.name",
  AGENT_TOOLS: "agent.tools",
  AGENT_STEP: "agent.step",

  // Tool
  TOOL_NAME: "tool.name",
  TOOL_INPUT: "tool.input",
  TOOL_OUTPUT: "tool.output",

  // Subagent
  SUBAGENT_ID: "subagent.id",
  SUBAGENT_TYPE: "subagent.type",
  SUBAGENT_PROMPT: "subagent.prompt",

  // Error
  EXCEPTION_TYPE: "exception.type",
  EXCEPTION_MESSAGE: "exception.message",
  EXCEPTION_STACKTRACE: "exception.stacktrace",
} as const;
