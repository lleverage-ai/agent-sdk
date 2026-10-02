/**
 * Hook execution rules for log mode.
 *
 * In log mode the history is append-only by construction. Hooks may append
 * context only through producers, shape a new tool result before it is
 * committed, or gate execution. They may also transform **new**, not yet
 * committed input, which is how the secrets filter and guardrails keep
 * working: redaction is a transform of new content, applied before commit.
 * Committed entries are never shown to a PreGenerate hook, so a hook cannot
 * rewrite them.
 *
 * @packageDocumentation
 */

import { buildPreGenerateInput, throwIfGenerationDenied } from "../generation-helpers.js";
import { extractRespondWith, extractUpdatedInput, invokeHooksWithTimeout } from "../hooks.js";
import type { Agent, GenerateOptions, HookCallback, HookEvent } from "../types.js";
import { ContextLogInvalidError } from "./errors.js";
import { assertContextJson, canonicalContextJson } from "./json.js";
import type { ContextEntryInput, ContextJsonValue, RuntimeContextEntryInput } from "./types.js";

type ModelMessage = NonNullable<GenerateOptions["messages"]>[number];

/**
 * Generation options a hook may change in log mode. They control how a call
 * runs, not what it says: limits, sampling, cancellation, transport and
 * telemetry. Every other option is fixed for the call.
 *
 * @internal
 */
export const LOG_MODE_OPERATIONAL_OPTIONS: ReadonlySet<keyof GenerateOptions> = new Set<
  keyof GenerateOptions
>([
  "maxTokens",
  "temperature",
  "stopSequences",
  "signal",
  "shouldStopAfterStep",
  "providerOptions",
  "headers",
  "telemetry",
  "experimental_telemetry",
  "requestClass",
  "onStreamWriterReady",
]);

/** Options that describe the input; the runtime supplies them as pending entries. */
const INPUT_OPTIONS = ["prompt", "messages"] as const;

/**
 * Input to {@link invokeLogModePreGenerateHooks}.
 *
 * @internal
 */
export interface LogModePreGenerateParams {
  /** PreGenerate hook callbacks, in registration order. */
  hooks: HookCallback[];
  /**
   * The call's generation options. `prompt` and `messages` are ignored: the
   * runtime has already turned new input into `pending` entries.
   */
  options: GenerateOptions;
  /**
   * New entries about to be committed by this call's prepare: the user's
   * input, producer output and any imported history. Never committed entries.
   */
  pending: readonly ContextEntryInput[];
  /** The agent the hooks run for. */
  agent: Agent;
}

/**
 * Result of {@link invokeLogModePreGenerateHooks}.
 *
 * @internal
 */
export interface LogModePreGenerateResult {
  /** Effective options, without `prompt` or `messages`. */
  options: GenerateOptions;
  /** The pending entries after hook transforms (for example redaction), in the same order. */
  pending: ContextEntryInput[];
}

/** How a pending entry is shown to hooks, and how to read it back. */
type Presentation =
  | { kind: "message"; index: number; role: ModelMessage["role"] }
  | { kind: "runtime_context"; index: number; leaves: number };

function violation(event: HookEvent, detail: string): ContextLogInvalidError {
  return new ContextLogInvalidError(
    "log_mode_hook_violation",
    `${event} hook ${detail} in log mode. Log-mode hooks may only change operational options (${[
      ...LOG_MODE_OPERATIONAL_OPTIONS,
    ].join(
      ", ",
    )}), transform new input before it is committed, gate execution, or shape a new tool result. Append context with a ContextProducer instead.`,
  );
}

function withoutInput(options: GenerateOptions): GenerateOptions {
  const rest: GenerateOptions = { ...options };
  for (const key of INPUT_OPTIONS) delete rest[key];
  return rest;
}

/** Strings of a JSON value in a fixed traversal order. */
function stringLeaves(value: ContextJsonValue): string[] {
  const leaves: string[] = [];
  const visit = (current: ContextJsonValue | undefined): void => {
    if (typeof current === "string") leaves.push(current);
    else if (Array.isArray(current)) for (const item of current) visit(item);
    else if (current !== null && typeof current === "object") {
      for (const item of Object.values(current)) visit(item);
    }
  };
  visit(value);
  return leaves;
}

/** Replaces the strings of a JSON value, in the order of {@link stringLeaves}. */
function replaceStringLeaves(
  value: ContextJsonValue,
  replacements: readonly string[],
): ContextJsonValue {
  let next = 0;
  const visit = (current: ContextJsonValue): ContextJsonValue => {
    if (typeof current === "string") return replacements[next++] as string;
    if (Array.isArray(current)) return current.map(visit);
    if (current !== null && typeof current === "object") {
      const copy: { [key: string]: ContextJsonValue } = {};
      for (const [key, item] of Object.entries(current)) {
        if (item !== undefined) copy[key] = visit(item);
      }
      return copy;
    }
    return current;
  };
  return visit(value);
}

/**
 * Shows the pending entries to hooks as model messages. User, assistant and
 * tool result entries are their own messages. A runtime context entry's
 * payload is opaque, so it is shown as a user message with one text part per
 * string in the payload; that lets text filters (secrets, guardrails) scan
 * and redact it. Retractions and payloads without text are not shown.
 *
 * Hooks receive copies, so mutating a presented message in place cannot
 * reach the pending entries without passing the checks below.
 */
function present(pending: readonly ContextEntryInput[]): {
  messages: ModelMessage[];
  presentations: Presentation[];
} {
  const messages: ModelMessage[] = [];
  const presentations: Presentation[] = [];
  pending.forEach((entry, index) => {
    if (entry.kind !== "runtime_context") {
      messages.push(structuredClone(entry.message));
      presentations.push({ kind: "message", index, role: entry.message.role });
      return;
    }
    const leaves = stringLeaves(entry.payload);
    if (leaves.length === 0) return;
    messages.push({
      role: "user",
      content: leaves.map((text) => ({ type: "text" as const, text })),
    });
    presentations.push({ kind: "runtime_context", index, leaves: leaves.length });
  });
  return { messages, presentations };
}

function readRuntimeContextTexts(
  message: ModelMessage,
  leaves: number,
  event: HookEvent,
): string[] {
  if (message.role !== "user") {
    throw violation(event, "changed the role of new runtime context");
  }
  if (typeof message.content === "string" && leaves === 1) return [message.content];
  if (
    Array.isArray(message.content) &&
    message.content.length === leaves &&
    message.content.every((part) => part.type === "text" && typeof part.text === "string")
  ) {
    return message.content.map((part) => (part as { text: string }).text);
  }
  throw violation(
    event,
    "changed the shape of new runtime context (only its text may be transformed)",
  );
}

/** A non-operational option as it was before the hooks ran. */
interface OptionSnapshot {
  value: unknown;
  /** Canonical JSON when the value is plain JSON, so in-place mutation is detected. */
  json: string | undefined;
}

function plainJson(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    assertContextJson(value);
    return canonicalContextJson(value);
  } catch {
    return undefined;
  }
}

/** Snapshots every non-operational option before hooks can touch it. */
function snapshotOptions(options: GenerateOptions): Map<string, OptionSnapshot> {
  const snapshot = new Map<string, OptionSnapshot>();
  for (const [key, value] of Object.entries(options)) {
    if (LOG_MODE_OPERATIONAL_OPTIONS.has(key as keyof GenerateOptions)) continue;
    snapshot.set(key, { value, json: plainJson(value) });
  }
  return snapshot;
}

/** Same value, or equal JSON for plain values a hook rebuilt instead of copying. */
function unchanged(before: OptionSnapshot | undefined, after: unknown): boolean {
  if (before === undefined) return after === undefined;
  if (before.json !== undefined) return plainJson(after) === before.json;
  return Object.is(before.value, after);
}

/**
 * Checks that `next` changes only operational options of a snapshot.
 *
 * @param snapshot - The non-operational options before the hooks ran
 * @param next - The options after the hooks ran
 * @param event - The hook event, for the error message
 * @param exempt - Keys the caller checks separately
 * @throws {ContextLogInvalidError} With reason `log_mode_hook_violation`
 */
function assertOperationalChangesOnly(
  snapshot: ReadonlyMap<string, OptionSnapshot>,
  next: GenerateOptions,
  event: HookEvent,
  exempt: ReadonlySet<string> = new Set(),
): void {
  const keys = new Set([...snapshot.keys(), ...Object.keys(next)]);
  for (const key of keys) {
    if (exempt.has(key) || LOG_MODE_OPERATIONAL_OPTIONS.has(key as keyof GenerateOptions)) continue;
    if (!unchanged(snapshot.get(key), next[key as keyof GenerateOptions])) {
      throw violation(
        event,
        key === "prompt" || key === "messages"
          ? `changed "${key}" (history is append-only)`
          : `changed "${key}"`,
      );
    }
  }
}

/**
 * Runs PreGenerate hooks for a log-mode call, before its input is committed.
 *
 * Hooks receive the call's options with `messages` set to the **new** input
 * only (see `present`); committed history is never shown, so it cannot be
 * rewritten. A hook may:
 *
 * - deny the call (`permissionDecision: "deny"`), which throws
 *   {@link GeneratePermissionDeniedError} before anything is committed;
 * - change operational options ({@link LOG_MODE_OPERATIONAL_OPTIONS});
 * - transform the new messages in place, for example to redact secrets. The
 *   transforms are applied to the pending entries, so the redacted content
 *   is what gets committed.
 *
 * Any other change throws a {@link ContextLogInvalidError} with reason
 * `log_mode_hook_violation`: adding or removing messages,
 * changing a message's role, setting `prompt`, or changing any non-operational
 * option such as `instructionLayers`, `memory`, `output` or `threadId`. A
 * `respondWith` short-circuit is also rejected, because its result would
 * never be committed to the log.
 *
 * @internal
 */
export async function invokeLogModePreGenerateHooks(
  params: LogModePreGenerateParams,
): Promise<LogModePreGenerateResult> {
  const { hooks, agent } = params;
  const pending = [...params.pending];
  const baseOptions = withoutInput(params.options);
  if (hooks.length === 0) return { options: baseOptions, pending };

  const snapshot = snapshotOptions(baseOptions);
  const { messages, presentations } = present(pending);
  const presented: GenerateOptions = { ...baseOptions, messages };
  const outputs = await invokeHooksWithTimeout(
    hooks,
    buildPreGenerateInput(presented, agent),
    null,
    agent,
  );

  throwIfGenerationDenied(outputs);

  if (extractRespondWith(outputs) !== undefined) {
    throw violation("PreGenerate", "returned respondWith (a response that is never committed)");
  }

  // Without updatedInput, the presented options are still checked: a hook
  // may have mutated them in place.
  const next = extractUpdatedInput<GenerateOptions>(outputs) ?? presented;
  if (typeof next !== "object" || next === null) {
    throw violation("PreGenerate", "returned updatedInput that is not an options object");
  }

  assertOperationalChangesOnly(snapshot, next, "PreGenerate", new Set(["messages"]));

  const nextMessages = next.messages;
  if (!Array.isArray(nextMessages) || nextMessages.length !== presentations.length) {
    throw violation("PreGenerate", "added, removed or dropped messages (history is append-only)");
  }

  presentations.forEach((presentation, position) => {
    const after = nextMessages[position] as ModelMessage;
    if (typeof after !== "object" || after === null) {
      throw violation("PreGenerate", "replaced a new message with a non-message value");
    }
    const entry = pending[presentation.index] as ContextEntryInput;
    if (presentation.kind === "message") {
      if (after.role !== presentation.role) {
        throw violation("PreGenerate", `changed the role of a new ${presentation.role} message`);
      }
      pending[presentation.index] = { ...entry, message: after } as ContextEntryInput;
      return;
    }
    const runtime = entry as RuntimeContextEntryInput;
    const texts = readRuntimeContextTexts(after, presentation.leaves, "PreGenerate");
    pending[presentation.index] = {
      ...runtime,
      payload: replaceStringLeaves(runtime.payload, texts),
    };
  });

  return { options: withoutInput(next), pending };
}

/**
 * Checks the options a `PostGenerateFailure` hook returned for a retry. In
 * log mode the call's input is already committed, so a retry may only change
 * operational options.
 *
 * @param previous - The options of the failed attempt
 * @param next - The options a hook returned for the next attempt
 * @returns `next` without `prompt` or `messages`
 * @throws {ContextLogInvalidError} With reason `log_mode_hook_violation`
 *
 * @internal
 */
export function assertLogModeRetryOptions(
  previous: GenerateOptions,
  next: GenerateOptions,
): GenerateOptions {
  assertOperationalChangesOnly(
    snapshotOptions(withoutInput(previous)),
    next,
    "PostGenerateFailure",
  );
  return withoutInput(next);
}
