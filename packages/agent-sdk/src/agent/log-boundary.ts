/**
 * Log-mode commit boundary.
 *
 * One boundary serves one generation attempt. It wraps the attempt's terminal
 * provider model, so every provider request, including each tool-loop step
 * and each AI SDK retry, passes through it, and it commits exactly the
 * request the provider receives:
 *
 * ```
 *   prepareStep (step > 0)   appendOutputs(previous step) → recordOutcome(completed)
 *                            → compact (when the context policy asks)
 *                            → project the next step from committed entries
 *   provider call            admit(prepare) → prepare(append, manifest, CAS)
 *                            → admit(dispatch) → markDispatched → provider
 *   complete (after the run) appendOutputs(last step) → recordOutcome(completed)
 * ```
 *
 * - Nothing is sent without a committed, dispatched manifest whose input digest
 *   covers the provider's exact call options (the prompt, tools and settings,
 *   not the abort signal or transport headers).
 * - A step's outputs (the assistant message, then its tool results, after the
 *   tool pipeline shaped them) are committed before the next step is
 *   projected, so no request is built from uncommitted output. A failed output
 *   commit fails the run.
 * - A compaction between steps is a declared `compaction` transition that
 *   the next call's prepare commits before the compacted context is sent.
 *   A failed commit fails the step.
 * - Host request middleware (`contextLog.requestMiddleware`) wrap the
 *   boundary, so they run after the projection and the boundary commits the
 *   request they produce: agent → projection → request middleware →
 *   boundary → provider.
 * - Retries and fallback models are separate attempts: each provider call
 *   prepares its own manifest. A failed attempt is closed as `failed` (or
 *   `cancelled` when aborted).
 * - When a tool raises an interrupt, the interrupted call's placeholder
 *   result is not committed; the assistant entry records the interrupt as a
 *   `tool-approval-request` part (see `./log-interrupts.ts`), and the result
 *   is committed when the interrupt is resumed (`./log-resume.ts`).
 * - A call left open by a crash (prepared but not dispatched, or dispatched
 *   without committed outputs) is closed as `cancelled` or `unknown` by the
 *   next prepare on the stream. Its outputs can never be committed after that,
 *   because the head has moved past its manifest.
 *
 * @packageDocumentation
 * @internal
 */

import { createHash } from "node:crypto";
import {
  type LanguageModel,
  type LanguageModelMiddleware,
  type ModelMessage,
  wrapLanguageModel,
} from "ai";
import {
  ContextLogConflictError,
  ContextLogInvalidError,
  ContextLogRefusedError,
  isContextLogError,
} from "../context-log/errors.js";
import type {
  AssistantContextEntryInput,
  ContextAdmitHook,
  ContextCallOutcomeStatus,
  ContextEntry,
  ContextEntryInput,
  ContextHead,
  ContextLogStore,
  ContextManifest,
  ContextModelRef,
  ContextPrepareRequest,
  ContextToolSnapshotChange,
  ToolResultContextEntryInput,
} from "../context-log/types.js";
import { ConfigurationError } from "../errors/index.js";
import type { GenerateOptions } from "../types.js";
import type { LogCompaction } from "./log-compaction.js";

/** Attempts for a store write whose outcome was uncertain. @internal */
const STORE_WRITE_ATTEMPTS = 3;

type WrapGenerate = NonNullable<LanguageModelMiddleware["wrapGenerate"]>;
type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type ProviderCallOptions = Parameters<WrapGenerate>[0]["params"];
type ProviderModel = Parameters<WrapGenerate>[0]["model"];
type ProviderStreamResult = Awaited<ReturnType<WrapStream>>;
type ProviderStreamPart =
  ProviderStreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

/** Models created by {@link createLogCallBoundary}, so one is never wrapped twice. */
const boundaryModels = new WeakSet<object>();

/**
 * Run state shared by every attempt of one log-mode run.
 *
 * @internal
 */
export type LogRunState = NonNullable<GenerateOptions["_logRun"]>;

/**
 * The previous call on the stream, as the head's last manifest recorded it.
 *
 * @internal
 */
export interface LogPreviousCall {
  manifestId: string;
  model: ContextModelRef;
  /** Digest of the call's tool snapshot, when it recorded one. */
  toolSnapshotDigest: string | undefined;
}

/**
 * What a boundary needs from its attempt's plan.
 *
 * @internal
 */
export interface LogBoundaryPlan {
  stream: ContextPrepareRequest["stream"];
  head: ContextHead | null;
  transition: ContextPrepareRequest["transition"];
  append: ContextEntryInput[];
  messages: ModelMessage[];
  projection: { adapter: string; version: string };
  entries: ContextEntryInput[];
  outputKeyPrefix: string;
  previousCall: LogPreviousCall | undefined;
  run: LogRunState;
}

/**
 * Dependencies of {@link createLogCallBoundary}.
 *
 * @internal
 */
export interface LogCallBoundaryDeps {
  store: ContextLogStore;
  admit: ContextAdmitHook | undefined;
  plan: LogBoundaryPlan;
  /** The attempt's terminal provider model. */
  model: LanguageModel;
  /**
   * Host request middleware, applied in order between the projected request
   * and the boundary, so the boundary commits the request they produce.
   */
  requestMiddleware?: readonly LanguageModelMiddleware[];
  /** Projects a step's request from committed entries. */
  project: (entries: readonly ContextEntryInput[]) => Promise<ModelMessage[]>;
  /** Called whenever the boundary moves or observes the head. */
  onHead: (head: ContextHead) => void;
  /**
   * Screens new outputs before they are committed: the log-mode PreGenerate
   * hooks (secrets filter, guardrails) see them as new input and may redact
   * them or deny the run. Returns the entries to commit, in the same order.
   */
  screenOutputs: (
    items: ReadonlyArray<AssistantContextEntryInput | ToolResultContextEntryInput>,
  ) => Promise<ContextEntryInput[]>;
  /**
   * Plans a compaction of the committed path at `head` before the next step,
   * or returns `undefined` when the context policy does not ask for one.
   */
  compact?: (entries: ContextEntryInput[], head: ContextHead) => Promise<LogCompaction | undefined>;
}

/**
 * A tool call that raised an interrupt during the attempt.
 *
 * @internal
 */
export interface LogInterruptMark {
  /** The interrupt's id, recorded as the approval request's `approvalId`. */
  interruptId: string;
  /** The interrupted tool call. */
  toolCallId: string;
}

/**
 * Log-mode `prepareStep`: commits the previous step's outputs and projects
 * every provider step after the first through the projection adapter.
 *
 * @internal
 */
export type LogModePrepareStep = (step: {
  stepNumber: number;
  responseMessages: ModelMessage[];
}) => Promise<{ messages: ModelMessage[] } | undefined>;

/**
 * The commit boundary of one log-mode generation attempt.
 *
 * @internal
 */
export interface LogCallBoundary {
  /**
   * The terminal model wrapped by the boundary, and then by the host's
   * request middleware. Send every step through it.
   */
  readonly model: LanguageModel;
  /** The AI SDK `prepareStep` for the attempt. */
  readonly prepareStep: LogModePrepareStep;
  /**
   * The AI SDK `onStepFinish` for the attempt: remembers each finished step,
   * so a response the AI SDK received can still be committed when the SDK
   * throws after it (for example on invalid structured output).
   */
  readonly onStepFinish: (step: { response: { messages: ModelMessage[] } }) => void;
  /**
   * Commits the outputs of the generation's last step and closes its call.
   * Rejects with the first commit failure of the attempt, even one the AI SDK
   * turned into a stream error part. Idempotent: later calls return the first
   * call's promise.
   */
  complete(steps: ReadonlyArray<{ response: { messages: ModelMessage[] } }>): Promise<void>;
  /**
   * Closes the attempt after it failed or was cancelled. A finished step the
   * provider answered is still committed unless a commit already failed or
   * the attempt was cancelled; any other open call is closed without its
   * outputs. Never throws.
   */
  abandon(cancelled?: boolean): Promise<void>;
  /**
   * Whether the run may start another attempt after this one failed. Not
   * once the attempt's reply was committed (a retry would append a second
   * one), nor once a provider answered and its outputs were lost (its tools
   * may have run, and a retry would run them again), nor once a compaction
   * could not be committed (a failed compaction commit fails the run).
   */
  isRetrySafe(): boolean;
  /**
   * Tells the boundary where to read the attempt's interrupt, if a tool
   * raises one. The interrupted call's placeholder result is then never
   * committed: the assistant entry records the interrupt as a
   * `tool-approval-request` part, and the call's result is committed when
   * the interrupt is resumed.
   */
  observeInterrupt(read: () => LogInterruptMark | undefined): void;
}

/** Lowercase hexadecimal SHA-256 of a string. @internal */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * JSON with sorted object keys and binary data as base64, for digests of
 * provider call options (which may carry `Uint8Array` file data and URLs).
 *
 * @internal
 */
export function canonicalCallJson(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (current instanceof Uint8Array) {
      return { $bytes: Buffer.from(current).toString("base64") };
    }
    if (current === null || typeof current !== "object" || Array.isArray(current)) return current;
    const sorted: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(current).sort()) {
      sorted[key] = (current as Record<string, unknown>)[key];
    }
    return sorted;
  });
}

/**
 * The digests and exact bytes a manifest records for a provider call.
 *
 * The input digest covers everything that reaches the model: the prompt, the
 * tool definitions and every other call option. The abort signal, the
 * transport headers (which can carry credentials) and `includeRawChunks` (a
 * streaming transport flag) are excluded.
 *
 * @internal
 */
export function describeProviderCall(params: ProviderCallOptions): {
  inputDigest: string;
  toolSnapshot: string;
  callOptions: string;
} {
  const {
    prompt,
    tools,
    abortSignal: _signal,
    headers: _headers,
    includeRawChunks: _rawChunks,
    ...settings
  } = params;
  const toolSnapshot = JSON.stringify(tools ?? []);
  const callOptions = JSON.stringify(settings);
  return {
    inputDigest: sha256Hex(canonicalCallJson({ prompt, tools: tools ?? [], settings })),
    toolSnapshot,
    callOptions,
  };
}

/**
 * A deep copy of request data: arrays, plain objects, byte arrays and URLs
 * are copied; anything else (functions, class instances) is kept as is.
 */
function copyRequestData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyRequestData);
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof URL) return new URL(value.href);
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      const copy: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        // Defined, not assigned, so an own `__proto__` key stays a property.
        Object.defineProperty(copy, key, {
          value: copyRequestData(item),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return copy;
    }
  }
  return value;
}

/**
 * Provider call options whose request data (prompt, tools, settings and
 * provider options) is a private copy, so a middleware that changes it in
 * place cannot change the AI SDK's own objects, which the AI SDK reuses for
 * its retries and later steps. The abort signal and transport headers are
 * passed through unchanged.
 *
 * @internal
 */
export function isolateCallOptions(params: ProviderCallOptions): ProviderCallOptions {
  const { abortSignal, headers, ...data } = params;
  return {
    ...(copyRequestData(data) as typeof data),
    ...("abortSignal" in params && { abortSignal }),
    ...("headers" in params && { headers }),
  };
}

/** Gives the next middleware its own copy of the request data. */
const isolateRequestMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v4",
  transformParams: async ({ params }) => isolateCallOptions(params),
};

/** Whether a model is already a log-mode boundary. @internal */
export function isLogBoundaryModel(model: LanguageModel | undefined): boolean {
  return typeof model === "object" && model !== null && boundaryModels.has(model);
}

/**
 * Rejects a model the boundary cannot sit in front of: a model id string
 * (resolved by the AI SDK after the boundary) or a model that is already a
 * boundary.
 *
 * @internal
 */
export function assertTerminalModel(model: LanguageModel | undefined, configKey: string): void {
  if (model === undefined) return;
  if (typeof model === "string") {
    throw new ConfigurationError(
      `Context log mode needs the terminal provider model, not the model id "${model}": the commit boundary must wrap the model that receives the request`,
      { configKey },
    );
  }
  if (isLogBoundaryModel(model)) {
    throw new ConfigurationError(
      "Context log mode cannot wrap a model that already has a context log boundary",
      { configKey },
    );
  }
}

/** The content of a committed entry, without store-assigned fields. @internal */
export function toEntryInput(entry: ContextEntry): ContextEntryInput {
  const { position: _p, versionId: _v, manifestId: _m, createdAt: _c, ...input } = entry;
  return input as ContextEntryInput;
}

/** A response message and its position among the generation's response messages. */
interface IndexedMessage {
  message: ModelMessage;
  index: number;
}

/**
 * Records an interrupt in a step's outputs: the assistant message that made
 * the interrupted call gains a `tool-approval-request` part (the AI SDK's own
 * record of a call waiting on a person, which it never sends to a provider),
 * and the call's placeholder result is dropped, together with a tool message
 * it leaves empty. The call's real result is committed on resume, so the
 * provider later sees the same messages as a run that was never interrupted.
 *
 * Outputs that do not contain the interrupted call are returned unchanged.
 *
 * @internal
 */
export function recordInterruptInOutputs(
  messages: readonly IndexedMessage[],
  mark: LogInterruptMark,
): IndexedMessage[] {
  const callsInterrupted = ({ message }: IndexedMessage) =>
    message.role === "assistant" &&
    Array.isArray(message.content) &&
    message.content.some(
      (part) => part.type === "tool-call" && part.toolCallId === mark.toolCallId,
    );
  if (!messages.some(callsInterrupted)) {
    return [...messages];
  }
  const result: IndexedMessage[] = [];
  for (const indexed of messages) {
    const { message } = indexed;
    if (callsInterrupted(indexed) && message.role === "assistant") {
      const content = message.content as Exclude<typeof message.content, string>;
      result.push({
        ...indexed,
        message: {
          ...message,
          content: [
            ...content,
            {
              type: "tool-approval-request",
              approvalId: mark.interruptId,
              toolCallId: mark.toolCallId,
            },
          ],
        },
      });
      continue;
    }
    if (message.role === "tool") {
      const content = message.content.filter(
        (part) => part.type !== "tool-result" || part.toolCallId !== mark.toolCallId,
      );
      if (content.length > 0) {
        result.push({ ...indexed, message: { ...message, content } });
      }
      continue;
    }
    result.push(indexed);
  }
  return result;
}

/** Map response messages to output entries keyed by their position in the generation. @internal */
function toOutputEntries(
  messages: readonly IndexedMessage[],
  keyPrefix: string,
  model: ContextModelRef,
): Array<AssistantContextEntryInput | ToolResultContextEntryInput> {
  return messages.map(({ message, index }) => {
    const key = `${keyPrefix}:${index}`;
    if (message.role === "assistant") {
      return { kind: "assistant", key, message, model };
    }
    if (message.role === "tool") {
      return { kind: "tool_result", key, message };
    }
    throw new ContextLogInvalidError(
      "invalid_output",
      `A model step produced a "${message.role}" message; only assistant and tool messages are outputs`,
    );
  });
}

/**
 * Screens new outputs through the log-mode PreGenerate hooks, then commits
 * them as outputs of `manifestId`, which must own `head`. Fails with a
 * `head_moved` conflict when the store's resulting head shows that another
 * writer moved the stream, because the caller could no longer continue from
 * its own committed path.
 *
 * @internal
 */
export async function appendScreenedOutputs(params: {
  store: ContextLogStore;
  manifestId: string;
  head: ContextHead | null;
  items: Array<AssistantContextEntryInput | ToolResultContextEntryInput>;
  screenOutputs: LogCallBoundaryDeps["screenOutputs"];
}): Promise<{ head: ContextHead; entries: ContextEntryInput[] }> {
  const { store, manifestId, head } = params;
  // New outputs are new input to the next request: they pass the
  // PreGenerate screening (redaction, guardrails) before commit, and the
  // screened entries are what later requests are projected from.
  const screened = await params.screenOutputs(params.items);
  const items = screened.map((entry) => {
    if (entry.kind !== "assistant" && entry.kind !== "tool_result") {
      throw new ContextLogInvalidError(
        "invalid_output",
        "Output screening may only transform assistant outputs and tool results",
      );
    }
    return entry;
  });
  const result = await withRetriedWrite(() =>
    store.appendOutputs({ manifestId, expectedRevision: head?.revision ?? 0, items }),
  );
  // After an uncertain first try the store replays the commit with the
  // stream's current head. Continue only while that head is still this
  // call's: otherwise another writer moved it, and the next request would
  // no longer be a projection of its own committed path.
  if (
    result.head.lastManifestId !== manifestId ||
    result.head.versionId !== head?.versionId ||
    result.head.entryCount !== (head?.entryCount ?? 0) + items.length
  ) {
    throw new ContextLogConflictError("head_moved", {
      head: result.head,
      message:
        "Another writer moved the head after this call's outputs were committed; the call cannot continue from it",
    });
  }
  return { head: result.head, entries: result.entries.map(toEntryInput) };
}

/**
 * Runs a store write, retrying exactly the same request after an uncertain
 * (`unavailable`) result. Only for writes that are idempotent under retry:
 * `prepare`, `appendOutputs` and `recordOutcome`.
 */
async function withRetriedWrite<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (attempt >= STORE_WRITE_ATTEMPTS || !isContextLogError(error, "unavailable")) {
        throw error;
      }
    }
  }
}

/**
 * Create the commit boundary for one log-mode generation attempt.
 *
 * @internal
 */
export function createLogCallBoundary(deps: LogCallBoundaryDeps): LogCallBoundary {
  const { store, admit, plan, onHead } = deps;
  const run = plan.run;

  // The head as this boundary last observed it, and what the next prepare
  // still has to commit (the run's new input and any transition).
  let head = plan.head;
  let pending: { transition: ContextPrepareRequest["transition"]; append: ContextEntryInput[] } = {
    transition: plan.transition,
    append: plan.append,
  };
  let previous = plan.previousCall;
  // The dispatched call whose outputs are not committed yet.
  let open: { manifestId: string; model: ContextModelRef; responded: boolean } | undefined;
  // Whether the last call was closed without its outputs (failed, cancelled
  // or unknown). Its outputs are never committed.
  let lastCallClosed = false;
  // The committed path the next step is projected from (the plan's entries,
  // or a compacted child's), then the response messages of this generation
  // committed so far and their entries as the store returned them. A
  // compaction folds the outputs into the base.
  let baseEntries: ContextEntryInput[] = plan.entries;
  let committedCount = 0;
  let committedOutputs: ContextEntryInput[] = [];
  let completion: Promise<void> | undefined;
  let completed = false;
  // Set once a provider answered but its outputs were not committed: they
  // are lost, and its tools may have run.
  let outputsLost = false;
  // Set once a prepare that declared a compaction could not be committed,
  // after its bounded identical-request retries. The run then fails: no
  // retry or fallback summarises and compacts again.
  let compactionUncommitted = false;
  let closed = false;
  // The first commit failure (prepare, dispatch or outputs). The AI SDK can
  // turn it into a stream error part and still finish, so complete() and
  // abandon() consult it.
  let failure: unknown;
  // Response messages of every step the AI SDK finished, from onStepFinish.
  let finishedMessages: ModelMessage[] = [];
  // Reads the interrupt a tool raised during the attempt, if any.
  let readInterrupt: (() => LogInterruptMark | undefined) | undefined;
  // Provider responses received through the boundary. Lets the request
  // middleware guard tell a response the provider gave from one a host
  // middleware made up without calling it.
  let providerResponses = 0;

  function moveHead(next: ContextHead): void {
    head = next;
    onHead(next);
  }

  /** Closes the open call with a terminal status; best effort. */
  async function closeOpen(status: ContextCallOutcomeStatus): Promise<void> {
    const call = open;
    open = undefined;
    if (!call) return;
    lastCallClosed = true;
    if (status === "unknown") outputsLost = true;
    await withRetriedWrite(() => store.recordOutcome(call.manifestId, { status })).catch(
      () => undefined,
    );
  }

  async function admitOrRefuse(input: Parameters<ContextAdmitHook>[0]): Promise<void> {
    if (!admit) return;
    const decision = await admit(input);
    if (!decision.allow) {
      throw new ContextLogRefusedError("admit_refused", {
        message: `Context log ${input.phase} refused: ${decision.reason}`,
      });
    }
  }

  /** Marks a prepared call dispatched, recovering from an uncertain result. */
  async function markDispatched(manifestId: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await store.markDispatched(manifestId);
        return;
      } catch (error) {
        if (!isContextLogError(error, "unavailable")) throw error;
        // Never retry blindly: the mark may have committed.
        const manifest = await store.readManifest(manifestId);
        if (manifest.dispatchedAt !== null) {
          // It did. It is not sent; close it so a new attempt prepares again.
          await store.recordOutcome(manifestId, { status: "cancelled" }).catch(() => undefined);
          throw error;
        }
        if (attempt >= STORE_WRITE_ATTEMPTS) {
          await store.recordOutcome(manifestId, { status: "cancelled" }).catch(() => undefined);
          throw error;
        }
      }
    }
  }

  /** Remembers the attempt's first commit failure, then rethrows it. */
  async function recordingFailure<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      failure ??= error;
      throw error;
    }
  }

  /** Commits the run's pending input and the call's manifest, then dispatches it. */
  function prepareCall(params: ProviderCallOptions, model: ProviderModel): Promise<void> {
    return recordingFailure(() => prepareAndDispatch(params, model));
  }

  async function prepareAndDispatch(
    params: ProviderCallOptions,
    model: ProviderModel,
  ): Promise<void> {
    if (closed) {
      throw new ContextLogInvalidError(
        "boundary_closed",
        "A provider call reached a closed context log boundary",
      );
    }
    if (open) {
      throw new ContextLogInvalidError(
        "outputs_not_committed",
        "A provider call was made before the previous call's outputs were committed",
      );
    }
    const call = describeProviderCall(params);
    if (run.lastInputDigest === call.inputDigest) {
      run.attempt += 1;
    } else {
      run.ordinal += 1;
      run.attempt = 1;
    }
    run.lastInputDigest = call.inputDigest;
    const modelRef: ContextModelRef = { provider: model.provider, modelId: model.modelId };
    const toolSnapshotDigest = sha256Hex(call.toolSnapshot);
    let toolSnapshotChange: ContextToolSnapshotChange | undefined;
    if (
      previous?.toolSnapshotDigest !== undefined &&
      previous.toolSnapshotDigest !== toolSnapshotDigest
    ) {
      toolSnapshotChange = {
        previousDigest: previous.toolSnapshotDigest,
        digest: toolSnapshotDigest,
        cause:
          previous.model.provider !== modelRef.provider ||
          previous.model.modelId !== modelRef.modelId
            ? "model_change"
            : "tool_definition",
      };
    }

    const request: ContextPrepareRequest = {
      stream: plan.stream,
      expectedRevision: head?.revision ?? 0,
      idempotencyKey: `call:${run.id}:${run.ordinal}:${run.attempt}`,
      ...(pending.transition && { transition: pending.transition }),
      append: pending.append,
      // The call the head points at is superseded by this one. Whatever its
      // state (a crash left it open, or this process could not record its
      // outcome), the store closes it in the same write, so it can never stay
      // open once the head has moved past it.
      ...(head && { closeSuperseded: head.lastManifestId }),
      manifest: {
        projection: plan.projection,
        model: modelRef,
        inputDigest: call.inputDigest,
        toolSnapshot: call.toolSnapshot,
        callOptions: call.callOptions,
        ordinal: run.ordinal,
        attempt: run.attempt,
        ...(toolSnapshotChange && { toolSnapshotChange }),
      },
    };
    await admitOrRefuse({ phase: "prepare", head, request });
    let prepared: Awaited<ReturnType<ContextLogStore["prepare"]>>;
    try {
      prepared = await withRetriedWrite(() => store.prepare(request));
    } catch (error) {
      if (request.transition?.reason === "compaction") compactionUncommitted = true;
      throw error;
    }
    if (prepared.manifest.inputDigest !== call.inputDigest) {
      throw new ContextLogInvalidError(
        "committed_input_mismatch",
        "The committed manifest does not describe the request about to be sent",
      );
    }
    moveHead(prepared.head);
    pending = { transition: undefined, append: [] };
    // The run's input is in the log now (this prepare committed it, or an
    // earlier one did), so no later attempt appends it again.
    run.inputCommitted = true;
    previous = { manifestId: prepared.manifest.id, model: modelRef, toolSnapshotDigest };

    const manifest: ContextManifest = prepared.manifest;
    try {
      await admitOrRefuse({ phase: "dispatch", head, manifest });
    } catch (error) {
      await store.recordOutcome(manifest.id, { status: "cancelled" }).catch(() => undefined);
      throw error;
    }
    await markDispatched(manifest.id);
    open = { manifestId: manifest.id, model: modelRef, responded: false };
    lastCallClosed = false;
  }

  /**
   * Commits response messages not committed yet, then completes their call.
   * `final` is set for the generation's last step: the partial output of a
   * call that already failed is then left uncommitted instead of refused.
   */
  async function commitOutputs(
    responseMessages: readonly ModelMessage[],
    final: boolean,
  ): Promise<void> {
    const call = open;
    const fresh = responseMessages.slice(committedCount);
    if (!call) {
      if (fresh.length > 0 && !(final && lastCallClosed)) {
        // Never build a request from output that has no call to commit it to.
        throw new ContextLogInvalidError(
          "outputs_without_call",
          "Model outputs appeared without a dispatched call to commit them to",
        );
      }
      return;
    }
    const indexed = fresh.map((message, offset) => ({ message, index: committedCount + offset }));
    const mark = readInterrupt?.();
    const outputs = mark ? recordInterruptInOutputs(indexed, mark) : indexed;
    if (outputs.length > 0) {
      const result = await appendScreenedOutputs({
        store,
        manifestId: call.manifestId,
        head,
        items: toOutputEntries(outputs, plan.outputKeyPrefix, call.model),
        screenOutputs: deps.screenOutputs,
      });
      moveHead(result.head);
      committedOutputs.push(...result.entries);
    }
    committedCount = responseMessages.length;
    await withRetriedWrite(() => store.recordOutcome(call.manifestId, { status: "completed" }));
    open = undefined;
  }

  const prepareStep: LogModePrepareStep = async ({ stepNumber, responseMessages }) => {
    if (stepNumber === 0) {
      return undefined;
    }
    await recordingFailure(() => commitOutputs(responseMessages, false));
    const entries = [...baseEntries, ...committedOutputs];
    const compact = deps.compact;
    const at = head;
    if (compact && at) {
      const compaction = await recordingFailure(() => compact(entries, at));
      if (compaction) {
        // Committed by the next call's prepare, before anything is sent.
        pending = { transition: compaction.transition, append: compaction.append };
        baseEntries = compaction.entries;
        committedOutputs = [];
        return { messages: await deps.project(baseEntries) };
      }
    }
    return { messages: await deps.project(entries) };
  };

  const wrapGenerate: WrapGenerate = async ({ doGenerate, params, model }) => {
    await prepareCall(params, model);
    try {
      params.abortSignal?.throwIfAborted();
      const result = await doGenerate();
      if (open) open.responded = true;
      providerResponses += 1;
      return result;
    } catch (error) {
      await closeOpen(params.abortSignal?.aborted ? "cancelled" : "failed");
      throw error;
    }
  };

  const wrapStream: WrapStream = async ({ doStream, params, model }) => {
    await prepareCall(params, model);
    let result: ProviderStreamResult;
    try {
      params.abortSignal?.throwIfAborted();
      result = await doStream();
      providerResponses += 1;
    } catch (error) {
      await closeOpen(params.abortSignal?.aborted ? "cancelled" : "failed");
      throw error;
    }
    const reader = result.stream.getReader();
    // Settled once the provider finished, failed or the consumer cancelled.
    let settled = false;
    return {
      ...result,
      stream: new ReadableStream<ProviderStreamPart>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              if (!settled) {
                // The provider ended without a finish: its output is unknown.
                settled = true;
                await closeOpen("unknown");
              }
              controller.close();
              return;
            }
            if (!settled && chunk.value.type === "finish") {
              settled = true;
              // The outputs are committed by the next step or by complete().
              if (open) open.responded = true;
            } else if (!settled && chunk.value.type === "error") {
              settled = true;
              await closeOpen("failed");
            }
            controller.enqueue(chunk.value);
          } catch (error) {
            if (!settled) {
              settled = true;
              await closeOpen(params.abortSignal?.aborted ? "cancelled" : "failed");
            }
            controller.error(error);
          }
        },
        async cancel(reason) {
          const cancelling = !settled;
          settled = true;
          try {
            await reader.cancel(reason);
          } finally {
            if (cancelling) await closeOpen("cancelled");
          }
        },
      }),
    };
  };

  if (typeof deps.model === "string") {
    // Unreachable for agents validated at creation; keeps the type narrow.
    throw new ConfigurationError("Context log mode needs the terminal provider model", {
      configKey: "model",
    });
  }
  const boundaryModel = wrapLanguageModel({
    model: deps.model,
    middleware: { specificationVersion: "v4", wrapGenerate, wrapStream },
  });
  boundaryModels.add(boundaryModel);
  // Host request middleware run after the projection and before the
  // boundary: the first one transforms the projected request first, and the
  // boundary commits and digests the request the last one produces. Each
  // gets its own copy of the request data, so one that rewrites it in place
  // cannot change the AI SDK's request, which a retry or a later step
  // reuses: every attempt applies the middleware once to the projection.
  // The outermost guard refuses a response a host middleware returned
  // without the provider answering through the boundary (a cache, or a
  // swallowed failure), before the AI SDK can run its tool calls: nothing
  // may generate from output that has no committed call.
  const requestMiddleware = deps.requestMiddleware ?? [];
  const bypassed = () =>
    new ContextLogInvalidError(
      "boundary_bypassed",
      "A request middleware returned a response the provider did not give through the commit boundary; request middleware must call the wrapped model",
    );
  const guardMiddleware: LanguageModelMiddleware = {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate }) => {
      const before = providerResponses;
      const result = await doGenerate();
      if (providerResponses === before) throw bypassed();
      return result;
    },
    wrapStream: async ({ doStream }) => {
      const before = providerResponses;
      const result = await doStream();
      if (providerResponses === before) throw bypassed();
      return result;
    },
  };
  const model =
    requestMiddleware.length > 0
      ? wrapLanguageModel({
          model: boundaryModel,
          middleware: [
            guardMiddleware,
            ...requestMiddleware.flatMap((middleware) => [isolateRequestMiddleware, middleware]),
          ],
        })
      : boundaryModel;
  boundaryModels.add(model);

  return {
    model,
    prepareStep,
    onStepFinish(step) {
      finishedMessages = [...finishedMessages, ...step.response.messages];
    },
    complete(steps) {
      completion ??= (async () => {
        if (failure !== undefined) {
          // A commit already failed; never report this attempt as complete.
          throw failure;
        }
        await recordingFailure(() =>
          commitOutputs(
            steps.flatMap((step) => step.response.messages),
            true,
          ),
        );
        closed = true;
        completed = true;
      })();
      return completion;
    },
    isRetrySafe: () => !completed && !outputsLost && !compactionUncommitted,
    observeInterrupt(read) {
      readInterrupt = read;
    },
    async abandon(cancelled = false) {
      if (closed && !open) return;
      closed = true;
      if (!open) return;
      // Only when the open call's own step finished, so its outputs are complete.
      if (
        !cancelled &&
        failure === undefined &&
        open.responded &&
        finishedMessages.length > committedCount
      ) {
        // The provider answered and the AI SDK finished the step, but threw
        // afterwards (for example on invalid structured output). The output
        // is real: commit it rather than lose it.
        try {
          await commitOutputs(finishedMessages, true);
          // The reply is committed: the attempt must not run again.
          completed = true;
          return;
        } catch {
          // Fall through: the output stays uncommitted.
        }
      }
      if (!open) return;
      await closeOpen(cancelled ? "cancelled" : open.responded ? "unknown" : "failed");
    },
  };
}
