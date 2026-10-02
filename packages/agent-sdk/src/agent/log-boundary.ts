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
 * - Retries and fallback models are separate attempts: each provider call
 *   prepares its own manifest. A failed attempt is closed as `failed` (or
 *   `cancelled` when aborted).
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
  /**
   * Set when the call has no outcome yet: whether it was dispatched, and
   * whether its outputs were committed.
   */
  open: { dispatched: boolean; outputsCommitted: boolean } | undefined;
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
  /** The terminal model wrapped by the boundary. Send every step through it. */
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

/** Map response messages to output entries keyed by their position in the generation. @internal */
function toOutputEntries(
  messages: readonly ModelMessage[],
  keyPrefix: string,
  firstIndex: number,
  model: ContextModelRef,
): Array<AssistantContextEntryInput | ToolResultContextEntryInput> {
  return messages.map((message, offset) => {
    const key = `${keyPrefix}:${firstIndex + offset}`;
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
  let recoveredPrevious = false;
  // The dispatched call whose outputs are not committed yet.
  let open: { manifestId: string; model: ContextModelRef; responded: boolean } | undefined;
  // Whether the last call was closed without its outputs (failed, cancelled
  // or unknown). Its outputs are never committed.
  let lastCallClosed = false;
  // Response messages of this generation committed so far, and their entries
  // as the store returned them.
  let committedCount = 0;
  const committedOutputs: ContextEntryInput[] = [];
  let completion: Promise<void> | undefined;
  let closed = false;
  // The first commit failure (prepare, dispatch or outputs). The AI SDK can
  // turn it into a stream error part and still finish, so complete() and
  // abandon() consult it.
  let failure: unknown;
  // Response messages of every step the AI SDK finished, from onStepFinish.
  let finishedMessages: ModelMessage[] = [];

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
    await withRetriedWrite(() => store.recordOutcome(call.manifestId, { status })).catch(
      () => undefined,
    );
  }

  /**
   * A call the head still points at but nobody closed (the process that made
   * it crashed, or abandoned it). Once this boundary's prepare has moved the
   * head past it, its outputs can never be committed: record that.
   */
  async function closeAbandonedPrevious(): Promise<void> {
    if (recoveredPrevious) return;
    recoveredPrevious = true;
    const stale = plan.previousCall;
    if (!stale?.open) return;
    try {
      // Re-read the lifecycle: the call may have been dispatched or closed
      // since the snapshot. Its outputs could not have been committed since,
      // because that would have moved the head and failed this prepare.
      const current = await store.readManifest(stale.manifestId);
      if (current.outcome !== null) return;
      const status: ContextCallOutcomeStatus = stale.open.outputsCommitted
        ? "completed"
        : current.dispatchedAt !== null
          ? "unknown"
          : "cancelled";
      await withRetriedWrite(() => store.recordOutcome(stale.manifestId, { status }));
    } catch {
      // Best effort: a later prepare retries, and the outputs stay refused.
    }
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
    const prepared = await withRetriedWrite(() => store.prepare(request));
    if (prepared.manifest.inputDigest !== call.inputDigest) {
      throw new ContextLogInvalidError(
        "committed_input_mismatch",
        "The committed manifest does not describe the request about to be sent",
      );
    }
    moveHead(prepared.head);
    pending = { transition: undefined, append: [] };
    previous = {
      manifestId: prepared.manifest.id,
      model: modelRef,
      toolSnapshotDigest,
      open: undefined,
    };
    await closeAbandonedPrevious();

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
    if (fresh.length > 0) {
      // New outputs are new input to the next request: they pass the
      // PreGenerate screening (redaction, guardrails) before commit, and the
      // screened entries are what later steps are projected from.
      const screened = await deps.screenOutputs(
        toOutputEntries(fresh, plan.outputKeyPrefix, committedCount, call.model),
      );
      const items = screened.map((entry) => {
        if (entry.kind !== "assistant" && entry.kind !== "tool_result") {
          throw new ContextLogInvalidError(
            "invalid_output",
            "Output screening may only transform assistant outputs and tool results",
          );
        }
        return entry;
      });
      const before = head;
      const result = await withRetriedWrite(() =>
        store.appendOutputs({
          manifestId: call.manifestId,
          expectedRevision: before?.revision ?? 0,
          items,
        }),
      );
      // After an uncertain first try the store replays the commit with the
      // stream's current head. Continue only while that head is still this
      // call's: otherwise another writer moved it, and the next request would
      // no longer be a projection of its own committed path.
      if (
        result.head.lastManifestId !== call.manifestId ||
        result.head.versionId !== before?.versionId ||
        result.head.entryCount !== (before?.entryCount ?? 0) + items.length
      ) {
        throw new ContextLogConflictError("head_moved", {
          head: result.head,
          message:
            "Another writer moved the head after this call's outputs were committed; the call cannot continue from it",
        });
      }
      moveHead(result.head);
      committedOutputs.push(...result.entries.map(toEntryInput));
      committedCount = responseMessages.length;
    }
    await withRetriedWrite(() => store.recordOutcome(call.manifestId, { status: "completed" }));
    open = undefined;
  }

  const prepareStep: LogModePrepareStep = async ({ stepNumber, responseMessages }) => {
    if (stepNumber === 0) {
      return undefined;
    }
    await recordingFailure(() => commitOutputs(responseMessages, false));
    return { messages: await deps.project([...plan.entries, ...committedOutputs]) };
  };

  const wrapGenerate: WrapGenerate = async ({ doGenerate, params, model }) => {
    await prepareCall(params, model);
    try {
      params.abortSignal?.throwIfAborted();
      const result = await doGenerate();
      if (open) open.responded = true;
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
  const model = wrapLanguageModel({
    model: deps.model,
    middleware: { specificationVersion: "v4", wrapGenerate, wrapStream },
  });
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
      })();
      return completion;
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
