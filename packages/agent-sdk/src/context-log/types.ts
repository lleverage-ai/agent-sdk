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

import type {
  AssistantModelMessage,
  LanguageModel,
  LanguageModelMiddleware,
  ModelMessage,
  ToolModelMessage,
  UserModelMessage,
} from "ai";
import type { SubagentStreamResolver } from "./delegation.js";

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
  /**
   * Set when the call's tool definitions differ from the previous call's on
   * the same stream, so a change in the cached prefix can be attributed.
   * `cause` is `model_change` when the previous call targeted another model,
   * otherwise `tool_definition`. The log-mode runtime sets it; stores persist
   * it unchanged.
   */
  toolSnapshotChange?: ContextToolSnapshotChange;
  /** Host-defined metadata. */
  metadata?: ContextMetadata;
}

/**
 * How a call's tool definitions changed from the previous call's on the same
 * stream.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextToolSnapshotChange {
  /** Lowercase hexadecimal SHA-256 of the previous call's `toolSnapshot`. */
  previousDigest: string;
  /** Lowercase hexadecimal SHA-256 of this call's `toolSnapshot`. */
  digest: string;
  /** Why the definitions changed: `model_change` or `tool_definition`. */
  cause: "model_change" | "tool_definition";
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
  /**
   * Closes the call this prepare supersedes, in the same atomic write. It
   * must be the manifest the head points at (`head.lastManifestId` at
   * `expectedRevision`); anything else is `invalid`. If that call has no
   * outcome, the store records one: `completed` when entries were appended
   * after its prepare (its outputs), otherwise `unknown` when it was
   * dispatched, otherwise `cancelled`. A call with an outcome is left
   * unchanged. Once the head has moved past a call it can never be
   * dispatched or commit outputs, so a crash between this prepare and a
   * separate `recordOutcome` can no longer leave it open for good.
   * Optional and additive: a request without it behaves as before.
   */
  closeSuperseded?: string;
  /**
   * The entries of `append` that are the run's new input, in order, each
   * with its position in that input. Set by the SDK runtime; absent (never
   * an empty array) when the prepare appends no new input.
   *
   * This is how a host tells the run's new input apart from every other
   * `user` entry a prepare may append, without depending on key formats:
   * the summary and the retained tail a compaction re-appends are never
   * listed, and neither is input an earlier prepare of the run already
   * committed (it is never appended again). Retries of the same request
   * carry the same list.
   *
   * Informational for stores and for {@link ContextAdmitHook}s: a store
   * need not persist or validate it. `MemoryContextLogStore` includes
   * it in the request's idempotency digest when it is present.
   */
  runInput?: ContextRunInputRef[];
}

/**
 * Identifies one message of a run's new input among the entries a prepare
 * appends (see {@link ContextPrepareRequest.runInput}).
 *
 * @experimental
 * @category Context Log
 */
export interface ContextRunInputRef {
  /** Key of the `user` entry in the prepare's `append`. */
  key: string;
  /**
   * Zero-based position of the message in the run's input: its index in
   * `GenerateOptions.input`, or `0` for a `prompt`.
   */
  index: number;
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
 * The input carries only content: the version's frozen core and contract,
 * and the content fields of each entry. Store-assigned fields (positions,
 * ids, timestamps) are deliberately absent, because the runtime projects a
 * call's input before it is committed (the manifest records a digest of it)
 * and must reproduce the same bytes from the committed path afterwards.
 *
 * @experimental
 * @category Context Log
 */
export interface ProjectionInput {
  /** Exact bytes of the version's frozen core system. */
  core: string;
  /**
   * The version's serialisation contract. The runtime records the adapter
   * and the target model's media capabilities here (see
   * {@link ContextProjectionContractKey}); an adapter keys any
   * capability-dependent output on these values, never on live settings.
   */
  contract: Readonly<Record<string, string>>;
  /**
   * The full path in position order, including superseded entries, followed
   * by the entries the call is about to append. Pass them through
   * `activeContextEntries` to drop superseded entries and retractions.
   */
  entries: readonly ContextEntryInput[];
  /** The model the request will be sent to. */
  target: ContextModelRef;
}

/**
 * Contract keys the log-mode runtime records on every version it creates and
 * checks before projecting a version.
 *
 * - `adapter` - {@link ProjectionAdapter.id}
 * - `adapterVersion` - {@link ProjectionAdapter.version}
 * - `imageInput` - `"false"` when the model cannot accept image input, otherwise `"true"`
 * - `fileInput` - `"false"` when the model cannot accept file input, otherwise `"true"`
 *
 * A version whose values differ from the ones the runtime would record for
 * the current adapter and model is not projected as it is. The runtime
 * declares the transition by its cause: a different `adapterVersion` of the
 * same adapter is an `adapter_change`, different `imageInput` or `fileInput`
 * a `model_change`. A different `adapter` id has no declared cause and fails
 * with `transition_required`.
 *
 * @experimental
 * @category Context Log
 */
export type ContextProjectionContractKey =
  | "adapter"
  | "adapterVersion"
  | "imageInput"
  | "fileInput";

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
 * Projection must be deterministic for the same core, contract, entries and
 * target, and versioned: a change to its output for an existing path needs a new
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
 * Input to a {@link ContextCoreResolver}.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextCoreInput {
  /** The stream the new version is created on. */
  stream: ContextStreamRef;
  /** Why the version is created. */
  reason: ContextTransitionReason;
  /** The version and prefix the new version inherits, or `null` for a root version. */
  parent: ContextVersionParent | null;
  /**
   * The model the new version is projected for: the provider (the route the
   * call takes) and the model id of the terminal provider model the call is
   * sent to.
   */
  target: ContextModelRef;
  /** The terminal provider model the call is sent to. */
  model: LanguageModel;
}

/**
 * Resolves the frozen core system for a new version.
 *
 * The runtime calls it only when it creates a version whose core may change:
 * `initial` on a stream without a head, `model_change` when a call targets
 * another model than the stream's previous call (a fallback, or a host
 * switching models) or a model that accepts different input, and
 * `core_policy_change` when {@link ContextLogOptions.coreVersion} differs
 * from the version recorded on the head's version, and `branch` on a stream
 * without a head whose call declares `contextStream.branchFrom`. It is not called for an
 * `adapter_change`, which keeps the core. The returned bytes are stored on the
 * version, and every call on that version projects them unchanged, so a
 * resolver never re-renders the core of an existing version.
 *
 * On a `model_change` the resolver may return a core for the target model
 * (for example a per-family policy). The `model_change` version records it,
 * so the new core is declared by the same transition; returning the parent's
 * bytes keeps the core unchanged. A resolver must be deterministic for its
 * input: the same target must produce the same bytes.
 *
 * @experimental
 * @category Context Log
 */
export type ContextCoreResolver = (input: ContextCoreInput) => string | Promise<string>;

/**
 * Where a log-mode agent's checkpoint points into the log.
 *
 * In log mode a checkpoint holds only control state (step, todos, files and a
 * pending interrupt) plus this cursor, stored as `metadata.contextLog`. Its
 * `messages` are always empty. The cursor records the head the agent last
 * projected from. It is informational: every call reads the stream's head
 * from the store, never from the checkpoint.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextLogCursor {
  /** The branch of the stream. */
  branchId: string;
  /** The stream within the branch. */
  streamId: string;
  /** The head's version, or `null` before the stream has a head. */
  versionId: string | null;
  /** The head's entry count; `0` before the stream has a head. */
  entryCount: number;
  /** The head's revision; `0` before the stream has a head. */
  revision: number;
  /** The head's path digest, or `null` before the stream has a head. */
  pathDigest: string | null;
}

/**
 * Configuration for the experimental context log mode.
 *
 * Log mode is off by default, and an agent without this option behaves
 * exactly as before. In log mode the store is the agent's history: each
 * request is a projection of the stream's head path through the projection
 * adapter, under the frozen core of the head's version. Every provider call
 * commits its input before dispatch, and each step's outputs are committed
 * before the next request is projected from them and before the run returns
 * (see `docs/context-log.md`). Pass the innermost provider model: the
 * commit boundary must be the last thing before the provider. Transforms
 * that change the request belong in {@link ContextLogOptions.requestMiddleware}.
 *
 * In log mode `createAgent` rejects `promptBuilder` and requires a core: a
 * static `systemPrompt` or {@link ContextLogOptions.resolveCore}. A
 * `contextManager` compacts by a declared `compaction` transition and needs
 * a `summarizer`.
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
  /**
   * Turns a path into model messages.
   * @defaultValue `createMessageProjectionAdapter()`
   */
  projection?: ProjectionAdapter;
  /**
   * Resolves the frozen core system for a new version. Mutually exclusive
   * with a static `systemPrompt`, which is the core of every new version.
   */
  resolveCore?: ContextCoreResolver;
  /**
   * The host's version of its core system, for example a prompt version it
   * bumps whenever the core's text changes. Experimental.
   *
   * When set, every version the runtime creates records it in its contract
   * under `CORE_VERSION_CONTRACT_KEY` (`"coreVersion"`), and a call whose
   * head version recorded another value, or none, declares a
   * `core_policy_change` transition: the new version inherits the whole path
   * with the core from {@link ContextLogOptions.resolveCore} (called with
   * `reason: "core_policy_change"`) or the static `systemPrompt`. The core
   * change is declared by this value, never inferred by comparing cores.
   *
   * When it is not set, nothing is recorded and no `core_policy_change` is
   * declared: an existing version keeps its core.
   */
  coreVersion?: string;
  /** Producers that append runtime context before each call. */
  producers?: readonly ContextProducer[];
  /** Authorises every prepare and dispatch. A refusal fails the call before anything is sent. */
  admit?: ContextAdmitHook;
  /**
   * Host request middleware, run on every provider request between the
   * projection and the commit boundary, in order (the first entry sees the
   * projected request first). The wrap order is agent, projection, these
   * middleware, commit boundary, provider, so the boundary commits and
   * digests exactly what the provider receives. They apply to every
   * provider call of a log-mode agent: each tool-loop step, each retry and
   * each fallback attempt.
   *
   * Each middleware receives its own copy of the request data, so every
   * attempt applies them exactly once to its projection. The abort signal
   * and transport headers are passed through and are not part of the
   * committed digest.
   *
   * Request middleware are part of the serialisation contract, so a log can
   * be reconstructed offline by applying them to the projection with the
   * recorded tools and settings. They must be deterministic, derive changes
   * only from the request and their pinned configuration, leave the tools
   * and settings they produce unchanged when applied again, never remove or
   * overwrite a setting they read to shape the prompt, and be pinned with
   * the projection adapter's `id` and `version`. The SDK does not check
   * this. Middleware that do not change the request (usage, telemetry,
   * retries) can stay outside, around the agent.
   */
  requestMiddleware?: readonly LanguageModelMiddleware[];
  /**
   * What `resume()` does when an earlier resume of the same interrupt
   * committed its resolution but not the tool's result, for example because
   * the process crashed while the tool ran. The tool may already have had
   * its side effects.
   *
   * - `refuse` - Fail with a `ContextLogConflictError` (reason
   *   `resume_in_doubt`) and never run the tool again
   * - `reexecute` - Run the tool again, with the same tool call id, through
   *   the normal tool pipeline. Use this only when the host's tool ledger
   *   makes a repeated execution of a tool call id safe, for example a
   *   `PreToolUse` hook that answers a recorded call with its recorded
   *   result instead of running it again.
   *
   * @defaultValue "refuse"
   */
  inDoubtResume?: "refuse" | "reexecute";
  /**
   * Chooses the stream of a subagent this agent delegates to with the `task`
   * tool. It must be deterministic, and distinct for every delegation.
   * @defaultValue `deriveSubagentContextStream`
   */
  subagentStream?: SubagentStreamResolver;
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
