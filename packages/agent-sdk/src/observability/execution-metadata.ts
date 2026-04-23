/**
 * Execution metadata helpers for observability and correlation.
 *
 * @packageDocumentation
 */

import type { LanguageModel, LanguageModelUsage } from "ai";
import type { ExecutionTelemetry, ExecutionUsageTelemetry } from "../types.js";

interface ResolvedModelIdentity {
  modelId?: string;
  provider?: string;
}

interface BuildExecutionTelemetryOptions {
  runId: string;
  threadId?: string;
  requestedModel?: LanguageModel;
  responseModelId?: string;
  usage?: LanguageModelUsage;
  providerMetadata?: unknown;
  durationMs?: number;
  timeToFirstTokenMs?: number;
}

/**
 * Creates a stable execution/run identifier.
 *
 * @category Observability
 */
export function createRunId(): string {
  return `run_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Extracts a telemetry-safe model identifier from a language model.
 *
 * @param model - Requested model
 * @returns Resolved identifier/provider metadata
 *
 * @category Observability
 */
export function resolveModelIdentity(model: LanguageModel | undefined): ResolvedModelIdentity {
  if (!model) {
    return {};
  }

  if (typeof model === "string") {
    return identityFromModelId(model);
  }

  const maybeModel = model as {
    modelId?: string;
    provider?: string;
    providerId?: string;
  };

  if (typeof maybeModel.modelId === "string") {
    const identity = identityFromModelId(maybeModel.modelId);
    return {
      modelId: maybeModel.modelId,
      provider:
        typeof maybeModel.provider === "string"
          ? maybeModel.provider
          : typeof maybeModel.providerId === "string"
            ? maybeModel.providerId
            : identity.provider,
    };
  }

  const stringified = String(model);
  if (stringified && stringified !== "[object Object]") {
    return identityFromModelId(stringified);
  }

  return {};
}

/**
 * Builds normalized execution metadata for results, hooks, logs, and spans.
 *
 * @param options - Source metadata
 * @returns Execution telemetry object
 *
 * @category Observability
 */
export function buildExecutionTelemetry(
  options: BuildExecutionTelemetryOptions,
): ExecutionTelemetry {
  const requested = resolveModelIdentity(options.requestedModel);
  const response = identityFromModelId(options.responseModelId);
  const usage = normalizeExecutionUsage(options.usage, options.providerMetadata);
  const outputTokensPerSecond =
    options.durationMs && options.durationMs > 0 && usage.outputTokens !== undefined
      ? Number(((usage.outputTokens / options.durationMs) * 1000).toFixed(3))
      : undefined;

  return {
    runId: options.runId,
    threadId: options.threadId,
    requestedModelId: requested.modelId,
    requestedModelProvider: requested.provider,
    modelId: response.modelId ?? requested.modelId,
    modelProvider: response.provider ?? requested.provider,
    durationMs: options.durationMs,
    timeToFirstTokenMs: options.timeToFirstTokenMs,
    outputTokensPerSecond,
    usage,
  };
}

/**
 * Builds a lightweight telemetry object when only identifiers are known.
 *
 * @param options - Identifier metadata
 * @returns Execution telemetry
 *
 * @category Observability
 */
export function buildExecutionTelemetryFromIds(options: {
  runId: string;
  threadId?: string;
  requestedModel?: LanguageModel;
}): ExecutionTelemetry {
  return buildExecutionTelemetry({
    runId: options.runId,
    threadId: options.threadId,
    requestedModel: options.requestedModel,
  });
}

/**
 * Normalizes token usage for telemetry consumers.
 *
 * @param usage - Raw AI SDK usage object
 * @param providerMetadata - Optional provider metadata
 * @returns Flattened usage telemetry
 *
 * @category Observability
 */
export function normalizeExecutionUsage(
  usage?: LanguageModelUsage,
  providerMetadata?: unknown,
): ExecutionUsageTelemetry {
  const usageWithDetails = usage as
    | (LanguageModelUsage & {
        inputTokenDetails?: Record<string, unknown>;
        outputTokenDetails?: Record<string, unknown>;
      })
    | undefined;

  const providerRecord = asRecord(providerMetadata);
  const anthropicUsage = asRecord(providerRecord?.anthropic)?.usage;
  const anthropicUsageRecord = asRecord(anthropicUsage);
  const inputDetails = asRecord(usageWithDetails?.inputTokenDetails);

  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens:
      usage?.totalTokens ??
      (usage?.inputTokens !== undefined && usage?.outputTokens !== undefined
        ? usage.inputTokens + usage.outputTokens
        : undefined),
    cacheCreationInputTokens: firstNumber(
      inputDetails?.cacheCreationInputTokens,
      inputDetails?.cache_creation_input_tokens,
      anthropicUsageRecord?.cacheCreationInputTokens,
      anthropicUsageRecord?.cache_creation_input_tokens,
    ),
    cacheReadInputTokens: firstNumber(
      inputDetails?.cacheReadInputTokens,
      inputDetails?.cache_read_input_tokens,
      anthropicUsageRecord?.cacheReadInputTokens,
      anthropicUsageRecord?.cache_read_input_tokens,
    ),
  };
}

function identityFromModelId(modelId: string | undefined): ResolvedModelIdentity {
  if (!modelId) {
    return {};
  }

  const [provider] = modelId.split("/", 1);
  return {
    modelId,
    provider: modelId.includes("/") ? provider : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}
