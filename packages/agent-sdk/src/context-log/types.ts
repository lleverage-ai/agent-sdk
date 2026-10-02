/**
 * Contracts for the experimental context log mode.
 *
 * In log mode the persisted entries of a context log are the source of truth
 * for an agent's history, and every model request is a projection of one path
 * through that log. The types here are deliberately generic: they carry no
 * host-specific access, audience or product semantics. Hosts attach their own
 * data through the `metadata` bags.
 *
 * @packageDocumentation
 */

import type { AssistantModelMessage, ModelMessage, ToolModelMessage, UserModelMessage } from "ai";

// =============================================================================
// JSON values and metadata
// =============================================================================

/**
 * A JSON value that a context log store can persist and return unchanged.
 *
 * @experimental
 * @category Context Log
 */
export type ContextJsonValue =
  | string
  | number
  | boolean
  | null
  | ContextJsonValue[]
  | { [key: string]: ContextJsonValue };

/**
 * A JSON object that a context log store can persist and return unchanged.
 *
 * @experimental
 * @category Context Log
 */
export type ContextJsonObject = { [key: string]: ContextJsonValue };

/**
 * Generic, host-defined metadata attached to entries, versions, manifests and
 * outcomes.
 *
 * The SDK never interprets it. A host can use it for provenance, trust labels,
 * routing hints or anything else it needs to keep next to the record. Stores
 * must persist it and return it unchanged.
 *
 * @experimental
 * @category Context Log
 */
export type ContextMetadata = ContextJsonObject;

// =============================================================================
// Streams and models
// =============================================================================

/**
 * Identifies one append-only stream of a context log.
 *
 * A thread holds branches, and each branch holds one or more streams (for
 * example the main conversation and a subagent's own stream). Each stream has
 * its own head.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextStreamRef {
  /** The conversation or session the log belongs to. */
  threadId: string;
  /** The branch within the thread. Use {@link DEFAULT_CONTEXT_BRANCH_ID} for a thread without branches. */
  branchId: string;
  /** The stream within the branch. Use {@link DEFAULT_CONTEXT_STREAM_ID} for the main conversation. */
  streamId: string;
}

/**
 * Identifies the provider and model a request is sent to, or an output came
 * from.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextModelRef {
  /** Provider identifier, for example `anthropic` or `openai`. */
  provider: string;
  /** Provider model identifier. */
  modelId: string;
}

// =============================================================================
// Entries
// =============================================================================

/**
 * Discriminator for {@link ContextEntryInput}.
 *
 * - `user` - A user message
 * - `assistant` - A model output, with provider data preserved
 * - `tool_result` - The result of a tool call, after any shaping
 * - `runtime_context` - Context a {@link ContextProducer} appended for a turn
 *
 * @experimental
 * @category Context Log
 */
export type ContextEntryKind = "user" | "assistant" | "tool_result" | "runtime_context";

/**
 * Fields shared by every entry.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextEntryBase {
  /**
   * Stable key of the entry. Keys are unique along a path, including the
   * prefix a version inherits; sibling branches may reuse a key after the
   * point where they diverge. Deterministic keys make retries idempotent.
   */
  key: string;
  /** Host-defined metadata. The SDK never interprets it. */
  metadata?: ContextMetadata;
}

/**
 * A user message.
 *
 * @experimental
 * @category Context Log
 */
export interface UserContextEntryInput extends ContextEntryBase {
  kind: "user";
  /** The message exactly as the model should see it. Content must be JSON-serialisable. */
  message: UserModelMessage;
}

/**
 * A model output.
 *
 * The message keeps every provider-specific part and option (for example
 * reasoning signatures) so that a later request can replay it byte for byte.
 * Conversion for a different provider happens at projection time, never in
 * the stored entry.
 *
 * @experimental
 * @category Context Log
 */
export interface AssistantContextEntryInput extends ContextEntryBase {
  kind: "assistant";
  /** The output exactly as the provider returned it. Content must be JSON-serialisable. */
  message: AssistantModelMessage;
  /** The provider and model that produced the output. */
  model?: ContextModelRef;
  /** Provider response metadata worth keeping, for example a response id. */
  providerMetadata?: ContextJsonObject;
}

/**
 * The result of one or more tool calls.
 *
 * @experimental
 * @category Context Log
 */
export interface ToolResultContextEntryInput extends ContextEntryBase {
  kind: "tool_result";
  /** The tool message exactly as the model should see it. Content must be JSON-serialisable. */
  message: ToolModelMessage;
}

/**
 * Runtime context appended for a turn, for example the current date or a
 * retrieved document.
 *
 * The payload is opaque to the store and to the SDK runtime; the
 * {@link ProjectionAdapter} decides how it is rendered for the model.
 *
 * @experimental
 * @category Context Log
 */
export interface RuntimeContextEntryInput extends ContextEntryBase {
  kind: "runtime_context";
  /** Name of the {@link ContextProducer} that produced the entry. */
  producer: string;
  /** Opaque payload for the projection adapter. Must be `null` for a retraction. */
  payload: ContextJsonValue;
  /**
   * Key of the entry this one replaces. The earlier entry stays in the log;
   * projection skips it from here on (see `activeContextEntries`).
   *
   * The target must be a `runtime_context` entry that is earlier on the same
   * path (inherited, committed, or earlier in the same request) and still
   * active, that is, not already superseded. A slot therefore forms a single
   * chain. Stores enforce this at commit: a malformed reference is
   * `invalid`, and a target that is not an active runtime context entry on
   * the path is a `conflict` with reason `invalid_supersession`.
   */
  supersedes?: string;
  /**
   * Marks a retraction: the entry only retires the entry it supersedes and is
   * never emitted to the model itself. A retraction requires `supersedes` and
   * a `null` payload.
   * @defaultValue false
   */
  retraction?: boolean;
}

/**
 * An entry to append to a context log.
 *
 * @experimental
 * @category Context Log
 */
export type ContextEntryInput =
  | UserContextEntryInput
  | AssistantContextEntryInput
  | ToolResultContextEntryInput
  | RuntimeContextEntryInput;

/**
 * Where a stored entry sits in the log.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextEntryRecord {
  /** 1-based position on the full path of {@link ContextEntryRecord.versionId}. */
  position: number;
  /** The version that appended the entry. Inherited entries keep their ancestor's version. */
  versionId: string;
  /** The manifest whose prepare or output commit appended the entry. */
  manifestId: string;
  /** When the store committed the entry, as an ISO 8601 timestamp. */
  createdAt: string;
}

/**
 * A committed entry read back from a store.
 *
 * @experimental
 * @category Context Log
 */
export type ContextEntry = ContextEntryInput & ContextEntryRecord;

// =============================================================================
// Versions and transitions
// =============================================================================

/**
 * Why a new version of a stream's context was created.
 *
 * - `initial` - The first version of a stream
 * - `compaction` - A summary replaced some or all of the history
 * - `branch` - A new branch inherits a prefix of another branch
 * - `model_change` - The target model changed in a way the history must follow
 * - `adapter_change` - The projection adapter or its contract changed
 * - `core_policy_change` - The frozen core system changed
 * - `audience_transition` - The host changed who the context is replayed to
 * - `legacy_import` - History imported from a non-log source
 *
 * Hosts may declare their own reasons. Transitions are always declared by
 * their cause; nothing infers them by comparing requests.
 *
 * @experimental
 * @category Context Log
 */
export type ContextTransitionReason =
  | "initial"
  | "compaction"
  | "branch"
  | "model_change"
  | "adapter_change"
  | "core_policy_change"
  | "audience_transition"
  | "legacy_import"
  | (string & {});

/**
 * The prefix of an existing version that a new version keeps.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextVersionParent {
  /** The version to inherit from. It must belong to the same thread and stream id. */
  versionId: string;
  /** How many leading entries of the parent's full path the new version keeps. May be 0. */
  inheritedCount: number;
}

/**
 * A declared change that starts a new version of a stream's context.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextTransition {
  /** Why the version changes. */
  reason: ContextTransitionReason;
  /** The version and prefix to inherit, or `null` to start a root version. */
  parent: ContextVersionParent | null;
  /**
   * Exact bytes of the frozen core system for this version. Opaque to the
   * store; the projection adapter renders it.
   */
  core: string;
  /**
   * The serialisation contract the version is projected under, for example
   * the adapter id and version. Changing it requires a new version.
   */
  contract: Record<string, string>;
  /** Host-defined metadata. */
  metadata?: ContextMetadata;
}

/**
 * An immutable version of a stream's context.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextVersion {
  /** Store-assigned identifier. */
  id: string;
  /** The stream the version was created on. */
  stream: ContextStreamRef;
  /** The version this one inherits from, or `null` for a root version. */
  parentVersionId: string | null;
  /** Leading entries of the parent's path this version keeps. */
  inheritedCount: number;
  /** Why the version was created. */
  reason: ContextTransitionReason;
  /** Exact bytes of the frozen core system. */
  core: string;
  /** The serialisation contract. */
  contract: Record<string, string>;
  /** Host-defined metadata. */
  metadata?: ContextMetadata;
  /** The manifest whose prepare created the version. */
  createdByManifestId: string;
  /** When the version was created, as an ISO 8601 timestamp. */
  createdAt: string;
}

// =============================================================================
// Heads and paths
// =============================================================================

/**
 * A point on a version's full path: the version plus how many leading entries
 * of its path are included.
 *
 * Heads and manifests are both path references, so a manifest always reads
 * back the exact path it committed, however far the head has moved since.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextPathRef {
  /** The stream the reference belongs to. */
  stream: ContextStreamRef;
  /** The version whose full path is read. */
  versionId: string;
  /** Number of leading entries of the full path, including inherited ones. */
  entryCount: number;
}

/**
 * The current boundary of one stream. It only moves forward, by compare and
 * swap on {@link ContextHead.revision}.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextHead extends ContextPathRef {
  /**
   * Opaque digest of the path up to the head, so hosts can cache a projected
   * path by digest. Rereading a head returns the same digest, and every write
   * that adds entries or starts a new version changes it. A prepare without a
   * transition that appends nothing keeps the digest but still moves
   * {@link ContextHead.revision}; use the revision to detect every committed
   * write. Stores choose the algorithm. A store whose own digest depends only
   * on content (for example a root over core, contract and inherited prefix)
   * can expose a version-qualified digest to meet this contract.
   */
  pathDigest: string;
  /** Starts at 1 for a new head and increases by 1 on every move. `0` means no head yet. */
  revision: number;
  /** The manifest whose prepare or output commit last moved the head. */
  lastManifestId: string;
}

/**
 * Options for {@link ContextLogStore.readPath}.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextPathReadOptions {
  /**
   * Return entries after this position.
   * @defaultValue 0
   */
  after?: number;
  /**
   * Maximum entries to return. Stores may return fewer, but always at least
   * one while entries remain.
   * @defaultValue store-defined
   */
  limit?: number;
}

/**
 * One page of a path, in position order.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextPathPage {
  /** Entries in position order. */
  entries: ContextEntry[];
  /** Pass as `after` to read the next page, or `null` when the path is complete. */
  nextAfter: number | null;
}

// =============================================================================
// Manifests and the call lifecycle
// =============================================================================

/**
 * What a model call was prepared to send. Committed before dispatch.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextManifestInput {
  /** The projection adapter the input was built with. */
  projection: { adapter: string; version: string };
  /** The model the call targets. */
  model: ContextModelRef;
  /** Lowercase hexadecimal SHA-256 of the exact serialised request input, computed by the caller. */
  inputDigest: string;
  /**
   * Exact bytes of the tool definitions sent with the call. Optional in the
   * contract; a store may require it.
   */
  toolSnapshot?: string;
  /**
   * Exact bytes of the non-prompt call options. Optional in the contract; a
   * store may require it.
   */
  callOptions?: string;
  /** Model call number within the caller's run. Optional in the contract; a store may require it. */
  ordinal?: number;
  /** Retry attempt for the same ordinal, starting at 1. Optional in the contract; a store may require it. */
  attempt?: number;
  /** Host-defined metadata. */
  metadata?: ContextMetadata;
}

/**
 * Terminal outcome of a model call.
 *
 * - `completed` - The provider returned a complete response
 * - `failed` - The call failed
 * - `cancelled` - The call was abandoned, possibly before dispatch
 * - `unknown` - The process lost track of the call, for example after a crash
 *
 * @experimental
 * @category Context Log
 */
export type ContextCallOutcomeStatus = "completed" | "failed" | "cancelled" | "unknown";

/**
 * The outcome to record for a manifest.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextCallOutcome {
  /** Terminal status. */
  status: ContextCallOutcomeStatus;
  /** Host-defined metadata, for example usage or an error code. */
  metadata?: ContextMetadata;
}

/**
 * A committed manifest.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextManifest extends ContextManifestInput, ContextPathRef {
  /** Store-assigned identifier. */
  id: string;
  /** The caller's idempotency key. Unique within the store's scope. */
  idempotencyKey: string;
  /** Digest of the path the call was prepared with. */
  pathDigest: string;
  /** The head revision the prepare produced. */
  headRevision: number;
  /** When dispatch started, or `null` before dispatch. */
  dispatchedAt: string | null;
  /** The terminal outcome, or `null` while the call is open. */
  outcome: (ContextCallOutcome & { recordedAt: string }) | null;
  /** When the manifest was committed, as an ISO 8601 timestamp. */
  createdAt: string;
}

/**
 * Request for {@link ContextLogStore.prepare}.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextPrepareRequest {
  /** The stream to prepare on. */
  stream: ContextStreamRef;
  /** The head revision the caller built its request from; `0` when the stream has no head. */
  expectedRevision: number;
  /**
   * Caller-chosen key. A retry of exactly the same request (including
   * `expectedRevision`) returns the original result, even after the head has
   * moved; any different request with the same key is a conflict.
   */
  idempotencyKey: string;
  /** A declared transition to a new version. Required when the stream has no head. */
  transition?: ContextTransition;
  /** Entries to append before the call, in order. May be empty. */
  append: ContextEntryInput[];
  /** What the call will send. */
  manifest: ContextManifestInput;
}

/**
 * Result of {@link ContextLogStore.prepare}.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextPrepareResult {
  /** `false` when an earlier prepare with the same idempotency key was returned. */
  created: boolean;
  /** The committed manifest. */
  manifest: ContextManifest;
  /** The stream's current head. */
  head: ContextHead;
}

/**
 * Request for {@link ContextLogStore.appendOutputs}.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextAppendOutputsRequest {
  /** The dispatched manifest that produced the outputs. */
  manifestId: string;
  /** The head revision the caller last observed. */
  expectedRevision: number;
  /** Assistant outputs and tool results, in order. */
  items: Array<AssistantContextEntryInput | ToolResultContextEntryInput>;
}

/**
 * Result of {@link ContextLogStore.appendOutputs}.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextAppendOutputsResult {
  /** `false` when every item was already committed by an earlier identical request. */
  created: boolean;
  /** The committed entries, in order. */
  entries: ContextEntry[];
  /** The stream's current head. */
  head: ContextHead;
}

// =============================================================================
// Store
// =============================================================================

/**
 * Persistence for a context log.
 *
 * Every write is atomic: it either commits completely or leaves the log
 * unchanged. A caller can still lose the response to a write that committed
 * (see {@link ContextLogUnavailableError}); each method documents how to
 * recover. Writes that move a head are conditional on the caller's expected
 * revision. Entries, versions and manifests are immutable once committed,
 * except a manifest's dispatch time and outcome.
 *
 * Methods reject with a {@link ContextLogError}:
 *
 * - {@link ContextLogConflictError} - The request lost a race or does not fit the log; reload and re-plan
 * - {@link ContextLogNotFoundError} - The thread, version or manifest does not exist (or was purged)
 * - {@link ContextLogRefusedError} - The store refused the request, for example because access was revoked
 * - {@link ContextLogUnavailableError} - A transient failure; the request may be retried unchanged
 * - {@link ContextLogInvalidError} - The request is malformed
 *
 * Run `defineContextLogStoreConformanceSuite` from
 * `@lleverage-ai/agent-sdk/testing` against any implementation.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextLogStore {
  /** Reads a stream's head, or `null` when the stream has none. */
  readHead(stream: ContextStreamRef): Promise<ContextHead | null>;

  /**
   * Reads one page of a path, in position order.
   *
   * The result depends only on the reference, never on later appends, so a
   * manifest reads back exactly the path it committed.
   */
  readPath(ref: ContextPathRef, options?: ContextPathReadOptions): Promise<ContextPathPage>;

  /** Reads a committed version. */
  readVersion(versionId: string): Promise<ContextVersion>;

  /** Reads a committed manifest. */
  readManifest(manifestId: string): Promise<ContextManifest>;

  /**
   * Commits the input of one model call before it is dispatched: an optional
   * transition, the entries to append and the manifest, conditional on
   * `expectedRevision`. Moves the head by one revision.
   *
   * After an uncertain result (for example a timeout), retry with the same
   * idempotency key and request to learn the outcome.
   */
  prepare(request: ContextPrepareRequest): Promise<ContextPrepareResult>;

  /**
   * Records that dispatch of a prepared call started. Conflicts when the
   * call was already dispatched or closed, or when the head has moved past
   * the manifest, so a stale candidate is never sent.
   *
   * Send the call only after this resolves. It is deliberately not
   * idempotent: after an uncertain result, read the manifest instead of
   * retrying. If `dispatchedAt` is still `null`, call this again; if it is set,
   * do not send, close the call (for example as `cancelled`) and prepare a new
   * attempt.
   */
  markDispatched(manifestId: string): Promise<ContextManifest>;

  /**
   * Appends a dispatched call's outputs. The write is conditional on
   * `expectedRevision` **and** on the manifest still owning the head
   * (`head.lastManifestId === manifestId`): once a later prepare has moved
   * the head, the call's late outputs are refused with a `head_moved`
   * conflict, even when the caller supplies the new head's revision, so they
   * can never enter a newer call's context. Allowed until the call has an
   * outcome other than `completed`.
   *
   * After an uncertain result, retry exactly the same request: a committed
   * request returns its entries with `created: false`, even after the head has
   * moved on.
   */
  appendOutputs(request: ContextAppendOutputsRequest): Promise<ContextAppendOutputsResult>;

  /**
   * Records a call's terminal outcome. Repeating the same status is a no-op;
   * a different status conflicts. Only `cancelled` may be recorded before
   * dispatch.
   */
  recordOutcome(manifestId: string, outcome: ContextCallOutcome): Promise<ContextManifest>;
}

// =============================================================================
// Producers, projection and admission
// =============================================================================

/**
 * Input to a {@link ContextProducer}.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextProducerInput {
  /** The stream the turn runs on. */
  stream: ContextStreamRef;
  /** The stream's current head, or `null` before the first call. */
  head: ContextHead | null;
  /** The committed path at the head, in position order. */
  path: readonly ContextEntry[];
  /** Aborts when the turn is cancelled. */
  signal?: AbortSignal;
}

/**
 * Produces runtime context to append before a model call.
 *
 * Producers only append. They must be deterministic for the same inputs and
 * path, so a retry re-derives the same entries. The runtime drops entries
 * whose key is already on the path (deduplication), and an entry that names
 * `supersedes` replaces an earlier entry at projection time without removing
 * it from the log.
 *
 * @example
 * ```typescript
 * const clock: ContextProducer = {
 *   name: "clock",
 *   produce: () => {
 *     const today = new Date().toISOString().slice(0, 10);
 *     return [{ kind: "runtime_context", key: `clock:${today}`, producer: "clock", payload: { today } }];
 *   },
 * };
 * ```
 *
 * @experimental
 * @category Context Log
 */
export interface ContextProducer {
  /** Producer key, recorded on each entry it produces. */
  readonly name: string;
  /** Returns the entries to append for this turn. */
  produce(
    input: ContextProducerInput,
  ): readonly RuntimeContextEntryInput[] | Promise<readonly RuntimeContextEntryInput[]>;
}

/**
 * Input to a {@link ProjectionAdapter}.
 *
 * @experimental
 * @category Context Log
 */
export interface ProjectionInput {
  /** The version being projected; provides the frozen core and contract. */
  version: ContextVersion;
  /** The full path, in position order, including superseded entries. */
  entries: readonly ContextEntry[];
  /** The model the request will be sent to. */
  target: ContextModelRef;
}

/**
 * The model input a projection produces.
 *
 * @experimental
 * @category Context Log
 */
export interface ProjectedModelInput {
  /** Messages to send, including the projected core system messages. */
  messages: ModelMessage[];
}

/**
 * Turns a path into model messages.
 *
 * Projection must be deterministic for the same version, entries and target,
 * and versioned: a change to its output for an existing path needs a new
 * {@link ProjectionAdapter.version} and an `adapter_change` transition.
 * Cross-provider conversion (for example dropping another provider's
 * reasoning signatures) happens here, never to stored entries.
 *
 * @experimental
 * @category Context Log
 */
export interface ProjectionAdapter {
  /** Adapter identifier, recorded on manifests. */
  readonly id: string;
  /** Adapter version, recorded on manifests. */
  readonly version: string;
  /** Projects a path into model input. */
  project(input: ProjectionInput): ProjectedModelInput | Promise<ProjectedModelInput>;
}

/**
 * Input to a {@link ContextAdmitHook}.
 *
 * - `prepare` - Before a call's input is committed
 * - `dispatch` - Before a committed call is sent
 *
 * @experimental
 * @category Context Log
 */
export type ContextAdmitInput =
  | {
      phase: "prepare";
      /** The stream's head the request was built from. */
      head: ContextHead | null;
      /** The request about to be committed. */
      request: ContextPrepareRequest;
    }
  | {
      phase: "dispatch";
      /** The stream's current head. */
      head: ContextHead | null;
      /** The committed manifest about to be sent. */
      manifest: ContextManifest;
    };

/**
 * Decision of a {@link ContextAdmitHook}.
 *
 * @experimental
 * @category Context Log
 */
export type ContextAdmitDecision = { allow: true } | { allow: false; reason: string };

/**
 * Host hook that authorises every prepare and every dispatch, for example by
 * re-checking access and validating declared transitions. A refusal stops the
 * call with a {@link ContextLogRefusedError}. The hook never rewrites the
 * request.
 *
 * @experimental
 * @category Context Log
 */
export type ContextAdmitHook = (
  input: ContextAdmitInput,
) => ContextAdmitDecision | Promise<ContextAdmitDecision>;

// =============================================================================
// Agent option
// =============================================================================

/**
 * Context log mode.
 *
 * - `off` - Legacy history handling; the context log is not used
 * - `log` - Persisted entries are the source of truth and each request is a projection
 *
 * @experimental
 * @category Context Log
 */
export type ContextLogMode = "off" | "log";

/**
 * Configuration for the experimental context log mode.
 *
 * Log mode is off by default, and an agent without this option behaves
 * exactly as before. The log-mode runtime is still being built: in this
 * release `createAgent` rejects `mode: "log"`.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextLogOptions {
  /**
   * Whether log mode is active.
   * @defaultValue "off"
   */
  mode?: ContextLogMode;
  /** Where the log is persisted. */
  store: ContextLogStore;
  /** Turns a path into model messages. */
  projection?: ProjectionAdapter;
  /** Producers that append runtime context before each call. */
  producers?: readonly ContextProducer[];
  /** Authorises every prepare and dispatch. */
  admit?: ContextAdmitHook;
}

/**
 * Default branch id for threads without branches.
 *
 * @experimental
 * @category Context Log
 */
export const DEFAULT_CONTEXT_BRANCH_ID = "main";

/**
 * Default stream id for a branch's main conversation.
 *
 * @experimental
 * @category Context Log
 */
export const DEFAULT_CONTEXT_STREAM_ID = "main";
