/**
 * In-memory implementation of {@link ContextLogStore}.
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from "node:crypto";

import {
  ContextLogConflictError,
  ContextLogInvalidError,
  ContextLogNotFoundError,
} from "./errors.js";
import { assertContextJson, canonicalContextJson } from "./json.js";
import type {
  ContextAppendOutputsRequest,
  ContextAppendOutputsResult,
  ContextCallOutcome,
  ContextCallOutcomeStatus,
  ContextEntry,
  ContextEntryInput,
  ContextEntryKind,
  ContextHead,
  ContextLogStore,
  ContextManifest,
  ContextManifestInput,
  ContextPathPage,
  ContextPathReadOptions,
  ContextPathRef,
  ContextPrepareRequest,
  ContextPrepareResult,
  ContextStreamRef,
  ContextTransition,
  ContextVersion,
} from "./types.js";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1_000;
const ENTRY_KINDS: ReadonlySet<ContextEntryKind> = new Set([
  "user",
  "assistant",
  "tool_result",
  "runtime_context",
]);
const OUTPUT_KINDS: ReadonlySet<ContextEntryKind> = new Set(["assistant", "tool_result"]);
const OUTCOME_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
  "unknown",
]);

interface StoredVersion {
  record: ContextVersion;
  /** Digest the version's own entries chain from. */
  rootDigest: string;
  /** Serialised entries the version appended, in order. */
  entries: string[];
  /** Entry keys, parallel to `entries`. */
  keys: string[];
  /** Canonical digests of each entry's input, parallel to `entries`. */
  entryDigests: string[];
  /** Chained path digests, parallel to `entries`. */
  pathDigests: string[];
}

interface StoredManifest {
  record: ContextManifest;
  requestDigest: string;
  /** Committed output requests by request digest, kept independently of the moving path. */
  outputs: Map<string, ContextEntry[]>;
}

/** Entries serialised and digested ahead of a commit, so the commit itself cannot throw. */
interface StagedEntries {
  entries: string[];
  keys: string[];
  entryDigests: string[];
  pathDigests: string[];
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function streamKey(stream: ContextStreamRef): string {
  return JSON.stringify([stream.threadId, stream.branchId, stream.streamId]);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requireString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContextLogInvalidError("invalid_field", `${field} must be a non-empty string`);
  }
}

function requireCount(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ContextLogInvalidError("invalid_field", `${field} must be a non-negative integer`);
  }
}

function requireObject(value: unknown, field: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContextLogInvalidError("invalid_field", `${field} must be an object`);
  }
}

/** Validates a stream reference and returns a copy with only its own fields. */
function normaliseStream(stream: ContextStreamRef, field = "stream"): ContextStreamRef {
  requireObject(stream, field);
  requireString(stream.threadId, `${field}.threadId`);
  requireString(stream.branchId, `${field}.branchId`);
  requireString(stream.streamId, `${field}.streamId`);
  return { threadId: stream.threadId, branchId: stream.branchId, streamId: stream.streamId };
}

function requireDigest(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new ContextLogInvalidError(
      "invalid_field",
      `${field} must be a lowercase hexadecimal SHA-256 digest`,
    );
  }
}

function validateMetadata(metadata: unknown, field: string): void {
  if (metadata === undefined) return;
  requireObject(metadata, field);
  assertContextJson(metadata, field);
}

function validateEntries(
  entries: readonly ContextEntryInput[],
  allowed: ReadonlySet<ContextEntryKind>,
  field: string,
): void {
  if (!Array.isArray(entries)) {
    throw new ContextLogInvalidError("invalid_field", `${field} must be an array`);
  }
  const keys = new Set<string>();
  // An index loop, not forEach: holes in a sparse array must be rejected.
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const at = `${field}[${index}]`;
    requireObject(entry, at);
    if (!allowed.has(entry.kind)) {
      throw new ContextLogInvalidError("invalid_entry_kind", `${at}.kind is not allowed here`);
    }
    requireString(entry.key, `${at}.key`);
    if (keys.has(entry.key)) {
      throw new ContextLogInvalidError("duplicate_key", `${at}.key repeats a key in the request`);
    }
    keys.add(entry.key);
    if (entry.kind === "runtime_context") {
      requireString(entry.producer, `${at}.producer`);
      if (entry.supersedes !== undefined) {
        requireString(entry.supersedes, `${at}.supersedes`);
        if (entry.supersedes === entry.key) {
          throw new ContextLogInvalidError("invalid_supersession", `${at} supersedes itself`);
        }
      }
      if (entry.retraction !== undefined && typeof entry.retraction !== "boolean") {
        throw new ContextLogInvalidError("invalid_field", `${at}.retraction must be a boolean`);
      }
      if (entry.retraction && (entry.supersedes === undefined || entry.payload !== null)) {
        throw new ContextLogInvalidError(
          "invalid_retraction",
          `${at} is a retraction, so it needs supersedes and a null payload`,
        );
      }
    } else {
      requireObject(entry.message, `${at}.message`);
    }
    validateMetadata(entry.metadata, `${at}.metadata`);
    assertContextJson(entry, at);
  }
}

function validateTransition(transition: ContextTransition): void {
  requireObject(transition, "transition");
  requireString(transition.reason, "transition.reason");
  if (typeof transition.core !== "string") {
    throw new ContextLogInvalidError("invalid_field", "transition.core must be a string");
  }
  requireObject(transition.contract, "transition.contract");
  for (const [key, value] of Object.entries(transition.contract)) {
    if (typeof value !== "string") {
      throw new ContextLogInvalidError(
        "invalid_field",
        `transition.contract.${key} must be a string`,
      );
    }
  }
  if (transition.parent !== null) {
    requireObject(transition.parent, "transition.parent");
    requireString(transition.parent.versionId, "transition.parent.versionId");
    requireCount(transition.parent.inheritedCount, "transition.parent.inheritedCount");
  }
  validateMetadata(transition.metadata, "transition.metadata");
}

function validateManifest(manifest: ContextManifestInput): void {
  requireObject(manifest, "manifest");
  requireObject(manifest.projection, "manifest.projection");
  requireString(manifest.projection.adapter, "manifest.projection.adapter");
  requireString(manifest.projection.version, "manifest.projection.version");
  requireObject(manifest.model, "manifest.model");
  requireString(manifest.model.provider, "manifest.model.provider");
  requireString(manifest.model.modelId, "manifest.model.modelId");
  requireDigest(manifest.inputDigest, "manifest.inputDigest");
  if (manifest.ordinal !== undefined) requireCount(manifest.ordinal, "manifest.ordinal");
  if (manifest.attempt !== undefined) requireCount(manifest.attempt, "manifest.attempt");
  validateMetadata(manifest.metadata, "manifest.metadata");
  assertContextJson(manifest, "manifest");
}

/**
 * Whether every `supersedes` in `append` names an active runtime context entry
 * earlier on the path (including earlier entries of the same request).
 */
function supersessionsAdmissible(
  path: readonly ContextEntry[],
  append: readonly ContextEntryInput[],
): boolean {
  const slots = new Map<string, { runtime: boolean; active: boolean }>();
  const visit = (entry: ContextEntryInput): boolean => {
    if (entry.kind === "runtime_context" && entry.supersedes !== undefined) {
      const target = slots.get(entry.supersedes);
      if (!target?.runtime || !target.active) return false;
      target.active = false;
    }
    slots.set(entry.key, { runtime: entry.kind === "runtime_context", active: true });
    return true;
  };
  // Committed entries were admitted when they were written.
  for (const entry of path) visit(entry);
  return append.every(visit);
}

/**
 * Digest of a request for idempotency: canonical JSON for the envelope, and
 * the exact serialisation of the entries, whose key order is part of the
 * model-facing bytes.
 */
function digestRequest(envelope: unknown, entries: readonly ContextEntryInput[]): string {
  return sha256(`${canonicalContextJson(envelope)}\n${JSON.stringify(entries)}`);
}

function commitStaged(version: StoredVersion, staged: StagedEntries): void {
  version.entries.push(...staged.entries);
  version.keys.push(...staged.keys);
  version.entryDigests.push(...staged.entryDigests);
  version.pathDigests.push(...staged.pathDigests);
}

/**
 * Reference {@link ContextLogStore} that keeps everything in memory.
 *
 * Suitable for tests, development and short-lived processes; all data is lost
 * when the process exits. It passes the context log store conformance suite
 * and is the behavioural reference for other implementations.
 *
 * @example
 * ```typescript
 * const store = new MemoryContextLogStore();
 * const head = await store.readHead({ threadId: "t1", branchId: "main", streamId: "main" });
 * ```
 *
 * @experimental
 * @category Context Log
 */
export class MemoryContextLogStore implements ContextLogStore {
  private readonly versions = new Map<string, StoredVersion>();
  private readonly heads = new Map<string, ContextHead>();
  private readonly manifests = new Map<string, StoredManifest>();
  /** Manifest id by thread and idempotency key. */
  private readonly idempotency = new Map<string, string>();

  async readHead(stream: ContextStreamRef): Promise<ContextHead | null> {
    const head = this.heads.get(streamKey(normaliseStream(stream)));
    return head ? clone(head) : null;
  }

  async readPath(
    ref: ContextPathRef,
    options: ContextPathReadOptions = {},
  ): Promise<ContextPathPage> {
    const refStream = normaliseStream(ref.stream, "ref.stream");
    requireString(ref.versionId, "ref.versionId");
    requireCount(ref.entryCount, "ref.entryCount");
    const after = options.after ?? 0;
    requireCount(after, "options.after");
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new ContextLogInvalidError("invalid_field", "options.limit must be a positive integer");
    }
    const version = this.versions.get(ref.versionId);
    // A reference names one stream's path; a version of another stream (even
    // in the same thread) is not on it.
    if (!version || streamKey(version.record.stream) !== streamKey(refStream)) {
      throw new ContextLogNotFoundError("version", ref.versionId);
    }
    if (ref.entryCount > this.fullCount(version)) {
      throw new ContextLogInvalidError(
        "path_out_of_range",
        `ref.entryCount exceeds the committed path of version ${ref.versionId}`,
      );
    }
    const end = Math.min(ref.entryCount, after + Math.min(limit, MAX_PAGE_SIZE));
    const entries: ContextEntry[] = [];
    for (let position = after + 1; position <= end; position += 1) {
      entries.push(JSON.parse(this.serialisedEntryAt(version, position)) as ContextEntry);
    }
    return { entries, nextAfter: end < ref.entryCount ? end : null };
  }

  async readVersion(versionId: string): Promise<ContextVersion> {
    requireString(versionId, "versionId");
    const version = this.versions.get(versionId);
    if (!version) throw new ContextLogNotFoundError("version", versionId);
    return clone(version.record);
  }

  async readManifest(manifestId: string): Promise<ContextManifest> {
    return clone(this.requireManifest(manifestId).record);
  }

  async prepare(request: ContextPrepareRequest): Promise<ContextPrepareResult> {
    requireObject(request, "request");
    const stream = normaliseStream(request.stream);
    requireCount(request.expectedRevision, "expectedRevision");
    requireString(request.idempotencyKey, "idempotencyKey");
    if (request.transition !== undefined) validateTransition(request.transition);
    validateEntries(request.append, ENTRY_KINDS, "append");
    validateManifest(request.manifest);
    if (request.closeSuperseded !== undefined) {
      requireString(request.closeSuperseded, "closeSuperseded");
    }

    const key = streamKey(stream);
    const requestDigest = digestRequest(
      {
        stream,
        expectedRevision: request.expectedRevision,
        transition: request.transition ?? null,
        manifest: request.manifest,
        ...(request.closeSuperseded !== undefined && { closeSuperseded: request.closeSuperseded }),
      },
      request.append,
    );

    // Idempotent replay comes before the revision check: a retry of a
    // committed prepare must learn its outcome even though the head moved.
    const idempotencyKey = JSON.stringify([stream.threadId, request.idempotencyKey]);
    const existingId = this.idempotency.get(idempotencyKey);
    if (existingId !== undefined) {
      const existing = this.manifests.get(existingId)!;
      const head = this.heads.get(streamKey(existing.record.stream))!;
      if (existing.requestDigest !== requestDigest) {
        throw new ContextLogConflictError("idempotency_mismatch", { head: clone(head) });
      }
      return { created: false, manifest: clone(existing.record), head: clone(head) };
    }

    const head = this.heads.get(key) ?? null;
    if ((head?.revision ?? 0) !== request.expectedRevision) {
      throw new ContextLogConflictError("head_moved", { head: head ? clone(head) : null });
    }
    // The superseded call to close in this write, when the caller names it.
    let superseded: { record: ContextManifest; status: ContextCallOutcomeStatus } | undefined;
    if (request.closeSuperseded !== undefined) {
      if (!head || request.closeSuperseded !== head.lastManifestId) {
        throw new ContextLogInvalidError(
          "invalid_field",
          "closeSuperseded must name the manifest the head points at",
        );
      }
      const record = this.requireManifest(request.closeSuperseded).record;
      if (record.outcome === null) {
        const outputsCommitted =
          head.versionId === record.versionId && head.entryCount > record.entryCount;
        superseded = {
          record,
          status: outputsCommitted
            ? "completed"
            : record.dispatchedAt !== null
              ? "unknown"
              : "cancelled",
        };
      }
    }

    // Stage everything first. Nothing below the commit marker can throw, so a
    // failed prepare leaves the store unchanged.
    const now = new Date().toISOString();
    const manifestId = `ctx-manifest-${randomUUID()}`;
    let target: StoredVersion;
    let isNewVersion = false;
    const transition = request.transition;
    if (!transition) {
      if (!head) throw new ContextLogConflictError("invalid_transition", { head: null });
      target = this.versions.get(head.versionId)!;
    } else {
      if (transition.parent === null && head) {
        throw new ContextLogConflictError("invalid_transition", { head: clone(head) });
      }
      let inheritedDigest: string | null = null;
      let parentVersionId: string | null = null;
      let inheritedCount = 0;
      if (transition.parent) {
        const parent = this.versions.get(transition.parent.versionId);
        if (
          !parent ||
          parent.record.stream.threadId !== stream.threadId ||
          parent.record.stream.streamId !== stream.streamId ||
          transition.parent.inheritedCount > this.fullCount(parent)
        ) {
          throw new ContextLogConflictError("invalid_transition", {
            head: head ? clone(head) : null,
          });
        }
        parentVersionId = parent.record.id;
        inheritedCount = transition.parent.inheritedCount;
        inheritedDigest =
          inheritedCount === 0 ? null : this.entryPathDigestAt(parent, inheritedCount);
      }
      const record: ContextVersion = {
        id: `ctx-version-${randomUUID()}`,
        stream: { ...stream },
        parentVersionId,
        inheritedCount,
        reason: transition.reason,
        core: transition.core,
        contract: { ...transition.contract },
        ...(transition.metadata !== undefined ? { metadata: clone(transition.metadata) } : {}),
        createdByManifestId: manifestId,
        createdAt: now,
      };
      target = {
        record,
        rootDigest: sha256(
          canonicalContextJson({
            // The version id makes every new version's digest distinct, even
            // an empty one with the same core, contract and prefix.
            versionId: record.id,
            core: transition.core,
            contract: transition.contract,
            inherited: inheritedDigest,
          }),
        ),
        entries: [],
        keys: [],
        entryDigests: [],
        pathDigests: [],
      };
      isNewVersion = true;
    }

    const baseCount = isNewVersion ? target.record.inheritedCount : this.fullCount(target);
    const basePath = this.pathEntries(target, baseCount, isNewVersion);
    if (request.append.some((entry) => basePath.some((onPath) => onPath.key === entry.key))) {
      throw new ContextLogConflictError("key_taken", { head: head ? clone(head) : null });
    }
    if (!supersessionsAdmissible(basePath, request.append)) {
      throw new ContextLogConflictError("invalid_supersession", {
        head: head ? clone(head) : null,
      });
    }
    const staged = this.stageEntries(target, request.append, manifestId, now);
    const entryCount = this.fullCount(target) + staged.entries.length;
    const nextHead: ContextHead = {
      stream: { ...stream },
      versionId: target.record.id,
      entryCount,
      pathDigest: staged.pathDigests.at(-1) ?? this.headDigest(target),
      revision: (head?.revision ?? 0) + 1,
      lastManifestId: manifestId,
    };
    const manifest: ContextManifest = {
      ...clone(request.manifest),
      id: manifestId,
      idempotencyKey: request.idempotencyKey,
      stream: { ...stream },
      versionId: nextHead.versionId,
      entryCount,
      pathDigest: nextHead.pathDigest,
      headRevision: nextHead.revision,
      dispatchedAt: null,
      outcome: null,
      createdAt: now,
    };
    const result: ContextPrepareResult = {
      created: true,
      manifest: clone(manifest),
      head: clone(nextHead),
    };

    // Commit.
    if (isNewVersion) this.versions.set(target.record.id, target);
    commitStaged(target, staged);
    if (superseded) {
      superseded.record.outcome = { status: superseded.status, recordedAt: now };
    }
    this.heads.set(key, nextHead);
    this.manifests.set(manifestId, { record: manifest, requestDigest, outputs: new Map() });
    this.idempotency.set(idempotencyKey, manifestId);
    return result;
  }

  async markDispatched(manifestId: string): Promise<ContextManifest> {
    const stored = this.requireManifest(manifestId);
    const head = this.heads.get(streamKey(stored.record.stream)) ?? null;
    if (stored.record.dispatchedAt !== null || stored.record.outcome !== null) {
      throw new ContextLogConflictError("dispatch_already_started", {
        head: head ? clone(head) : null,
      });
    }
    if (head?.lastManifestId !== manifestId) {
      throw new ContextLogConflictError("head_moved", { head: head ? clone(head) : null });
    }
    stored.record.dispatchedAt = new Date().toISOString();
    return clone(stored.record);
  }

  async appendOutputs(request: ContextAppendOutputsRequest): Promise<ContextAppendOutputsResult> {
    requireObject(request, "request");
    requireString(request.manifestId, "manifestId");
    requireCount(request.expectedRevision, "expectedRevision");
    validateEntries(request.items, OUTPUT_KINDS, "items");
    if (request.items.length === 0) {
      throw new ContextLogInvalidError("invalid_field", "items must not be empty");
    }
    const stored = this.requireManifest(request.manifestId);
    const manifest = stored.record;
    const key = streamKey(manifest.stream);
    const head = this.heads.get(key)!;

    // An identical retry returns the committed entries, wherever the head
    // has moved since (including past a transition that dropped them).
    const requestDigest = digestRequest(
      { manifestId: request.manifestId, expectedRevision: request.expectedRevision },
      request.items,
    );
    const committed = stored.outputs.get(requestDigest);
    if (committed) return { created: false, entries: clone(committed), head: clone(head) };

    const outcome = manifest.outcome?.status;
    if (manifest.dispatchedAt === null || (outcome !== undefined && outcome !== "completed")) {
      throw new ContextLogConflictError("invalid_lifecycle", { head: clone(head) });
    }
    if (head.revision !== request.expectedRevision || head.lastManifestId !== request.manifestId) {
      throw new ContextLogConflictError("head_moved", { head: clone(head) });
    }
    const version = this.versions.get(head.versionId)!;
    const taken = this.keysOnPath(version, head.entryCount, false);
    if (request.items.some((item) => taken.has(item.key))) {
      throw new ContextLogConflictError("key_taken", { head: clone(head) });
    }

    const now = new Date().toISOString();
    const staged = this.stageEntries(version, request.items, request.manifestId, now);
    const nextHead: ContextHead = {
      ...clone(head),
      entryCount: head.entryCount + staged.entries.length,
      pathDigest: staged.pathDigests.at(-1)!,
      revision: head.revision + 1,
    };
    const entries = staged.entries.map((entry) => JSON.parse(entry) as ContextEntry);
    const result: ContextAppendOutputsResult = {
      created: true,
      entries: clone(entries),
      head: clone(nextHead),
    };

    // Commit.
    commitStaged(version, staged);
    this.heads.set(key, nextHead);
    stored.outputs.set(requestDigest, entries);
    return result;
  }

  async recordOutcome(manifestId: string, outcome: ContextCallOutcome): Promise<ContextManifest> {
    requireObject(outcome, "outcome");
    if (!OUTCOME_STATUSES.has(outcome.status)) {
      throw new ContextLogInvalidError("invalid_field", "outcome.status is not a known status");
    }
    validateMetadata(outcome.metadata, "outcome.metadata");
    const stored = this.requireManifest(manifestId);
    const record = stored.record;
    if (record.outcome !== null) {
      if (record.outcome.status !== outcome.status) {
        throw new ContextLogConflictError("invalid_lifecycle");
      }
      return clone(record);
    }
    if (record.dispatchedAt === null && outcome.status !== "cancelled") {
      throw new ContextLogConflictError("invalid_lifecycle");
    }
    record.outcome = {
      status: outcome.status,
      ...(outcome.metadata !== undefined ? { metadata: clone(outcome.metadata) } : {}),
      recordedAt: new Date().toISOString(),
    };
    return clone(record);
  }

  private requireManifest(manifestId: string): StoredManifest {
    requireString(manifestId, "manifestId");
    const stored = this.manifests.get(manifestId);
    if (!stored) throw new ContextLogNotFoundError("manifest", manifestId);
    return stored;
  }

  private fullCount(version: StoredVersion): number {
    return version.record.inheritedCount + version.entries.length;
  }

  private parentOf(version: StoredVersion): StoredVersion {
    return this.versions.get(version.record.parentVersionId!)!;
  }

  private serialisedEntryAt(version: StoredVersion, position: number): string {
    let current = version;
    while (position <= current.record.inheritedCount) current = this.parentOf(current);
    return current.entries[position - current.record.inheritedCount - 1]!;
  }

  /** Path digest after `count` (> 0) entries of the version's full path. */
  private entryPathDigestAt(version: StoredVersion, count: number): string {
    let current = version;
    while (count <= current.record.inheritedCount) current = this.parentOf(current);
    return current.pathDigests[count - current.record.inheritedCount - 1]!;
  }

  /** Digest of a head at the version's full path: its root until it has entries of its own. */
  private headDigest(version: StoredVersion): string {
    return version.pathDigests.at(-1) ?? version.rootDigest;
  }

  /** Parsed entries of a path: the version's own path, or its parent's inherited prefix. */
  private pathEntries(version: StoredVersion, count: number, viaParent: boolean): ContextEntry[] {
    const source = viaParent
      ? version.record.parentVersionId
        ? this.parentOf(version)
        : undefined
      : version;
    const entries: ContextEntry[] = [];
    if (!source) return entries;
    for (let position = 1; position <= count; position += 1) {
      entries.push(JSON.parse(this.serialisedEntryAt(source, position)) as ContextEntry);
    }
    return entries;
  }

  private keysOnPath(version: StoredVersion, count: number, viaParent: boolean): Set<string> {
    const keys = new Set<string>();
    let current: StoredVersion | undefined = viaParent
      ? version.record.parentVersionId
        ? this.parentOf(version)
        : undefined
      : version;
    let end = count;
    while (current && end > 0) {
      const inherited = current.record.inheritedCount;
      for (let index = 0; index < end - inherited; index += 1) keys.add(current.keys[index]!);
      end = Math.min(end, inherited);
      current = current.record.parentVersionId ? this.parentOf(current) : undefined;
    }
    return keys;
  }

  /** Serialises and digests entries that would follow the version's current path. */
  private stageEntries(
    version: StoredVersion,
    inputs: readonly ContextEntryInput[],
    manifestId: string,
    createdAt: string,
  ): StagedEntries {
    const staged: StagedEntries = { entries: [], keys: [], entryDigests: [], pathDigests: [] };
    let position = this.fullCount(version);
    let previous = this.headDigest(version);
    for (const input of inputs) {
      position += 1;
      const entryDigest = sha256(canonicalContextJson(input));
      previous = sha256(`${previous}\n${entryDigest}`);
      staged.entries.push(
        JSON.stringify({ ...input, position, versionId: version.record.id, manifestId, createdAt }),
      );
      staged.keys.push(input.key);
      staged.entryDigests.push(entryDigest);
      staged.pathDigests.push(previous);
    }
    return staged;
  }
}
