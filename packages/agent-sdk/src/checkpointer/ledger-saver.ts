/**
 * Ledger-backed checkpoint saver.
 *
 * Most checkpoint savers ({@link MemorySaver}, `FileSaver`, `KeyValueStoreSaver`)
 * are symmetric blob stores: `save()` persists the whole {@link Checkpoint} and
 * `load()` reads it back. That model duplicates the message history when the
 * durable source of truth is an event log / transcript ledger, which is why
 * event-sourced platforms end up implementing `save()` as a no-op.
 *
 * `createLedgerCheckpointer` makes the event-sourced pattern first-class. It
 * reconstructs the message history from a transcript ledger on `load()`, and on
 * `save()` it persists only the *resume delta* — step, agent state, and pending
 * interrupt — to an inner saver, never re-writing the messages. The ledger stays
 * the single source of truth for the transcript.
 *
 * @module
 */

import type { ModelMessage } from "ai";
import { createAgentState } from "../backends/state.js";
import type { CanonicalMessage } from "../canonical.js";
import type { GetTranscriptOptions, ILedgerStore } from "../threads/ledger/index.js";
import { canonicalMessagesToModelMessages } from "../threads/ledger/model-messages.js";
import { MemorySaver } from "./memory-saver.js";
import type { BaseCheckpointSaver, Checkpoint } from "./types.js";

/**
 * Options for {@link createLedgerCheckpointer}.
 *
 * @category Checkpointer
 */
export interface LedgerCheckpointerOptions {
  /**
   * Durable transcript source. Message history is reconstructed from here on
   * `load()` and is never re-persisted on `save()`.
   */
  ledgerStore: ILedgerStore;

  /**
   * Branch resolution strategy used when reconstructing the transcript.
   *
   * @defaultValue "active"
   */
  branch?: GetTranscriptOptions["branch"];

  /**
   * Saver used to persist the resume delta (step, agent state, pending
   * interrupt, metadata) — everything in a checkpoint except the message
   * history. Provide a durable saver (e.g. `FileSaver` or `KeyValueStoreSaver`)
   * for resume state that survives a restart.
   *
   * @defaultValue a new in-memory {@link MemorySaver}
   */
  resumeSaver?: BaseCheckpointSaver;

  /**
   * Converts canonical transcript messages into AI SDK model messages.
   *
   * @defaultValue {@link canonicalMessagesToModelMessages}
   */
  toModelMessages?: (messages: readonly CanonicalMessage[]) => ModelMessage[];
}

/**
 * Creates a checkpoint saver backed by a transcript ledger.
 *
 * The returned saver reconstructs `messages` from `ledgerStore` on `load()` and
 * persists only the resume delta (step, state, pending interrupt, metadata) on
 * `save()`. This keeps the ledger as the single source of truth for the message
 * history while still supporting interrupt/resume.
 *
 * @param options - Configuration options
 * @returns A {@link BaseCheckpointSaver} backed by the ledger
 *
 * @example
 * ```typescript
 * import {
 *   createLedgerCheckpointer,
 *   createFileSaver,
 * } from "@lleverage-ai/agent-sdk";
 * import { InMemoryLedgerStore } from "@lleverage-ai/agent-sdk/threads/stores/ledger-memory";
 *
 * const checkpointer = createLedgerCheckpointer({
 *   ledgerStore: new InMemoryLedgerStore(),
 *   resumeSaver: createFileSaver({ dir: "./checkpoints" }),
 * });
 * ```
 *
 * @category Checkpointer
 */
export function createLedgerCheckpointer(options: LedgerCheckpointerOptions): BaseCheckpointSaver {
  const { ledgerStore } = options;
  const branch = options.branch ?? "active";
  const resumeSaver = options.resumeSaver ?? new MemorySaver();
  const toModelMessages = options.toModelMessages ?? canonicalMessagesToModelMessages;

  async function loadTranscript(threadId: string): Promise<ModelMessage[]> {
    // A thread with no ledger history resolves to an empty transcript from the
    // store; genuine store errors are allowed to propagate so a failed load
    // surfaces rather than silently resuming with no message history.
    const transcript = await ledgerStore.getTranscript({ threadId, branch });
    return toModelMessages(transcript);
  }

  async function hasTranscript(threadId: string): Promise<boolean> {
    const transcript = await ledgerStore.getTranscript({ threadId, branch });
    return transcript.length > 0;
  }

  return {
    async save(checkpoint: Checkpoint): Promise<void> {
      // Persist only the resume delta. Messages are owned by the ledger and are
      // never re-persisted here, so the ledger stays the single source of truth.
      await resumeSaver.save({ ...checkpoint, messages: [] });
    },

    async load(threadId: string): Promise<Checkpoint | undefined> {
      const [resume, messages] = await Promise.all([
        resumeSaver.load(threadId),
        loadTranscript(threadId),
      ]);

      if (!resume && messages.length === 0) {
        return undefined;
      }

      const now = new Date().toISOString();
      return {
        threadId,
        step: resume?.step ?? 0,
        messages,
        state: resume?.state ?? createAgentState(),
        pendingInterrupt: resume?.pendingInterrupt,
        createdAt: resume?.createdAt ?? now,
        updatedAt: now,
        metadata: resume?.metadata,
      };
    },

    async list(): Promise<string[]> {
      // Only threads with a persisted resume delta are enumerable here:
      // `ILedgerStore` exposes no thread-enumeration method, so transcript-only
      // threads (those never passed to `save()`) cannot be listed even though
      // `load()`/`exists()` can still resolve them by thread id. Callers that
      // need the full set must enumerate threads from the ledger themselves.
      return resumeSaver.list();
    },

    async delete(threadId: string): Promise<boolean> {
      // Deleting a checkpoint removes the whole thread — both the resume delta
      // and the durable ledger transcript — so `load()`/`exists()` no longer
      // resolve it afterwards. (Manage the ledger directly if you need to drop
      // resume state while keeping the transcript.)
      const existed = (await resumeSaver.exists(threadId)) || (await hasTranscript(threadId));
      await Promise.all([resumeSaver.delete(threadId), ledgerStore.deleteThread(threadId)]);
      return existed;
    },

    async exists(threadId: string): Promise<boolean> {
      if (await resumeSaver.exists(threadId)) {
        return true;
      }
      return hasTranscript(threadId);
    },
  };
}
