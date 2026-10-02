/**
 * Context producer registration and the slot-based producer helper.
 *
 * Producers append `runtime_context` entries before a log-mode call. They
 * never rewrite the log: a changed value supersedes the slot's earlier entry,
 * removed configuration is retracted, and a failed optional loader records a
 * `context_unavailable` marker instead of silently dropping context.
 *
 * @packageDocumentation
 */

import { createHmac } from "node:crypto";

import { ConfigurationError } from "../errors/index.js";
import { ContextLogInvalidError } from "./errors.js";
import { assertContextJson, canonicalContextJson } from "./json.js";
import type {
  ContextEntry,
  ContextHead,
  ContextJsonValue,
  ContextMetadata,
  ContextProducer,
  ContextProducerInput,
  ContextStreamRef,
  RuntimeContextEntryInput,
} from "./types.js";

// =============================================================================
// Slot producers
// =============================================================================

/**
 * `type` of the payload a slot producer appends when an optional loader fails.
 *
 * @experimental
 * @category Context Log
 */
export const CONTEXT_UNAVAILABLE = "context_unavailable";

/**
 * Payload of the marker a slot producer appends when its optional loader
 * fails. The projection adapter decides how to render it, typically as a
 * notice that the context could not be loaded and must not be assumed.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextUnavailablePayload {
  [key: string]: ContextJsonValue;
  /** Always {@link CONTEXT_UNAVAILABLE}. */
  type: typeof CONTEXT_UNAVAILABLE;
  /** Name of the producer whose loader failed. */
  producer: string;
  /** Why the context is missing, as returned by `describeFailure`. */
  reason: string;
}

/**
 * The current value of one slot, returned by a slot producer's loader.
 *
 * @experimental
 * @category Context Log
 */
export interface ContextSlotValue {
  /** Stable slot name, unique within the producer, for example `"persona"` or `"file:README.md"`. */
  slot: string;
  /** Opaque payload for the projection adapter. Must be JSON-serialisable. */
  payload: ContextJsonValue;
  /** Host-defined metadata recorded on the entry. A metadata change counts as a new value. */
  metadata?: ContextMetadata;
}

/**
 * Options for {@link createSlotContextProducer}.
 *
 * @experimental
 * @category Context Log
 */
export interface SlotContextProducerOptions {
  /** Producer name, recorded on every entry. Must be unique among an agent's producers. */
  name: string;
  /**
   * Loads every slot that currently applies. Must be deterministic for the
   * same inputs, so a retry re-derives the same entries.
   */
  load(
    input: ContextProducerInput,
  ): readonly ContextSlotValue[] | Promise<readonly ContextSlotValue[]>;
  /**
   * Whether a slot that was active and is no longer returned is retracted.
   * Use `true` for per-run configuration (a removed result contract must stop
   * applying) and `false` for retrieved data, which stays part of the history.
   * A function decides per slot.
   * @defaultValue true
   */
  retractAbsent?: boolean | ((slot: string) => boolean);
  /**
   * Whether a failing loader is tolerated. An optional producer appends one
   * `context_unavailable` marker and keeps its earlier slots active; once the
   * loader succeeds again the marker is retracted. A required producer's
   * error propagates, and the call stops.
   * @defaultValue false
   */
  optional?: boolean;
  /**
   * Turns a loader error into the marker's `reason`. The default never
   * copies the error message, because messages can carry sensitive detail.
   * @defaultValue `() => "The context could not be loaded."`
   */
  describeFailure?: (error: unknown) => string;
  /**
   * Host secret that keys the source fingerprint recorded in each entry key.
   * Must stay the same for a stream across processes and releases; rotating
   * it makes each slot re-append once.
   *
   * With a secret, deduplication compares an HMAC-SHA-256 of the slot's
   * source value, so input filters that redact the payload before commit
   * (for example the secrets filter) do not make every call append the slot
   * again. Without one, no source fingerprint is persisted and
   * deduplication compares the committed payload, which a redacting filter
   * changes: an unchanged slot whose payload is redacted is then re-appended
   * on every call. An unkeyed hash is never persisted, because a reader of
   * the redacted log could brute-force low-entropy values from it.
   */
  fingerprintSecret?: string | Uint8Array;
}

const KEY_PREFIX = "ctx";
const SLOT_SEGMENT = "slot";
const UNAVAILABLE_SEGMENT = "unavailable";
const NO_FINGERPRINT = "-";
const DEFAULT_FAILURE_REASON = "The context could not be loaded.";

/** The latest committed entry of one slot. */
interface SlotLedgerEntry {
  key: string;
  count: number;
  /** False once a retraction has superseded the slot. */
  active: boolean;
  /** Keyed fingerprint of the source value from the entry key, when recorded. */
  source: string | null;
  /** Canonical committed payload and metadata. */
  committed: string;
}

/** A slot is either a loader slot or the producer's unavailable marker. */
type SlotId = { kind: "slot"; slot: string } | { kind: "unavailable" };

function slotIdKey(id: SlotId): string {
  return id.kind === "slot" ? `${SLOT_SEGMENT}:${id.slot}` : UNAVAILABLE_SEGMENT;
}

function entryKey(name: string, id: SlotId, count: number, fingerprint: string | null): string {
  const encodedName = encodeURIComponent(name);
  const suffix = `${count}:${fingerprint ?? NO_FINGERPRINT}`;
  return id.kind === "slot"
    ? `${KEY_PREFIX}:${encodedName}:${SLOT_SEGMENT}:${encodeURIComponent(id.slot)}:${suffix}`
    : `${KEY_PREFIX}:${encodedName}:${UNAVAILABLE_SEGMENT}:${suffix}`;
}

function parseEntryKey(
  name: string,
  key: string,
): { id: SlotId; count: number; fingerprint: string | null } | null {
  const parts = key.split(":");
  if (parts[0] !== KEY_PREFIX || parts[1] !== encodeURIComponent(name)) return null;
  const fingerprintPart = parts[parts.length - 1] as string;
  const fingerprint = fingerprintPart === NO_FINGERPRINT ? null : fingerprintPart;
  const count = Number(parts[parts.length - 2]);
  if (!Number.isSafeInteger(count) || count < 1) return null;
  if (parts.length === 6 && parts[2] === SLOT_SEGMENT) {
    try {
      return {
        id: { kind: "slot", slot: decodeURIComponent(parts[3] as string) },
        count,
        fingerprint,
      };
    } catch {
      return null;
    }
  }
  if (parts.length === 5 && parts[2] === UNAVAILABLE_SEGMENT) {
    return { id: { kind: "unavailable" }, count, fingerprint };
  }
  return null;
}

/**
 * Keyed fingerprint of a slot's **source** value, recorded in the entry key
 * when the host supplies `fingerprintSecret`. Deduplication compares source
 * values rather than committed payloads, which input filters may have
 * redacted. The HMAC is keyed so the persisted key cannot be used to
 * brute-force a redacted value.
 */
function sourceFingerprint(
  secret: string | Uint8Array,
  name: string,
  id: SlotId,
  payload: ContextJsonValue,
  metadata: ContextMetadata | undefined,
): string {
  return createHmac("sha256", secret)
    .update(
      canonicalContextJson({
        producer: name,
        slot: slotIdKey(id),
        payload,
        metadata: metadata ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

function committedFingerprint(
  payload: ContextJsonValue,
  metadata: ContextMetadata | undefined,
): string {
  return canonicalContextJson({ payload, metadata: metadata ?? null });
}

/** Rebuilds the per-slot ledger from this producer's entries on the path. */
function slotLedger(name: string, path: readonly ContextEntry[]): Map<string, SlotLedgerEntry> {
  const ledger = new Map<string, SlotLedgerEntry>();
  for (const entry of path) {
    if (entry.kind !== "runtime_context" || entry.producer !== name) continue;
    const parsed = parseEntryKey(name, entry.key);
    if (!parsed) continue;
    const id = slotIdKey(parsed.id);
    const previous = ledger.get(id);
    ledger.set(id, {
      key: entry.key,
      count: Math.max(parsed.count, previous?.count ?? 0),
      active: entry.retraction !== true,
      source: parsed.fingerprint,
      committed: committedFingerprint(entry.payload, entry.metadata),
    });
  }
  return ledger;
}

/**
 * Creates a {@link ContextProducer} that keeps one value per named slot.
 *
 * The producer reads its own earlier entries from the committed path and
 * appends only what changed:
 *
 * - **Deduplication.** A slot whose payload and metadata are unchanged
 *   appends nothing.
 * - **Supersession.** A changed slot appends a new entry that `supersedes`
 *   the slot's latest entry. The earlier entry stays in the log.
 * - **Retraction.** A slot that was active and is no longer returned gets a
 *   retraction (`retraction: true`, `null` payload), so removed
 *   configuration stops applying. Disable this for retrieved data with
 *   `retractAbsent`.
 * - **Unavailable context.** When an `optional` loader fails, the producer
 *   appends one {@link ContextUnavailablePayload} marker and leaves its
 *   earlier slots active instead of retracting them. When the loader
 *   recovers, the marker is retracted before the fresh values.
 *
 * Keys are deterministic (`ctx:<producer>:slot:<slot>:<n>:<fingerprint>`),
 * so a retry from the same head re-derives byte-identical entries. With a
 * `fingerprintSecret`, the fingerprint is a keyed HMAC of the slot's source
 * value and deduplication compares it, so input filters that redact the
 * payload before commit do not defeat deduplication. Without one, the
 * fingerprint segment is `-` and deduplication compares committed payloads.
 *
 * @param options - Producer name, loader and slot policies
 * @returns A producer to register in `contextLog.producers` or on a plugin
 *
 * @example
 * ```typescript
 * const settings = createSlotContextProducer({
 *   name: "project-settings",
 *   optional: true,
 *   load: async () => {
 *     const settings = await loadSettings();
 *     return settings ? [{ slot: "settings", payload: settings }] : [];
 *   },
 * });
 * ```
 *
 * @experimental
 * @category Context Log
 */
export function createSlotContextProducer(options: SlotContextProducerOptions): ContextProducer {
  const { name, load, optional = false, fingerprintSecret } = options;
  const retractAbsent = options.retractAbsent ?? true;
  const describeFailure = options.describeFailure ?? (() => DEFAULT_FAILURE_REASON);
  const shouldRetract = (slot: string) =>
    typeof retractAbsent === "function" ? retractAbsent(slot) : retractAbsent;

  return {
    name,
    async produce(input) {
      const ledger = slotLedger(name, input.path);
      const entries: RuntimeContextEntryInput[] = [];

      const append = (id: SlotId, payload: ContextJsonValue, metadata?: ContextMetadata) => {
        const previous = ledger.get(slotIdKey(id));
        const source =
          fingerprintSecret === undefined
            ? null
            : sourceFingerprint(fingerprintSecret, name, id, payload, metadata);
        const committed = committedFingerprint(payload, metadata);
        if (
          previous?.active &&
          (source !== null && previous.source !== null
            ? previous.source === source
            : previous.committed === committed)
        ) {
          return;
        }
        const count = (previous?.count ?? 0) + 1;
        const key = entryKey(name, id, count, source);
        entries.push({
          kind: "runtime_context",
          key,
          producer: name,
          payload,
          ...(metadata !== undefined ? { metadata } : {}),
          ...(previous ? { supersedes: previous.key } : {}),
        });
        ledger.set(slotIdKey(id), { key, count, active: true, source, committed });
      };

      const retract = (id: SlotId) => {
        const previous = ledger.get(slotIdKey(id));
        if (!previous?.active) return;
        const count = previous.count + 1;
        const key = entryKey(name, id, count, null);
        entries.push({
          kind: "runtime_context",
          key,
          producer: name,
          payload: null,
          supersedes: previous.key,
          retraction: true,
        });
        ledger.set(slotIdKey(id), {
          key,
          count,
          active: false,
          source: null,
          committed: committedFingerprint(null, undefined),
        });
      };

      let values: readonly ContextSlotValue[];
      try {
        values = await load(input);
      } catch (error) {
        if (!optional || input.signal?.aborted) throw error;
        // Keep the last committed values active: a transient failure must
        // not retract configuration that still applies.
        const payload: ContextUnavailablePayload = {
          type: CONTEXT_UNAVAILABLE,
          producer: name,
          reason: describeFailure(error),
        };
        append({ kind: "unavailable" }, payload);
        return entries;
      }

      if (!Array.isArray(values)) {
        throw new ContextLogInvalidError(
          "invalid_producer_output",
          `Context producer "${name}" must return an array of slot values`,
        );
      }

      // Recovery clears the earlier unavailable marker first.
      retract({ kind: "unavailable" });

      const produced = new Set<string>();
      for (const value of values) {
        if (typeof value?.slot !== "string" || value.slot.length === 0) {
          throw new ContextLogInvalidError(
            "invalid_producer_output",
            `Context producer "${name}" returned a slot value without a slot name`,
          );
        }
        if (produced.has(value.slot)) {
          throw new ContextLogInvalidError(
            "duplicate_slot",
            `Context producer "${name}" returned slot "${value.slot}" more than once`,
          );
        }
        produced.add(value.slot);
        assertContextJson(value.payload, `${name}.${value.slot}.payload`);
        if (value.metadata !== undefined) {
          assertContextJson(value.metadata, `${name}.${value.slot}.metadata`);
        }
        append({ kind: "slot", slot: value.slot }, value.payload, value.metadata);
      }

      // Slots this load no longer returns are retracted, in slot order.
      const absent = [...ledger.keys()]
        .filter((id) => id.startsWith(`${SLOT_SEGMENT}:`))
        .map((id) => id.slice(SLOT_SEGMENT.length + 1))
        .filter((slot) => !produced.has(slot) && shouldRetract(slot))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (const slot of absent) retract({ kind: "slot", slot });

      return entries;
    },
  };
}

// =============================================================================
// Registration and execution (runtime internals)
// =============================================================================

/**
 * Resolves an agent's producers: the agent's own `contextLog.producers` first,
 * then each plugin's `contextProducers` in plugin order.
 *
 * @param agentProducers - Producers from `AgentOptions.contextLog.producers`
 * @param plugins - The agent's plugins
 * @returns The producers in the order they run
 * @throws {ConfigurationError} When a producer has no name or two share one
 *
 * @internal
 */
export function resolveContextProducers(
  agentProducers: readonly ContextProducer[] | undefined,
  plugins: ReadonlyArray<{ name: string; contextProducers?: readonly ContextProducer[] }> = [],
): ContextProducer[] {
  const resolved: ContextProducer[] = [];
  const owners = new Map<string, string>();
  const register = (producer: ContextProducer, owner: string) => {
    if (typeof producer?.name !== "string" || producer.name.length === 0) {
      throw new ConfigurationError(`Context producer from ${owner} must have a non-empty name`, {
        configKey: "contextLog.producers",
      });
    }
    if (typeof producer.produce !== "function") {
      throw new ConfigurationError(
        `Context producer "${producer.name}" from ${owner} must have a produce function`,
        { configKey: "contextLog.producers" },
      );
    }
    const existing = owners.get(producer.name);
    if (existing !== undefined) {
      throw new ConfigurationError(
        `Context producer "${producer.name}" is registered by both ${existing} and ${owner}; producer names must be unique`,
        { configKey: "contextLog.producers", actualValue: producer.name },
      );
    }
    owners.set(producer.name, owner);
    resolved.push(producer);
  };

  for (const producer of agentProducers ?? []) register(producer, "the agent");
  for (const plugin of plugins) {
    for (const producer of plugin.contextProducers ?? []) {
      register(producer, `plugin "${plugin.name}"`);
    }
  }
  return resolved;
}

/**
 * Input to {@link runContextProducers}.
 *
 * @internal
 */
export interface RunContextProducersInput {
  /** Producers in the order they run, from {@link resolveContextProducers}. */
  producers: readonly ContextProducer[];
  /** The stream the call runs on. */
  stream: ContextStreamRef;
  /** The head snapshot the call is built from, or `null` before the first call. */
  head: ContextHead | null;
  /** The complete committed path at that head, in position order. */
  path: readonly ContextEntry[];
  /** Aborts when the call is cancelled. */
  signal?: AbortSignal;
}

/**
 * Runs every producer against one head snapshot and returns the entries to
 * append, in producer order.
 *
 * Every producer sees the same head and path. Entries are validated
 * (`runtime_context`, the producer's own name, JSON-serialisable), and an
 * entry whose key is already on the path is dropped, which makes producers
 * idempotent across calls. A producer error propagates and stops the call.
 *
 * The result is new, not-yet-committed input: the runtime passes it through
 * the PreGenerate hooks (redaction, guardrails) before it commits it.
 *
 * @internal
 */
export async function runContextProducers(
  input: RunContextProducersInput,
): Promise<RuntimeContextEntryInput[]> {
  const committed = new Set(input.path.map((entry) => entry.key));
  const pending = new Map<string, string>();
  const result: RuntimeContextEntryInput[] = [];

  for (const producer of input.producers) {
    input.signal?.throwIfAborted();
    const produced = await producer.produce({
      stream: input.stream,
      head: input.head,
      path: input.path,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!Array.isArray(produced)) {
      throw new ContextLogInvalidError(
        "invalid_producer_output",
        `Context producer "${producer.name}" must return an array of entries`,
      );
    }

    for (const entry of produced as readonly RuntimeContextEntryInput[]) {
      if (entry?.kind !== "runtime_context") {
        throw new ContextLogInvalidError(
          "invalid_producer_output",
          `Context producer "${producer.name}" may only append runtime_context entries`,
        );
      }
      if (entry.producer !== producer.name) {
        throw new ContextLogInvalidError(
          "invalid_producer_output",
          `Context producer "${producer.name}" returned an entry attributed to "${String(entry.producer)}"`,
        );
      }
      if (typeof entry.key !== "string" || entry.key.length === 0) {
        throw new ContextLogInvalidError(
          "invalid_producer_output",
          `Context producer "${producer.name}" returned an entry without a key`,
        );
      }
      assertContextJson(entry.payload, `${producer.name}.${entry.key}.payload`);
      if (entry.metadata !== undefined) {
        assertContextJson(entry.metadata, `${producer.name}.${entry.key}.metadata`);
      }

      // Deduplication: the key is the identity of a context value.
      if (committed.has(entry.key)) continue;
      const print = canonicalContextJson(entry);
      const earlier = pending.get(entry.key);
      if (earlier !== undefined) {
        if (earlier === print) continue;
        throw new ContextLogInvalidError(
          "duplicate_key",
          `Context producers returned two different entries with key "${entry.key}"`,
        );
      }
      pending.set(entry.key, print);
      result.push({ ...entry });
    }
  }
  return result;
}
