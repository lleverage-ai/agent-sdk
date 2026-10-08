/**
 * Pending user input: user messages a host delivers to a running generation
 * between tool-loop steps (`GenerateOptions.pendingUserInput`).
 *
 * The input is only ever read in `prepareStep` for a step after the first,
 * after the previous step's tool results are settled, and never in the
 * provider call: a retry of a call must send exactly the request it retries.
 *
 * - Log mode (`./log-boundary.ts`): each message becomes a `user` entry keyed
 *   `steer:<id>`, committed by the next call's prepare.
 * - Otherwise (`./generation-runner.ts`): each message is tagged with its id
 *   under `providerOptions.agentSdk` and appended to the tracked transcript.
 *
 * @packageDocumentation
 * @internal
 */

import type { ModelMessage, UserModelMessage } from "ai";
import { ValidationError } from "../errors/index.js";
import type { GenerateOptions, PendingUserMessage } from "../types.js";

/** Provider options namespace that carries a delivered message's id outside log mode. @internal */
export const PENDING_INPUT_PROVIDER_KEY = "agentSdk";
/** Field under {@link PENDING_INPUT_PROVIDER_KEY} that holds the id. @internal */
export const PENDING_INPUT_ID_FIELD = "pendingUserInputId";
/** Longest accepted id, so `steer:<id>` stays within the log's key limit. @internal */
const MAX_ID_LENGTH = 1000;

/** The context log key of a delivered message. @internal */
export function pendingInputKey(id: string): string {
  return `steer:${id}`;
}

/**
 * Reads the host's pending input for one generation attempt and reports
 * what was delivered.
 *
 * @internal
 */
export interface PendingInputSource {
  /**
   * Reads the pending messages. `fresh` are the messages to deliver now, in
   * order; `skipped` are ids `isDelivered` reports as already in the
   * conversation, not reported to the host yet. An id this source already
   * returned as fresh is never returned again.
   */
  take(
    isDelivered: (id: string) => boolean,
  ): Promise<{ fresh: PendingUserMessage[]; skipped: string[] }>;
  /**
   * Reports ids to the host, at most once each: delivered by this attempt,
   * or `alreadyCommitted` (skipped because already in the conversation).
   * Never throws.
   */
  committed(ids: readonly string[], alreadyCommitted?: boolean): Promise<void>;
}

/**
 * Creates the attempt's pending input source, or `undefined` when the
 * generation has no `pendingUserInput`.
 *
 * @internal
 */
export function createPendingInputSource(
  options: Pick<GenerateOptions, "pendingUserInput" | "onPendingUserInputCommitted">,
): PendingInputSource | undefined {
  const read = options.pendingUserInput;
  if (!read) return undefined;
  const onCommitted = options.onPendingUserInputCommitted;
  const taken = new Set<string>();
  const reported = new Set<string>();

  return {
    async take(isDelivered) {
      const items: unknown = await read();
      if (!Array.isArray(items)) {
        throw new ValidationError("pendingUserInput must resolve to an array of messages", {
          fieldErrors: { pendingUserInput: ["must resolve to an array"] },
        });
      }
      const fresh: PendingUserMessage[] = [];
      const skipped: string[] = [];
      const seen = new Set<string>();
      items.forEach((item, index) => {
        assertPendingUserMessage(item, index);
        const { id } = item;
        if (seen.has(id) || taken.has(id)) return;
        seen.add(id);
        if (isDelivered(id)) {
          // Never fresh later in the attempt, even once a compaction took
          // its entry off the path.
          taken.add(id);
          if (!reported.has(id)) skipped.push(id);
          return;
        }
        taken.add(id);
        fresh.push(item);
      });
      return { fresh, skipped };
    },
    async committed(ids, alreadyCommitted = false) {
      const unreported = ids.filter((id) => !reported.has(id));
      if (unreported.length === 0) return;
      for (const id of unreported) reported.add(id);
      if (!onCommitted) return;
      try {
        await (alreadyCommitted
          ? onCommitted([], { alreadyCommitted: unreported })
          : onCommitted(unreported, { alreadyCommitted: [] }));
      } catch {
        // The messages are already delivered; the host's bookkeeping failing
        // must not fail the generation.
      }
    },
  };
}

function assertPendingUserMessage(
  item: unknown,
  index: number,
): asserts item is PendingUserMessage {
  const field = `pendingUserInput[${index}]`;
  const fail = (message: string): never => {
    throw new ValidationError(`${field} ${message}`, { fieldErrors: { [field]: [message] } });
  };
  if (typeof item !== "object" || item === null) fail("must be an object with id and message");
  const { id, message } = item as { id?: unknown; message?: unknown };
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LENGTH) {
    fail(`must have an id of 1 to ${MAX_ID_LENGTH} characters`);
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters
  if (/[\u0000-\u001f\u007f]/.test(id as string))
    fail("must have an id without control characters");
  const role =
    typeof message === "object" && message !== null
      ? (message as { role?: unknown }).role
      : undefined;
  if (role !== "user") fail("must carry a user message");
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string" && !Array.isArray(content)) {
    fail("must have string content or an array of parts");
  }
}

/** The pending input id a transcript message was delivered with, if any. @internal */
export function deliveredInputId(message: ModelMessage): string | undefined {
  if (message.role !== "user") return undefined;
  const value = message.providerOptions?.[PENDING_INPUT_PROVIDER_KEY]?.[PENDING_INPUT_ID_FIELD];
  return typeof value === "string" ? value : undefined;
}

/**
 * The message as it is appended to a transcript outside log mode: a copy
 * with its id under `providerOptions.agentSdk`.
 *
 * @internal
 */
export function tagDeliveredInput({ id, message }: PendingUserMessage): UserModelMessage {
  const existing = message.providerOptions?.[PENDING_INPUT_PROVIDER_KEY];
  return {
    ...message,
    providerOptions: {
      ...message.providerOptions,
      [PENDING_INPUT_PROVIDER_KEY]: { ...existing, [PENDING_INPUT_ID_FIELD]: id },
    },
  };
}

/**
 * Pending input outside log mode, for one generation attempt: takes the
 * messages for the next step and remembers before which step each batch
 * was delivered, so a transcript rebuilt from step responses keeps them.
 *
 * @internal
 */
export interface TranscriptPendingInput {
  /**
   * Before step `stepNumber` (> 0): reads the pending input, skipping ids
   * already in `transcript` or delivered by this attempt, and returns the
   * tagged messages to append, after reporting any skipped ids. Call
   * {@link TranscriptPendingInput.delivered} once they are appended.
   */
  take(stepNumber: number, transcript: readonly ModelMessage[]): Promise<UserModelMessage[]>;
  /** Records `messages` as appended before `stepNumber` and reports their ids. */
  delivered(stepNumber: number, messages: readonly UserModelMessage[]): Promise<void>;
  /** Messages delivered before each step, by step number. */
  readonly byStep: ReadonlyMap<number, readonly ModelMessage[]>;
}

/**
 * Messages a run delivered outside log mode, shared by its attempts: a
 * retry or fallback attempt starts from the checkpoint again, so it
 * re-appends them (see {@link withDeliveredInput}) instead of losing input
 * the host was already told about.
 *
 * @internal
 */
export interface TranscriptPendingInputRun {
  delivered: UserModelMessage[];
}

/**
 * `messages` followed by the run's delivered input that they do not hold
 * yet (by id), for an attempt after the first.
 *
 * @internal
 */
export function withDeliveredInput(
  messages: ModelMessage[],
  run: TranscriptPendingInputRun | undefined,
): ModelMessage[] {
  if (!run || run.delivered.length === 0) return messages;
  const present = new Set(messages.flatMap((message) => deliveredInputId(message) ?? []));
  const missing = run.delivered.filter((message) => {
    const id = deliveredInputId(message);
    return id === undefined || !present.has(id);
  });
  return missing.length > 0 ? [...messages, ...missing] : messages;
}

/**
 * Creates the attempt's transcript pending input, or `undefined` when the
 * generation has no `pendingUserInput`. Delivered messages are also recorded
 * in `run`, when given.
 *
 * @internal
 */
export function createTranscriptPendingInput(
  options: Pick<GenerateOptions, "pendingUserInput" | "onPendingUserInputCommitted">,
  run?: TranscriptPendingInputRun,
): TranscriptPendingInput | undefined {
  const source = createPendingInputSource(options);
  if (!source) return undefined;
  const byStep = new Map<number, ModelMessage[]>();

  return {
    async take(_stepNumber, transcript) {
      // In the conversation: the transcript's tagged messages, and what the
      // run delivered, which a compaction may have summarised away since.
      const inConversation = new Set<string>();
      for (const message of [...transcript, ...(run?.delivered ?? [])]) {
        const id = deliveredInputId(message);
        if (id !== undefined) inConversation.add(id);
      }
      const { fresh, skipped } = await source.take((id) => inConversation.has(id));
      if (skipped.length > 0) await source.committed(skipped, true);
      return fresh.map(tagDeliveredInput);
    },
    async delivered(stepNumber, messages) {
      if (messages.length === 0) return;
      byStep.set(stepNumber, [...(byStep.get(stepNumber) ?? []), ...messages]);
      if (run) {
        const known = new Set(run.delivered.map(deliveredInputId));
        run.delivered.push(...messages.filter((message) => !known.has(deliveredInputId(message))));
      }
      const ids = messages.flatMap((message) => deliveredInputId(message) ?? []);
      await source.committed(ids);
    },
    byStep,
  };
}
