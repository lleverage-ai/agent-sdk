/**
 * Errors raised by context log stores and the log-mode runtime.
 *
 * @packageDocumentation
 */

import { AgentError } from "../errors/index.js";
import type { ContextHead } from "./types.js";

/**
 * Category of a {@link ContextLogError}.
 *
 * - `conflict` - The request lost a race or does not fit the log; reload and re-plan
 * - `not_found` - The thread, version or manifest does not exist, or was purged
 * - `refused` - The store or admission refused the request; do not retry it unchanged
 * - `unavailable` - A transient failure; the same request may be retried
 * - `invalid` - The request is malformed
 *
 * @experimental
 * @category Context Log
 */
export type ContextLogErrorKind = "conflict" | "not_found" | "refused" | "unavailable" | "invalid";

/**
 * Why a request conflicted with the log.
 *
 * - `head_moved` - The head's revision is not the expected one, or the head moved past the manifest
 * - `idempotency_mismatch` - The idempotency key was already used for a different request
 * - `invalid_transition` - The transition (or its absence) does not fit the stream
 * - `key_taken` - An entry key already exists on the target path
 * - `dispatch_already_started` - The call was already dispatched or closed
 * - `invalid_lifecycle` - The call is not in a state that allows the operation
 * - `invalid_supersession` - A `supersedes` target is not an active runtime context entry earlier on the path
 * - `interrupt_pending` - The log-mode runtime refused to plan a call on a stream with an unresolved interrupt; resume it first
 * - `resume_in_doubt` - A log-mode resume found the interrupt's resolution but not its result, so the tool may already have run
 *
 * Stores may report additional, store-specific reasons.
 *
 * @experimental
 * @category Context Log
 */
export type ContextLogConflictReason =
  | "head_moved"
  | "idempotency_mismatch"
  | "invalid_transition"
  | "key_taken"
  | "dispatch_already_started"
  | "invalid_lifecycle"
  | "invalid_supersession"
  | (string & {});

/**
 * Kind of record a {@link ContextLogNotFoundError} refers to.
 *
 * @experimental
 * @category Context Log
 */
export type ContextLogResource = "thread" | "version" | "manifest" | (string & {});

const CONTEXT_LOG_ERROR_KINDS: ReadonlySet<string> = new Set<ContextLogErrorKind>([
  "conflict",
  "not_found",
  "refused",
  "unavailable",
  "invalid",
]);

/**
 * Base class for context log errors.
 *
 * Use {@link isContextLogError} rather than `instanceof` when the error may
 * come from a different copy of the SDK.
 *
 * @experimental
 * @category Context Log
 */
export class ContextLogError extends AgentError {
  /** Error category. */
  readonly kind: ContextLogErrorKind;
  /** Machine-readable reason within the category. */
  readonly reason: string;

  constructor(
    kind: ContextLogErrorKind,
    reason: string,
    message: string,
    options: { retryable?: boolean; cause?: Error; metadata?: Record<string, unknown> } = {},
  ) {
    super(message, {
      code: "CONTEXT_ERROR",
      retryable: options.retryable ?? false,
      cause: options.cause,
      metadata: { ...options.metadata, kind, reason },
    });
    this.name = "ContextLogError";
    this.kind = kind;
    this.reason = reason;
  }
}

/**
 * The request lost a compare-and-swap race or does not fit the log. The
 * caller must not dispatch its candidate; it reloads the head and re-plans.
 *
 * @experimental
 * @category Context Log
 */
export class ContextLogConflictError extends ContextLogError {
  /** The stream's head when the conflict was detected, when known. */
  readonly head: ContextHead | null;

  constructor(
    reason: ContextLogConflictReason,
    options: { head?: ContextHead | null; message?: string; cause?: Error } = {},
  ) {
    super("conflict", reason, options.message ?? `Context log conflict: ${reason}`, {
      cause: options.cause,
    });
    this.name = "ContextLogConflictError";
    this.head = options.head ?? null;
  }
}

/**
 * The thread, version or manifest does not exist, or its content is no longer
 * retained.
 *
 * @experimental
 * @category Context Log
 */
export class ContextLogNotFoundError extends ContextLogError {
  /** The kind of record that was not found. */
  readonly resource: ContextLogResource;
  /** Identifier of the missing record, when known. */
  readonly id: string | undefined;

  constructor(resource: ContextLogResource, id?: string, options: { cause?: Error } = {}) {
    super(
      "not_found",
      `${resource}_not_found`,
      `Context log ${resource} not found${id ? `: ${id}` : ""}`,
      options,
    );
    this.name = "ContextLogNotFoundError";
    this.resource = resource;
    this.id = id;
  }
}

/**
 * The store or the host's admission hook refused the request, for example
 * because access was revoked or a fact needed to decide was unavailable.
 * Retrying the same request will not help.
 *
 * @experimental
 * @category Context Log
 */
export class ContextLogRefusedError extends ContextLogError {
  constructor(reason: string, options: { message?: string; cause?: Error } = {}) {
    super("refused", reason, options.message ?? `Context log request refused: ${reason}`, {
      cause: options.cause,
    });
    this.name = "ContextLogRefusedError";
  }
}

/**
 * A transient failure, for example a timeout or a lost connection. The
 * outcome of a write is uncertain. Retry `prepare` and `appendOutputs` with
 * exactly the same request to learn it, and repeat `recordOutcome` with the
 * same outcome. Never retry `markDispatched` blindly: read the manifest first
 * (see `ContextLogStore.markDispatched`).
 *
 * @experimental
 * @category Context Log
 */
export class ContextLogUnavailableError extends ContextLogError {
  constructor(reason = "unavailable", options: { message?: string; cause?: Error } = {}) {
    super("unavailable", reason, options.message ?? `Context log unavailable: ${reason}`, {
      retryable: true,
      cause: options.cause,
    });
    this.name = "ContextLogUnavailableError";
  }
}

/**
 * The request is malformed, for example an entry is not JSON-serialisable or
 * two entries share a key.
 *
 * @experimental
 * @category Context Log
 */
export class ContextLogInvalidError extends ContextLogError {
  constructor(reason: string, message?: string) {
    super("invalid", reason, message ?? `Invalid context log request: ${reason}`);
    this.name = "ContextLogInvalidError";
  }
}

/**
 * Checks whether a value is a {@link ContextLogError}, optionally of one kind.
 * Works across copies of the SDK.
 *
 * @param error - The value to check
 * @param kind - Restrict the check to one category
 * @returns `true` when the value is a context log error of the given kind
 *
 * @example
 * ```typescript
 * try {
 *   await store.prepare(request);
 * } catch (error) {
 *   if (isContextLogError(error, "conflict")) {
 *     // reload the head and re-plan
 *   }
 * }
 * ```
 *
 * @experimental
 * @category Context Log
 */
export function isContextLogError(
  error: unknown,
  kind?: ContextLogErrorKind,
): error is ContextLogError {
  if (typeof error !== "object" || error === null) return false;
  if (!(error instanceof ContextLogError)) {
    // A ContextLogError from another copy of the SDK.
    const candidate = error as Partial<ContextLogError>;
    if (
      !(error instanceof Error) ||
      candidate.code !== "CONTEXT_ERROR" ||
      typeof candidate.reason !== "string" ||
      typeof candidate.kind !== "string" ||
      !CONTEXT_LOG_ERROR_KINDS.has(candidate.kind)
    ) {
      return false;
    }
  }
  return kind === undefined || (error as ContextLogError).kind === kind;
}
