/**
 * Observability Preset.
 *
 * Provides a convenience function for setting up complete observability
 * in a single call, including logger, metrics, tracer, and hooks.
 *
 * @packageDocumentation
 */

import { createComprehensiveLoggingHooks, type LoggingHooksOptions } from "../hooks/logging.js";
import type { HookRegistration } from "../types.js";
import {
  createConsoleTransport,
  createLogger,
  createPrettyFormatter,
  type Logger,
  type LoggerOptions,
} from "./logger.js";
import {
  type AgentMetrics,
  createAgentMetrics,
  createMetricsRegistry,
  type MetricsRegistry,
  type MetricsRegistryOptions,
} from "./metrics.js";
import {
  createConsoleSpanExporter,
  createTracer,
  type SpanExporter,
  type Tracer,
  type TracerOptions,
} from "./tracing.js";

/**
 * Options for creating an observability preset.
 *
 * @category Observability
 */
export interface ObservabilityPresetOptions {
  /**
   * Name for the logger, tracer, and metrics (typically your agent name).
   * @defaultValue "agent"
   */
  name?: string;

  /**
   * Whether to enable logging.
   * @defaultValue true
   */
  enableLogging?: boolean;

  /**
   * Whether to enable metrics.
   * @defaultValue true
   */
  enableMetrics?: boolean;

  /**
   * Whether to enable tracing.
   * @defaultValue true
   */
  enableTracing?: boolean;

  /**
   * Whether to create hooks that wire the agent to the observability system.
   * @defaultValue true
   */
  enableHooks?: boolean;

  /**
   * Logger options (overrides defaults).
   */
  loggerOptions?: Partial<LoggerOptions>;

  /**
   * Metrics registry options (overrides defaults).
   */
  metricsOptions?: Partial<MetricsRegistryOptions>;

  /**
   * Tracer options (overrides defaults).
   */
  tracerOptions?: Partial<TracerOptions>;

  /**
   * Logging hooks options (overrides defaults).
   */
  loggingHooksOptions?: Partial<LoggingHooksOptions>;

  /**
   * Custom span exporters for tracing.
   * If not provided, defaults to console exporter.
   */
  spanExporters?: SpanExporter[];
}

/**
 * Result of creating an observability preset.
 *
 * @category Observability
 */
export interface ObservabilityPreset {
  /**
   * The logger instance (if enabled).
   */
  logger?: Logger;

  /**
   * The metrics registry (if enabled).
   */
  metricsRegistry?: MetricsRegistry;

  /**
   * Agent-specific metrics helpers (if metrics enabled).
   */
  metrics?: AgentMetrics;

  /**
   * The tracer instance (if enabled).
   */
  tracer?: Tracer;

  /**
   * Hook registration to pass to agent.hooks (if enabled).
   */
  hooks?: HookRegistration;
}

/**
 * Creates a complete observability setup with logger, metrics, tracer, and hooks.
 *
 * This function provides a convenient way to set up comprehensive observability
 * for your agent in a single call. It returns configured observability primitives
 * and hooks that can be passed directly to `createAgent()`.
 *
 * @param options - Configuration options
 * @returns Observability preset with logger, metrics, tracer, and hooks
 *
 * @example
 * ```typescript
 * import { createAgent, createObservabilityPreset } from "@lleverage-ai/agent-sdk";
 * import { anthropic } from "@ai-sdk/anthropic";
 *
 * // One-line observability setup
 * const observability = createObservabilityPreset({
 *   name: "my-agent",
 * });
 *
 * // Create agent with full observability
 * const agent = createAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   hooks: observability.hooks,
 * });
 *
 * // Access observability primitives
 * observability.logger?.info("Agent started");
 * observability.metrics?.requests.inc();
 * const span = observability.tracer?.startSpan("custom-operation");
 * ```
 *
 * @example

 * ```typescript
 * // Customize observability setup
 * const observability = createObservabilityPreset({
 *   name: "my-agent",
 *   enableTracing: false, // Disable tracing
 *   loggerOptions: {
 *     level: "warn", // Only log warnings and errors
 *   },
 *   loggingHooksOptions: {
 *     logTiming: true,
 *     maxTextLength: 500,
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Export traces to OpenTelemetry collector
 * import { createOTLPSpanExporter } from "@lleverage-ai/agent-sdk";
 *
 * const observability = createObservabilityPreset({
 *   name: "production-agent",
 *   spanExporters: [
 *     createOTLPSpanExporter({
 *       url: "http://localhost:4318/v1/traces",
 *     }),
 *   ],
 * });
 * ```
 *
 * @category Observability
 */
export function createObservabilityPreset(
  options: ObservabilityPresetOptions = {},
): ObservabilityPreset {
  const {
    name = "agent",
    enableLogging = true,
    enableMetrics = true,
    enableTracing = true,
    enableHooks = true,
    loggerOptions = {},
    metricsOptions = {},
    tracerOptions = {},
    loggingHooksOptions = {},
    spanExporters,
  } = options;

  const preset: ObservabilityPreset = {};

  // Create logger
  if (enableLogging) {
    preset.logger = createLogger({
      name,
      level: "info",
      transports: [createConsoleTransport()],
      formatter: createPrettyFormatter(),
      ...loggerOptions,
    });
  }

  // Create metrics
  if (enableMetrics) {
    preset.metricsRegistry = createMetricsRegistry(metricsOptions);
    preset.metrics = createAgentMetrics(preset.metricsRegistry);
  }

  // Create tracer
  if (enableTracing) {
    const exporters = spanExporters ?? [createConsoleSpanExporter()];
    preset.tracer = createTracer({
      name,
      exporters,
      ...tracerOptions,
    });
  }

  // Create hooks
  if (enableHooks) {
    let hooks: HookRegistration | undefined;

    // Add comprehensive logging hooks if logger is enabled
    if (enableLogging && preset.logger) {
      const logger = preset.logger;
      const { generationHooks, toolHooks, compactionHooks } = createComprehensiveLoggingHooks({
        log: (message: string) => logger.info(message),
        prefix: `[${name}]`,
        logTiming: true,
        ...loggingHooksOptions,
      });

      hooks = {
        PreGenerate: generationHooks[0] ? [generationHooks[0]] : undefined,
        PostGenerate: generationHooks[1] ? [generationHooks[1]] : undefined,
        PostGenerateFailure: generationHooks[2] ? [generationHooks[2]] : undefined,
        PreToolUse: toolHooks[0] ? [{ hooks: [toolHooks[0]] }] : undefined,
        PostToolUse: toolHooks[1] ? [{ hooks: [toolHooks[1]] }] : undefined,
        PostToolUseFailure: toolHooks[2] ? [{ hooks: [toolHooks[2]] }] : undefined,
        PreCompact: compactionHooks[0] ? [compactionHooks[0]] : undefined,
        PostCompact: compactionHooks[1] ? [compactionHooks[1]] : undefined,
      };
    }

    preset.hooks = hooks && Object.keys(hooks).length > 0 ? hooks : undefined;
  }

  return preset;
}
