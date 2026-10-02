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
import type { ContextEntryInput } from "./types.js";

type ModelMessage = NonNullable<GenerateOptions["messages"]>[number];

/**
 * Generation options a hook may change in log mode. They control how a call
 * runs, not what it says: limits, sampling, cancellation, transport and
 * telemetry. Every other option is fixed for the call. `providerOptions` is
 * deliberately not here: some providers accept model input through it (for
 * example replacement instructions or server-side history), which would
 * bypass the log.
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
  "headers",
  "telemetry",
  "experimental_telemetry",
  "requestClass",
  "onStreamWriterReady",
]);

/** Options that describe the input; the runtime supplies them as pending entries. */
const INPUT_OPTIONS = ["prompt", "messages"] as const;

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

function isOperational(key: string): boolean {
  return LOG_MODE_OPERATIONAL_OPTIONS.has(key as keyof GenerateOptions);
}

// =============================================================================
// Option isolation
// =============================================================================

function plainJson(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    assertContextJson(value);
    return canonicalContextJson(value);
  } catch {
    return undefined;
  }
}

/**
 * Isolates options from the hooks that receive them.
 *
 * Comparison state is captured before any hook runs. Hooks get a view in
 * which:
 *
 * - operational options are passed through (hooks may change them);
 * - other plain-JSON options are deep copies, so mutating them in place
 *   cannot reach the call, and changes are detected by content;
 * - other options that are not plain JSON (for example `output` or
 *   `streamingContext`) are withheld, so hooks cannot reach them at all.
 *
 * `accept` checks the options a hook returned (or the view itself, when the
 * hook returned none, to catch in-place changes) and returns the effective
 * options: the hook's operational options, and the caller's own values for
 * everything else (exempt keys are left out).
 */
function isolateOptions(options: GenerateOptions): {
  view: GenerateOptions;
  accept(next: GenerateOptions, event: HookEvent, exempt?: ReadonlySet<string>): GenerateOptions;
} {
  const snapshots = new Map<string, string>();
  const originals = new Map<string, unknown>();
  const withheld = new Map<string, unknown>();
  const view: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (isOperational(key) || value === undefined) {
      view[key] = value;
      continue;
    }
    const json = plainJson(value);
    if (json === undefined) {
      withheld.set(key, value);
      continue;
    }
    snapshots.set(key, json);
    originals.set(key, value);
    view[key] = JSON.parse(json);
  }

  return {
    view: view as GenerateOptions,
    accept(next, event, exempt = new Set()) {
      if (typeof next !== "object" || next === null) {
        throw violation(event, "returned updatedInput that is not an options object");
      }
      const result: Record<string, unknown> = {};
      const keys = new Set([...Object.keys(next), ...snapshots.keys(), ...withheld.keys()]);
      for (const key of keys) {
        const after = (next as Record<string, unknown>)[key];
        if (exempt.has(key)) continue;
        if (isOperational(key)) {
          if (after !== undefined) result[key] = after;
          continue;
        }
        if (withheld.has(key)) {
          // Hooks never saw the value, so they may only leave it absent.
          if (after !== undefined && !Object.is(after, withheld.get(key))) {
            throw violation(event, `changed "${key}"`);
          }
          result[key] = withheld.get(key);
          continue;
        }
        if (plainJson(after) !== snapshots.get(key)) {
          throw violation(
            event,
            key === "prompt" || key === "messages"
              ? `changed "${key}" (history is append-only)`
              : `changed "${key}"`,
          );
        }
        // Unchanged: keep the caller's own value, not the hook's copy.
        if (originals.has(key)) result[key] = originals.get(key);
      }
      return result as GenerateOptions;
    },
  };
}

// =============================================================================
// Presenting new input as text
// =============================================================================

type Path = ReadonlyArray<string | number>;

/** Keys of message parts that are protocol structure, never screened content. */
const STRUCTURAL_KEYS = new Set([
  "type",
  "toolCallId",
  "toolName",
  "approvalId",
  "mediaType",
  "providerOptions",
  "providerMetadata",
  "providerExecuted",
  "signature",
  "data",
  "image",
]);

/**
 * A screened text: a string value, an object key, or a number, located by
 * its path (for a key, the path of the property it names).
 */
interface TextLocation {
  path: Path;
  kind: "value" | "key" | "number";
}

/**
 * Collects every screened text under `value`, in a fixed traversal order.
 *
 * Outside caller data, only string values are screened and structural keys
 * (ids, part types, binary data, provider options) are skipped, so
 * screening never changes a tool call id or a part type. Inside caller data
 * (a tool call's `input`, a JSON tool result's `value`, a runtime context
 * payload) every object key, string and finite number is screened: a secret
 * can sit in a property name or a numeric value as easily as in a string.
 */
function collectTexts(value: unknown, path: Path, data: boolean, into: TextLocation[]): void {
  if (typeof value === "string") {
    into.push({ path, kind: "value" });
    return;
  }
  if (typeof value === "number") {
    if (data && Number.isFinite(value)) into.push({ path, kind: "number" });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectTexts(item, [...path, index], data, into);
    });
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const jsonOutput = record.type === "json" || record.type === "error-json";
  for (const [key, item] of Object.entries(record)) {
    if (data) {
      into.push({ path: [...path, key], kind: "key" });
      collectTexts(item, [...path, key], true, into);
    } else if (key === "input" || (key === "value" && jsonOutput)) {
      collectTexts(item, [...path, key], true, into);
    } else if (!STRUCTURAL_KEYS.has(key)) {
      collectTexts(item, [...path, key], false, into);
    }
  }
}

function readAt(root: unknown, path: Path): unknown {
  let current = root;
  for (const segment of path) current = (current as Record<string | number, unknown>)[segment];
  return current;
}

function readText(root: unknown, location: TextLocation): string {
  if (location.kind === "key") return String(location.path[location.path.length - 1]);
  const value = readAt(root, location.path);
  return location.kind === "number" ? String(value) : (value as string);
}

function setAt(root: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value;
  const parent = readAt(root, path.slice(0, -1)) as Record<string | number, unknown>;
  parent[path[path.length - 1] as string | number] = value;
  return root;
}

/**
 * Writes transformed texts back onto a copy of `root`. Values are written
 * first, by their original paths; keys are renamed afterwards, deepest
 * first, so every path stays valid. A number whose text is unchanged keeps
 * its type; a changed number (for example a redacted one) becomes a string.
 * A rename onto a key the object already has would merge two fields, so it
 * is rejected.
 */
function writeTexts(
  root: unknown,
  locations: readonly TextLocation[],
  texts: readonly string[],
  event: HookEvent,
): unknown {
  let result = structuredClone(root);
  locations.forEach((location, i) => {
    const text = texts[i] as string;
    if (location.kind === "value") result = setAt(result, location.path, text);
    else if (location.kind === "number" && text !== readText(result, location)) {
      result = setAt(result, location.path, text);
    }
  });
  const renames = locations
    .map((location, i) => ({ location, text: texts[i] as string }))
    .filter(({ location }) => location.kind === "key")
    .sort((a, b) => b.location.path.length - a.location.path.length);
  for (const { location, text } of renames) {
    const before = String(location.path[location.path.length - 1]);
    if (text === before) continue;
    const parentPath = location.path.slice(0, -1);
    const parent = readAt(result, parentPath) as Record<string, unknown>;
    if (Object.hasOwn(parent, text)) {
      // Report positions only: either key may be the secret being redacted.
      const keys = Object.keys(parent);
      throw violation(
        event,
        `renamed the key at position ${keys.indexOf(before) + 1} onto the existing key at position ${keys.indexOf(text) + 1} of an object at depth ${parentPath.length}, which would merge two fields of new input`,
      );
    }
    const renamed: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(parent)) {
      Object.defineProperty(renamed, key === before ? text : key, {
        value: item,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    result = setAt(result, parentPath, renamed);
  }
  return result;
}

/** How a pending entry is shown to hooks, and how to write a transform back. */
type Presentation =
  | { kind: "native"; index: number; role: ModelMessage["role"] }
  | {
      kind: "text";
      index: number;
      role: ModelMessage["role"];
      /** Where the screened strings live: the entry's message or its payload. */
      target: "message" | "payload";
      locations: TextLocation[];
    };

/**
 * Shows the pending entries to hooks as model messages that text filters
 * (secrets, guardrails) can read: a message whose content is a string is
 * shown as itself; any other entry is shown as a message of the same role
 * with one text part per screened string (text parts, reasoning, tool call
 * inputs, tool results, runtime context payloads). Retractions and entries
 * without text are not shown. Hooks receive copies.
 */
function present(pending: readonly ContextEntryInput[]): {
  messages: ModelMessage[];
  presentations: Presentation[];
} {
  const messages: ModelMessage[] = [];
  const presentations: Presentation[] = [];
  pending.forEach((entry, index) => {
    if (entry.kind !== "runtime_context" && typeof entry.message.content === "string") {
      messages.push(structuredClone(entry.message));
      presentations.push({ kind: "native", index, role: entry.message.role });
      return;
    }
    const locations: TextLocation[] = [];
    const target = entry.kind === "runtime_context" ? "payload" : "message";
    const root = entry.kind === "runtime_context" ? entry.payload : entry.message;
    if (entry.kind === "runtime_context") collectTexts(root, [], true, locations);
    else collectTexts(entry.message.content, ["content"], false, locations);
    if (locations.length === 0) return;
    const role = entry.kind === "runtime_context" ? "user" : entry.message.role;
    messages.push({
      role,
      content: locations.map((location) => ({
        type: "text" as const,
        text: readText(root, location),
      })),
    } as ModelMessage);
    presentations.push({ kind: "text", index, role, target, locations });
  });
  return { messages, presentations };
}

function readTexts(message: ModelMessage, count: number, event: HookEvent): string[] {
  const content = message.content as unknown;
  if (typeof content === "string" && count === 1) return [content];
  if (
    Array.isArray(content) &&
    content.length === count &&
    content.every(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
  ) {
    return content.map((part) => (part as { text: string }).text);
  }
  throw violation(event, "changed the shape of new input (only its text may be transformed)");
}

/** Writes the hook's view of the new input back onto the pending entries. */
function applyMessages(
  pending: ContextEntryInput[],
  presentations: readonly Presentation[],
  nextMessages: unknown,
  event: HookEvent,
): void {
  if (!Array.isArray(nextMessages) || nextMessages.length !== presentations.length) {
    throw violation(event, "added, removed or dropped messages (history is append-only)");
  }
  presentations.forEach((presentation, position) => {
    const after = nextMessages[position] as ModelMessage;
    if (typeof after !== "object" || after === null) {
      throw violation(event, "replaced a new message with a non-message value");
    }
    if (after.role !== presentation.role) {
      throw violation(event, `changed the role of a new ${presentation.role} message`);
    }
    const entry = pending[presentation.index] as ContextEntryInput;
    if (presentation.kind === "native") {
      // Native presentation is only used for messages with string content.
      if (entry.kind === "runtime_context") return;
      // Only the text may change: the content stays a string and every
      // other message field (for example providerOptions) stays as it was.
      if (typeof after.content !== "string") {
        throw violation(event, "changed the shape of new input (only its text may be transformed)");
      }
      const { content: _before, ...originalRest } = entry.message;
      const { content: _after, ...nextRest } = after;
      // Committed messages must be plain JSON, so a field that is not counts
      // as a change rather than letting two failed serialisations compare equal.
      const original = plainJson(originalRest);
      if (original === undefined || plainJson(nextRest) !== original) {
        throw violation(event, "changed a field other than the text of a new message");
      }
      pending[presentation.index] = {
        ...entry,
        message: { ...entry.message, content: after.content },
      } as ContextEntryInput;
      return;
    }
    const texts = readTexts(after, presentation.locations.length, event);
    if (entry.kind === "runtime_context") {
      const payload = writeTexts(entry.payload, presentation.locations, texts, event);
      pending[presentation.index] = { ...entry, payload: payload as typeof entry.payload };
      return;
    }
    const message = writeTexts(entry.message, presentation.locations, texts, event);
    pending[presentation.index] = { ...entry, message } as ContextEntryInput;
  });
}

// =============================================================================
// PreGenerate
// =============================================================================

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
   * input, producer output, tool results and any imported history. Never
   * committed entries.
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

/**
 * Runs PreGenerate hooks for a log-mode call, before its input is committed.
 *
 * Unlike legacy mode, where every hook sees the same input and the first
 * `updatedInput` wins, log-mode hooks run **one after another**: each hook
 * sees the input as the previous hooks left it, and every transform is kept.
 * An operational hook can therefore never discard the secrets filter's
 * redaction. Any hook's denial stops the call.
 *
 * Hooks receive the call's options with `messages` set to the **new** input
 * only (see `present`); committed history is never shown, so it cannot be
 * rewritten. A hook may:
 *
 * - deny the call (`permissionDecision: "deny"`), which throws
 *   {@link GeneratePermissionDeniedError} before anything is committed;
 * - change operational options ({@link LOG_MODE_OPERATIONAL_OPTIONS});
 * - transform the text of the new messages, for example to redact secrets.
 *   The transforms are written back to the pending entries without changing
 *   their structure, ids or part types, so the redacted content is what gets
 *   committed.
 *
 * Any other change throws a {@link ContextLogInvalidError} with reason
 * `log_mode_hook_violation`: adding or removing messages, changing a
 * message's role or shape, setting `prompt`, or changing any non-operational
 * option such as `instructionLayers`, `memory`, `providerOptions` or
 * `threadId`, whether returned or made in place. A `respondWith`
 * short-circuit is also rejected, because its result would never be
 * committed to the log.
 *
 * @internal
 */
export async function invokeLogModePreGenerateHooks(
  params: LogModePreGenerateParams,
): Promise<LogModePreGenerateResult> {
  const { hooks, agent } = params;
  const pending = [...params.pending];
  let options = withoutInput(params.options);
  const messagesExempt = new Set(["messages"]);

  for (const hook of hooks) {
    const isolated = isolateOptions(options);
    const { messages, presentations } = present(pending);
    const view: GenerateOptions = { ...isolated.view, messages };
    const outputs = await invokeHooksWithTimeout(
      [hook],
      buildPreGenerateInput(view, agent),
      null,
      agent,
    );

    throwIfGenerationDenied(outputs);
    if (extractRespondWith(outputs) !== undefined) {
      throw violation("PreGenerate", "returned respondWith (a response that is never committed)");
    }

    // Without updatedInput the view is still checked: a hook may have
    // changed it in place.
    const next = extractUpdatedInput<GenerateOptions>(outputs) ?? view;
    options = isolated.accept(next, "PreGenerate", messagesExempt);
    applyMessages(pending, presentations, next.messages, "PreGenerate");
  }

  return { options, pending };
}

// =============================================================================
// Retries
// =============================================================================

/**
 * Guards the options of a log-mode retry.
 *
 * @internal
 */
export interface LogModeRetryGuard {
  /** Isolated options to hand to the `PostGenerateFailure` hooks. */
  options: GenerateOptions;
  /**
   * Checks the options a hook or retry policy returned (or, when none was
   * returned, the isolated options themselves) and returns the options for
   * the next attempt: the returned operational options and the attempt's own
   * values for everything else, including its unchanged input.
   *
   * @throws {ContextLogInvalidError} With reason `log_mode_hook_violation`
   */
  accept(next?: GenerateOptions): GenerateOptions;
}

/**
 * Captures a failed attempt's options **before** the `PostGenerateFailure`
 * hooks run. In log mode the call's input is already committed, so a retry
 * may only change operational options. Pass `guard.options` to the hooks,
 * never the attempt's own options object, then call `guard.accept` with the
 * hook's `updatedInput`: changes made in place are caught as well as
 * returned ones.
 *
 * @param previous - The options of the failed attempt
 * @returns The isolated hook options and the check for the result
 *
 * @internal
 */
export function createLogModeRetryGuard(previous: GenerateOptions): LogModeRetryGuard {
  const isolated = isolateOptions(previous);
  return {
    options: isolated.view,
    accept: (next) => isolated.accept(next ?? isolated.view, "PostGenerateFailure"),
  };
}
