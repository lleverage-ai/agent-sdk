/**
 * Tracing hooks for agent lifecycle events.
 *
 * @packageDocumentation
 */

import type {
  GenerationRetryDecisionInput,
  HookCallback,
  PostCompactInput,
  PostGenerateFailureInput,
  PostGenerateInput,
  PostToolUseFailureInput,
  PreCompactInput,
  PreGenerateInput,
  PreToolUseInput,
  SubagentStartInput,
  SubagentStopInput,
} from "../types.js";
import { requestKey } from "./execution-metadata.js";
import { SemanticAttributes, type Span, type SpanContext, type Tracer } from "./tracing.js";

interface SpanTelemetryInput {
  runId: string;
  threadId?: string;
  requestedModelId?: string;
  modelId?: string;
  durationMs?: number;
  timeToFirstTokenMs?: number;
  outputTokensPerSecond?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
}

interface ActiveSpan {
  span: Span;
  startedAt: number;
}

/** @internal */
function spanContext(span: Span): SpanContext {
  return { traceId: span.traceId, spanId: span.spanId };
}

/** @internal */
function applyExecutionAttributes(span: Span, telemetry: SpanTelemetryInput | undefined): void {
  if (!telemetry) return;

  span.setAttribute("agent.run_id", telemetry.runId);
  if (telemetry.threadId) {
    span.setAttribute("agent.thread_id", telemetry.threadId);
  }
  if (telemetry.requestedModelId) {
    span.setAttribute(SemanticAttributes.GEN_AI_REQUEST_MODEL, telemetry.requestedModelId);
  }
  if (telemetry.modelId) {
    span.setAttribute(SemanticAttributes.GEN_AI_RESPONSE_MODEL, telemetry.modelId);
  }
  if (telemetry.usage?.inputTokens !== undefined) {
    span.setAttribute(SemanticAttributes.GEN_AI_USAGE_INPUT_TOKENS, telemetry.usage.inputTokens);
  }
  if (telemetry.usage?.outputTokens !== undefined) {
    span.setAttribute(SemanticAttributes.GEN_AI_USAGE_OUTPUT_TOKENS, telemetry.usage.outputTokens);
  }
  if (telemetry.timeToFirstTokenMs !== undefined) {
    span.addEvent("stream.first_token", {
      "agent.stream.ttft_ms": telemetry.timeToFirstTokenMs,
    });
  }
  if (telemetry.outputTokensPerSecond !== undefined) {
    span.addEvent("stream.completed", {
      "agent.stream.output_tokens_per_second": telemetry.outputTokensPerSecond,
    });
  }
  if (telemetry.usage?.cacheCreationInputTokens !== undefined) {
    span.setAttribute(
      "gen_ai.usage.cache_creation_input_tokens",
      telemetry.usage.cacheCreationInputTokens,
    );
  }
  if (telemetry.usage?.cacheReadInputTokens !== undefined) {
    span.setAttribute("gen_ai.usage.cache_read_input_tokens", telemetry.usage.cacheReadInputTokens);
  }
}

/** @internal */
function pruneStaleSpans(map: Map<string, ActiveSpan>, maxAgeMs: number): void {
  const now = Date.now();
  for (const [key, activeSpan] of map) {
    if (now - activeSpan.startedAt > maxAgeMs) {
      activeSpan.span.end();
      map.delete(key);
    }
  }
}

/** @internal */
function errorFromUnknown(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string" || typeof error === "number" || typeof error === "boolean") {
    return new Error(String(error));
  }
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error("Unknown non-Error value");
  }
}

/**
 * Creates lifecycle hooks that emit tracing spans for generation, tools,
 * compaction, retries, and subagents.
 *
 * @param tracer - Tracer instance
 * @returns Hook callbacks for tracing
 *
 * @example
 * ```typescript
 * import { createAgent, createTracingHooks } from "@lleverage-ai/agent-sdk";
 *
 * const tracingHooks = createTracingHooks(tracer);
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PreGenerate: [tracingHooks.PreGenerate],
 *     PostGenerate: [tracingHooks.PostGenerate],
 *   },
 * });
 * ```
 *
 * @category Observability
 */
export function createTracingHooks(tracer: Tracer): {
  PreGenerate: HookCallback;
  PostGenerate: HookCallback;
  PostGenerateFailure: HookCallback;
  GenerationRetryDecision: HookCallback;
  PreToolUse: HookCallback;
  PostToolUse: HookCallback;
  PostToolUseFailure: HookCallback;
  PreCompact: HookCallback;
  PostCompact: HookCallback;
  SubagentStart: HookCallback;
  SubagentStop: HookCallback;
} {
  const staleSpanTtlMs = Number(process.env.AGENT_SDK_TRACING_SPAN_TTL_MS ?? 300000);
  const generationSpans = new Map<string, ActiveSpan>();
  const toolSpans = new Map<string, ActiveSpan>();
  const compactionSpans = new Map<string, ActiveSpan>();
  const subagentSpans = new Map<string, ActiveSpan>();

  const pruneAll = () => {
    pruneStaleSpans(generationSpans, staleSpanTtlMs);
    pruneStaleSpans(toolSpans, staleSpanTtlMs);
    pruneStaleSpans(compactionSpans, staleSpanTtlMs);
    pruneStaleSpans(subagentSpans, staleSpanTtlMs);
  };

  return {
    PreGenerate: async (input) => {
      if (input.hook_event_name !== "PreGenerate") return {};
      pruneAll();
      const preGenInput = input as PreGenerateInput;
      const span = tracer.startSpan("agent.generate", {
        kind: "internal",
        attributes: {
          ...(preGenInput.options.temperature != null
            ? { [SemanticAttributes.GEN_AI_REQUEST_TEMPERATURE]: preGenInput.options.temperature }
            : {}),
          ...(preGenInput.options.maxTokens != null
            ? { [SemanticAttributes.GEN_AI_REQUEST_MAX_TOKENS]: preGenInput.options.maxTokens }
            : {}),
          ...(preGenInput.options.requestClass
            ? { "agent.request_class": preGenInput.options.requestClass }
            : {}),
        },
      });
      applyExecutionAttributes(span, preGenInput.telemetry);
      generationSpans.set(requestKey(preGenInput), { span, startedAt: Date.now() });
      return {};
    },

    PostGenerate: async (input) => {
      if (input.hook_event_name !== "PostGenerate") return {};
      const postGenInput = input as PostGenerateInput;
      const activeSpan = generationSpans.get(requestKey(postGenInput));
      if (!activeSpan) return {};
      const { span } = activeSpan;

      applyExecutionAttributes(span, postGenInput.result.telemetry ?? postGenInput.telemetry);
      span.setAttribute(
        SemanticAttributes.GEN_AI_RESPONSE_FINISH_REASONS,
        postGenInput.result.finishReason,
      );
      span.setStatus("ok");
      span.end();
      generationSpans.delete(requestKey(postGenInput));
      return {};
    },

    PostGenerateFailure: async (input) => {
      if (input.hook_event_name !== "PostGenerateFailure") return {};
      const failureInput = input as PostGenerateFailureInput;
      const activeSpan = generationSpans.get(requestKey(failureInput));
      if (!activeSpan) return {};
      const { span } = activeSpan;

      applyExecutionAttributes(span, failureInput.telemetry);
      span.recordException(failureInput.error);
      span.end();
      generationSpans.delete(requestKey(failureInput));
      return {};
    },

    GenerationRetryDecision: async (input) => {
      if (input.hook_event_name !== "GenerationRetryDecision") return {};
      const retryInput = input as GenerationRetryDecisionInput;
      const activeSpan = generationSpans.get(requestKey(retryInput));
      if (!activeSpan) return {};
      const { span } = activeSpan;

      span.addEvent("generation.retry_decision", {
        "agent.retry.attempt": retryInput.retryAttempt,
        "agent.retry.delay_ms": retryInput.retryDelayMs,
        "agent.retry.decision": retryInput.decision,
        "agent.retry.failure_type": retryInput.failureClassification.type,
      });
      return {};
    },

    PreToolUse: async (input, toolUseId) => {
      if (input.hook_event_name !== "PreToolUse" || !toolUseId) return {};
      pruneAll();
      const preToolInput = input as PreToolUseInput;
      const parentSpan = generationSpans.get(requestKey(preToolInput))?.span;
      const span = tracer.startSpan(`tool.${preToolInput.tool_name}`, {
        parent: parentSpan ? spanContext(parentSpan) : undefined,
        attributes: {
          [SemanticAttributes.TOOL_NAME]: preToolInput.tool_name,
        },
      });
      applyExecutionAttributes(span, preToolInput.telemetry);
      toolSpans.set(toolUseId, { span, startedAt: Date.now() });
      return {};
    },

    PostToolUse: async (input, toolUseId) => {
      if (input.hook_event_name !== "PostToolUse" || !toolUseId) return {};
      const activeSpan = toolSpans.get(toolUseId);
      if (!activeSpan) return {};
      const { span } = activeSpan;

      span.setStatus("ok");
      span.end();
      toolSpans.delete(toolUseId);
      return {};
    },

    PostToolUseFailure: async (input, toolUseId) => {
      if (input.hook_event_name !== "PostToolUseFailure" || !toolUseId) return {};
      const failureInput = input as PostToolUseFailureInput;
      const activeSpan = toolSpans.get(toolUseId);
      if (!activeSpan) return {};
      const { span } = activeSpan;

      const error = errorFromUnknown(failureInput.error);
      span.recordException(error);
      span.end();
      toolSpans.delete(toolUseId);
      return {};
    },

    PreCompact: async (input) => {
      if (input.hook_event_name !== "PreCompact") return {};
      pruneAll();
      const preCompactInput = input as PreCompactInput;
      const parentSpan = generationSpans.get(requestKey(preCompactInput))?.span;
      const span = tracer.startSpan("agent.compact", {
        parent: parentSpan ? spanContext(parentSpan) : undefined,
        attributes: {
          "agent.compaction.messages_before": preCompactInput.message_count,
          "agent.compaction.tokens_before": preCompactInput.tokens_before,
        },
      });
      applyExecutionAttributes(span, preCompactInput.telemetry);
      compactionSpans.set(requestKey(preCompactInput), { span, startedAt: Date.now() });
      return {};
    },

    PostCompact: async (input) => {
      if (input.hook_event_name !== "PostCompact") return {};
      const postCompactInput = input as PostCompactInput;
      const activeSpan = compactionSpans.get(requestKey(postCompactInput));
      if (!activeSpan) return {};
      const { span } = activeSpan;

      span.setAttributes({
        "agent.compaction.messages_before": postCompactInput.messages_before,
        "agent.compaction.messages_after": postCompactInput.messages_after,
        "agent.compaction.tokens_before": postCompactInput.tokens_before,
        "agent.compaction.tokens_after": postCompactInput.tokens_after,
        "agent.compaction.tokens_saved": postCompactInput.tokens_saved,
      });
      span.setStatus("ok");
      span.end();
      compactionSpans.delete(requestKey(postCompactInput));
      return {};
    },

    SubagentStart: async (input) => {
      if (input.hook_event_name !== "SubagentStart") return {};
      pruneAll();
      const subagentInput = input as SubagentStartInput;
      const parentSpan = generationSpans.get(requestKey(subagentInput))?.span;
      const span = tracer.startSpan(`subagent.${subagentInput.agent_type}`, {
        parent: parentSpan ? spanContext(parentSpan) : undefined,
        attributes: {
          "agent.subagent.id": subagentInput.agent_id,
          "agent.subagent.type": subagentInput.agent_type,
        },
      });
      applyExecutionAttributes(span, subagentInput.telemetry);
      subagentSpans.set(subagentInput.agent_id, { span, startedAt: Date.now() });
      return {};
    },

    SubagentStop: async (input) => {
      if (input.hook_event_name !== "SubagentStop") return {};
      const subagentInput = input as SubagentStopInput;
      const activeSpan = subagentSpans.get(subagentInput.agent_id);
      if (!activeSpan) return {};
      const { span } = activeSpan;

      if (subagentInput.error) {
        span.recordException(subagentInput.error);
      } else {
        span.setStatus("ok");
      }
      span.end();
      subagentSpans.delete(subagentInput.agent_id);
      return {};
    },
  };
}
