/**
 * Host-owned workflow tool authorisation, enforced before tool hooks and I/O.
 *
 * The SDK owns ordering, timeout, cancellation and decision validation. The
 * host owns policy. Agents without the option retain their existing behaviour.
 *
 * @packageDocumentation
 */

import {
  AbortError,
  AgentError,
  ConfigurationError,
  ToolPermissionDeniedError,
} from "./errors/index.js";
import type {
  WorkflowExecutionGateDecision,
  WorkflowExecutionGateOption,
  WorkflowExecutionGateReceipt,
  WorkflowExecutionGateStage,
} from "./types.js";

/**
 * Supported host authorisation contract version.
 * @category Security
 */
export const WORKFLOW_EXECUTION_GATE_CONTRACT_VERSION = 1;

/**
 * Default authority lookup deadline, in milliseconds.
 * @category Security
 */
export const DEFAULT_WORKFLOW_EXECUTION_GATE_TIMEOUT_MS = 10_000;

/**
 * Reason a trusted authorisation decision could not be obtained.
 * @category Security
 */
export type WorkflowExecutionGateCode = "unavailable" | "invalid" | "timeout";

/**
 * A non-retryable failure to obtain a trusted workflow tool decision.
 *
 * @category Security
 */
export class WorkflowExecutionGateError extends AgentError {
  /** Tool whose execution could not be authorised. */
  readonly toolName: string;
  /** Reason the authority check failed. */
  readonly gateCode: WorkflowExecutionGateCode;

  /**
   * Creates an authority lookup error without making it generation-retryable.
   * @param message - Internal diagnostic message
   * @param options - Tool identity, failure classification and optional cause
   */
  constructor(
    message: string,
    options: {
      toolName: string;
      gateCode: WorkflowExecutionGateCode;
      cause?: Error;
      metadata?: Record<string, unknown>;
    },
  ) {
    super(message, {
      code: "AUTHORIZATION_ERROR",
      severity: "error",
      userMessage: `Tool '${options.toolName}' was not authorised: ${
        options.gateCode === "timeout"
          ? "the workflow policy check timed out"
          : options.gateCode === "invalid"
            ? "the workflow policy check returned an invalid decision"
            : "the workflow policy check was unavailable"
      }`,
      retryable: false,
      metadata: {
        toolName: options.toolName,
        gateCode: options.gateCode,
        ...options.metadata,
      },
      cause: options.cause,
    });
    this.name = "WorkflowExecutionGateError";
    this.toolName = options.toolName;
    this.gateCode = options.gateCode;
  }
}

/**
 * Validated gate configuration with a concrete lookup deadline.
 * @internal
 */
export interface ResolvedWorkflowExecutionGate {
  version: 1;
  authorize: WorkflowExecutionGateOption["authorize"];
  timeoutMs: number;
  signal?: AbortSignal;
  onDecision?: WorkflowExecutionGateOption["onDecision"];
}

/**
 * Validates a host gate at construction; an absent option leaves gating off.
 *
 * @param option - Host configuration, if enforcement is required
 * @returns Validated configuration or undefined when no gate was supplied
 * @throws {ConfigurationError} For an unsupported version, callback or deadline
 * @category Security
 */
export function resolveWorkflowExecutionGate(
  option: WorkflowExecutionGateOption | undefined,
): ResolvedWorkflowExecutionGate | undefined {
  if (option === undefined) return undefined;
  if (typeof option !== "object" || option === null) {
    throw new ConfigurationError("workflowExecutionGate must be an object", {
      configKey: "workflowExecutionGate",
    });
  }
  if (option.version !== WORKFLOW_EXECUTION_GATE_CONTRACT_VERSION) {
    throw new ConfigurationError(
      `workflowExecutionGate.version must be ${WORKFLOW_EXECUTION_GATE_CONTRACT_VERSION}`,
      { configKey: "workflowExecutionGate.version", actualValue: option.version },
    );
  }
  if (typeof option.authorize !== "function") {
    throw new ConfigurationError("workflowExecutionGate.authorize must be a function", {
      configKey: "workflowExecutionGate.authorize",
    });
  }
  const timeoutMs = option.timeoutMs ?? DEFAULT_WORKFLOW_EXECUTION_GATE_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigurationError(
      "workflowExecutionGate.timeoutMs must be a finite positive number",
      {
        configKey: "workflowExecutionGate.timeoutMs",
        actualValue: timeoutMs,
      },
    );
  }
  return {
    version: WORKFLOW_EXECUTION_GATE_CONTRACT_VERSION,
    authorize: option.authorize,
    timeoutMs,
    signal: option.signal,
    onDecision: option.onDecision,
  };
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new AbortError("Workflow execution gate cancelled", {
        reason: typeof reason === "string" ? reason : undefined,
      });
}

function emitReceipt(
  gate: ResolvedWorkflowExecutionGate,
  receipt: WorkflowExecutionGateReceipt,
): void {
  try {
    const pending = gate.onDecision?.(receipt);
    if (pending) void Promise.resolve(pending).catch(() => {});
  } catch {
    // Diagnostics cannot change an authorisation decision.
  }
}

function isValidDecision(value: unknown): value is WorkflowExecutionGateDecision {
  if (typeof value !== "object" || value === null || !("decision" in value)) return false;
  if (value.decision === "allow") return true;
  return (
    value.decision === "deny" &&
    (!("reason" in value) || value.reason === undefined || typeof value.reason === "string")
  );
}

type GateOutcome =
  | { kind: "cancelled"; signal: AbortSignal }
  | { kind: "timeout" }
  | { kind: "threw"; error: unknown }
  | { kind: "settled"; value: unknown };

/**
 * Authorises one tool boundary; only an explicit allow resolves successfully.
 *
 * @param gate - Validated host configuration
 * @param request - Tool input/identity, boundary and optional per-call signal
 * @returns Resolves when protected work may proceed
 * @throws {ToolPermissionDeniedError} When the host denies the call
 * @throws {WorkflowExecutionGateError} When no trusted decision is available
 * @throws {Error} When the run or tool-call signal is cancelled
 * @category Security
 */
export async function authorizeWorkflowToolCall(
  gate: ResolvedWorkflowExecutionGate,
  request: {
    toolName: string;
    toolInput: unknown;
    toolCallId: string;
    sessionId: string;
    stage: WorkflowExecutionGateStage;
    signal?: AbortSignal;
  },
): Promise<void> {
  const startedAt = Date.now();
  const { toolName, toolCallId, sessionId, stage } = request;
  const receiptBase = { toolName, toolCallId, sessionId, stage };
  const cancelled = (signal: AbortSignal): Error => {
    emitReceipt(gate, {
      ...receiptBase,
      outcome: "cancelled",
      code: "cancelled",
      durationMs: Date.now() - startedAt,
    });
    return abortReason(signal);
  };
  const unavailable = (gateCode: WorkflowExecutionGateCode, cause?: Error) => {
    emitReceipt(gate, {
      ...receiptBase,
      outcome: "unavailable",
      code: gateCode,
      durationMs: Date.now() - startedAt,
    });
    return new WorkflowExecutionGateError(
      `Tool '${toolName}' could not be authorised by the workflow execution gate (${gateCode})`,
      { toolName, gateCode, cause, metadata: { stage } },
    );
  };

  const sources = [gate.signal, request.signal].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  for (const source of sources) {
    if (source.aborted) throw cancelled(source);
  }

  const composed = new AbortController();
  const listeners: Array<[AbortSignal, () => void]> = [];
  for (const source of sources) {
    const onAbort = () => composed.abort(source.reason);
    source.addEventListener("abort", onAbort, { once: true });
    listeners.push([source, onAbort]);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onComposedAbort: (() => void) | undefined;
  let settled = false;
  const cleanup = () => {
    settled = true;
    clearTimeout(timer);
    for (const [source, onAbort] of listeners) source.removeEventListener("abort", onAbort);
    if (onComposedAbort) composed.signal.removeEventListener("abort", onComposedAbort);
  };

  try {
    const outcome = await new Promise<GateOutcome>((resolve) => {
      const finish = (value: GateOutcome) => {
        if (settled) return;
        cleanup();
        resolve(value);
      };
      onComposedAbort = () => finish({ kind: "cancelled", signal: composed.signal });
      composed.signal.addEventListener("abort", onComposedAbort, { once: true });
      timer = setTimeout(() => {
        // Timeout must win before aborting the host lookup; it is not a caller cancellation.
        finish({ kind: "timeout" });
        composed.abort(new AbortError("Workflow execution gate timed out", { reason: "timeout" }));
      }, gate.timeoutMs);
      let pending: Promise<WorkflowExecutionGateDecision>;
      try {
        pending = Promise.resolve(gate.authorize({ ...request, signal: composed.signal }));
      } catch (error) {
        finish({ kind: "threw", error });
        return;
      }
      // Observe late rejection/allow without reopening a timed-out or cancelled call.
      pending.then(
        (value) => finish({ kind: "settled", value }),
        (error: unknown) => finish({ kind: "threw", error }),
      );
    });

    switch (outcome.kind) {
      case "cancelled":
        throw cancelled(outcome.signal);
      case "timeout":
        throw unavailable("timeout");
      case "threw":
        throw unavailable(
          "unavailable",
          outcome.error instanceof Error ? outcome.error : undefined,
        );
      case "settled": {
        if (!isValidDecision(outcome.value)) throw unavailable("invalid");
        if (outcome.value.decision === "deny") {
          emitReceipt(gate, {
            ...receiptBase,
            outcome: "deny",
            code: "denied",
            durationMs: Date.now() - startedAt,
          });
          throw new ToolPermissionDeniedError(
            `Tool '${toolName}' execution denied by workflow execution gate`,
            {
              toolName,
              toolInput: request.toolInput,
              reason: outcome.value.reason,
              metadata: { gate: "workflow-execution-gate", gateCode: "denied", stage },
            },
          );
        }
        emitReceipt(gate, {
          ...receiptBase,
          outcome: "allow",
          code: "allowed",
          durationMs: Date.now() - startedAt,
        });
      }
    }
  } finally {
    cleanup();
  }
}

/**
 * Rechecks cancellation after authorisation or an awaited hook.
 * @param gate - Validated gate carrying the optional run signal
 * @param signal - Optional per-tool-call signal
 * @throws {Error} The cancellation reason, before further protected work starts
 * @internal
 */
export function throwIfWorkflowCallCancelled(
  gate: ResolvedWorkflowExecutionGate,
  signal: AbortSignal | undefined,
): void {
  for (const source of [gate.signal, signal]) {
    if (source?.aborted) throw abortReason(source);
  }
}
