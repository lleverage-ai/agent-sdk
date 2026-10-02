/**
 * Log-mode request projection.
 *
 * In log mode the context log store is the agent's history. Each call reads
 * its stream's head once and builds the request as
 * `project(core(version), path(head) + new input, target)` through the
 * configured {@link ProjectionAdapter}:
 *
 * - The core is frozen per version. A static `systemPrompt` or
 *   `contextLog.resolveCore` supplies it only when a version is created; an
 *   existing version always projects its stored core.
 * - Caller-supplied history is rejected. The only new content is the run's
 *   user input, which reaches PreGenerate hooks as `options.messages` so the
 *   input-security hooks (secret redaction, guardrails) see it before it can
 *   be committed or sent.
 * - Every provider step goes through the adapter: tool-loop continuations
 *   are projected from the same entries plus the assistant and tool messages
 *   earlier steps of the generation produced and committed.
 * - Every provider call goes through the attempt's commit boundary
 *   (`./log-boundary.ts`), which commits the call's input before dispatch and
 *   each step's outputs before anything uses them.
 * - The adapter sees entry content only, never store-assigned fields, so a
 *   path projects to the same bytes before and after commit.
 * - Media capability projection happens inside the adapter, keyed by the
 *   version's contract. A version whose contract does not match the current
 *   adapter and model is never projected; that needs a declared transition.
 *
 * Nothing here reads or writes `Checkpoint.messages`.
 *
 * @packageDocumentation
 * @internal
 */

import { randomUUID } from "node:crypto";
import type { LanguageModel, ModelMessage, ToolCallPart, UserModelMessage } from "ai";
import type { Interrupt } from "../checkpointer/types.js";
import type { DelegationStreamClaim } from "../context-log/delegation.js";
import {
  ContextLogConflictError,
  ContextLogInvalidError,
  ContextLogNotFoundError,
} from "../context-log/errors.js";
import { assertContextJson } from "../context-log/json.js";
import { resolveContextProducers, runContextProducers } from "../context-log/producers.js";
import {
  buildProjectionContract,
  createMessageProjectionAdapter,
  projectionContractMismatches,
} from "../context-log/projection.js";
import {
  type ContextEntry,
  type ContextEntryInput,
  type ContextHead,
  type ContextLogCursor,
  type ContextLogOptions,
  type ContextLogStore,
  type ContextModelRef,
  type ContextStreamRef,
  type ContextTransition,
  DEFAULT_CONTEXT_BRANCH_ID,
  DEFAULT_CONTEXT_STREAM_ID,
  type ProjectionAdapter,
  type ToolResultContextEntryInput,
  type UserContextEntryInput,
} from "../context-log/types.js";
import { ConfigurationError, ValidationError } from "../errors/index.js";
import { resolveModelIdentity } from "../observability/execution-metadata.js";
import type { AgentOptions, GenerateOptions } from "../types.js";
import {
  appendScreenedOutputs,
  assertTerminalModel,
  createLogCallBoundary,
  type LogCallBoundary,
  type LogPreviousCall,
  type LogRunState,
  sha256Hex,
  toEntryInput,
} from "./log-boundary.js";
import {
  findUnresolvedInterrupts,
  INTERRUPT_PENDING_REASON,
  interruptEntryKeys,
  locateInterruptedCall,
} from "./log-interrupts.js";
import { resolveModelInputCapabilities } from "./model-capabilities.js";

/** Page size for reading a head's path. @internal */
const PATH_PAGE_SIZE = 500;

/**
 * Checkpoint metadata key holding a log-mode agent's {@link ContextLogCursor}.
 *
 * @internal
 */
export const CONTEXT_LOG_CURSOR_METADATA_KEY = "contextLog";

/**
 * Whether the options turn log mode on.
 *
 * @internal
 */
export function isLogModeEnabled(options: AgentOptions): boolean {
  return (options.contextLog?.mode ?? "off") !== "off";
}

/**
 * Reject agent options that log mode cannot honour yet, or at all.
 *
 * Runs at `createAgent` for every agent with `contextLog` set; returns
 * without checks when log mode is off, so legacy agents are unaffected.
 *
 * @internal
 */
export function validateLogModeOptions(options: AgentOptions): void {
  const contextLog = options.contextLog;
  if (!contextLog || !isLogModeEnabled(options)) {
    return;
  }
  if (contextLog.mode !== "log") {
    throw new ConfigurationError(
      `Unknown context log mode "${String(contextLog.mode)}"; use "log" or "off"`,
      { configKey: "contextLog.mode", actualValue: contextLog.mode },
    );
  }
  if (options.promptBuilder) {
    throw new ConfigurationError(
      "promptBuilder cannot be used in context log mode: the core system prompt is frozen per version. Use a static systemPrompt or contextLog.resolveCore, and append changing context as runtime context entries",
      { configKey: "promptBuilder" },
    );
  }
  if (options.systemPrompt !== undefined && contextLog.resolveCore) {
    throw new ConfigurationError(
      "Cannot specify both systemPrompt and contextLog.resolveCore - they are mutually exclusive",
      { configKey: "contextLog.resolveCore" },
    );
  }
  if (options.systemPrompt === undefined && !contextLog.resolveCore) {
    throw new ConfigurationError(
      "Context log mode needs a frozen core: set a static systemPrompt (it may be empty) or contextLog.resolveCore",
      { configKey: "systemPrompt" },
    );
  }
  if (options.contextManager) {
    throw new ConfigurationError(
      "contextManager is not supported in context log mode yet: compaction must be recorded as a transition in the log",
      { configKey: "contextManager" },
    );
  }
  assertTerminalModel(options.model, "model");
  assertTerminalModel(options.fallbackModel, "fallbackModel");
}

/**
 * Fresh run state for a log-mode run. Every attempt of the run shares it, so
 * the run's input keeps the same keys across retries.
 *
 * @internal
 */
export function createLogRunState(runId: string): LogRunState {
  return { id: `${runId}:${randomUUID()}`, ordinal: 0, attempt: 0 };
}

/**
 * The request a log-mode call will send, projected from one head snapshot.
 *
 * @internal
 */
export interface LogCallPlan {
  stream: ContextStreamRef;
  /** The head the plan was built from, or `null` when the stream has none. */
  head: ContextHead | null;
  /** The transition that creates the stream's first version, when it has no head. */
  transition: ContextTransition | undefined;
  /**
   * Entries to append after the head's path: the run's new user input not
   * yet committed, then producer output, both as the PreGenerate hooks left
   * them.
   */
  append: ContextEntryInput[];
  /** The projected request messages, including the core system message. */
  messages: ModelMessage[];
  /** The adapter that projected the messages. */
  projection: { adapter: string; version: string };
  /** The model the messages were projected for. */
  target: ContextModelRef;
  /** The version's frozen core, as projected. */
  core: string;
  /** The version's contract, as projected. */
  contract: Readonly<Record<string, string>>;
  /** Content of the head's path followed by `append`: what the adapter projected. */
  entries: ContextEntryInput[];
  /** Prefix for the keys of this call's output entries. */
  outputKeyPrefix: string;
  /** The call that last moved the head, or `undefined` on a new stream. */
  previousCall: LogPreviousCall | undefined;
  /** The run's shared state. */
  run: LogRunState;
  /** The delegation's claim on the stream, moved forward by each of the call's commits. */
  claim?: DelegationStreamClaim;
  /**
   * The call's options after the PreGenerate hooks, without `prompt` or
   * `messages` (the input is `append`).
   */
  options: GenerateOptions;
}

/**
 * Screens new, not-yet-committed entries through the log-mode PreGenerate
 * hooks (`invokeLogModePreGenerateHooks`): they may redact the entries,
 * change operational options or deny the call.
 *
 * @internal
 */
export type LogInputScreen = (
  options: GenerateOptions,
  pending: ContextEntryInput[],
) => Promise<{ options: GenerateOptions; pending: ContextEntryInput[] }>;

/**
 * Where a pending interrupt was recorded on a stream, read from one head
 * snapshot.
 *
 * @internal
 */
export interface LogInterruptSite {
  stream: ContextStreamRef;
  /** The head the site was read from, or last moved to by a resume commit. */
  head: ContextHead;
  /** The interrupted call, whose outputs the resume entries are committed as. */
  manifestId: string;
  /** The interrupted tool call, exactly as committed. */
  call: ToolCallPart;
  /** Keys of this round's resume entries. */
  keys: { resolution: string; result: string };
  /**
   * - `pending` - Nothing of the resume is committed yet
   * - `resolving` - The resolution is committed, the result is not: a resume
   *   may have started the tool
   * - `resolved` - The call's result is committed
   */
  state: "pending" | "resolving" | "resolved";
  /** This round's committed resolution, when there is one. */
  resolution?: { approved: boolean; reason?: string };
  /** The projected input of the step that made the call, as tools receive it. */
  messages: ModelMessage[];
}

/**
 * Log-mode runtime for one agent.
 *
 * @internal
 */
export interface LogContextRuntime {
  /**
   * Turn a run's caller options into PreGenerate input. Rejects caller
   * history and requires a `threadId`; the prompt becomes a user message in
   * `messages`, so PreGenerate hooks see (and may redact or deny) it.
   */
  prepareRunInput(genOptions: GenerateOptions): GenerateOptions;
  /**
   * Check the options PreGenerate hooks returned: the new input must still be
   * user messages only. A prompt a hook set is folded into `messages`.
   */
  acceptRunInput(effectiveOptions: GenerateOptions): GenerateOptions;
  /**
   * Read the head once and plan the call on that snapshot: run the producers,
   * screen the new input and producer output through `screen`, and project
   * the request.
   */
  plan(
    genOptions: GenerateOptions,
    model: LanguageModel,
    screen: LogInputScreen,
  ): Promise<LogCallPlan>;
  /**
   * Create the commit boundary for an attempt planned with `plan`, wrapping
   * the attempt's terminal provider model. `screen` screens each step's
   * outputs before they are committed.
   */
  createCall(plan: LogCallPlan, model: LanguageModel, screen: LogInputScreen): LogCallBoundary;
  /**
   * Read the stream's head once and find where `interrupt` was recorded on
   * its path. Fails when it is not on the path, or when the stream has moved
   * past the interrupted call while it is still unresolved.
   */
  readInterrupt(
    genOptions: GenerateOptions,
    interrupt: Interrupt,
    model: LanguageModel,
  ): Promise<LogInterruptSite>;
  /**
   * Commit resume entries as outputs of the interrupted call, after the
   * PreGenerate hooks screened them. Returns the site at the new head.
   */
  commitInterruptOutputs(
    site: LogInterruptSite,
    items: ToolResultContextEntryInput[],
    options: GenerateOptions,
    screen: LogInputScreen,
  ): Promise<LogInterruptSite>;
  /** The cursor of the head the thread's latest plan was built from. */
  cursor(threadId: string): ContextLogCursor | undefined;
}

/** Map a model to the reference recorded on versions and manifests. @internal */
function toContextModelRef(model: LanguageModel): ContextModelRef {
  const identity = resolveModelIdentity(model);
  return { provider: identity.provider ?? "unknown", modelId: identity.modelId ?? "unknown" };
}

/** Read every page of a head's path. @internal */
async function readFullPath(store: ContextLogStore, head: ContextHead): Promise<ContextEntry[]> {
  const path: ContextEntry[] = [];
  let after = 0;
  for (;;) {
    const page = await store.readPath(head, { after, limit: PATH_PAGE_SIZE });
    path.push(...page.entries);
    if (page.nextAfter === null) {
      break;
    }
    if (page.nextAfter <= after || page.entries.length === 0) {
      throw new ContextLogInvalidError(
        "invalid_page",
        `Context log store returned a page that does not advance past position ${after}`,
      );
    }
    after = page.nextAfter;
  }
  if (path.length !== head.entryCount) {
    throw new ContextLogInvalidError(
      "incomplete_path",
      `Context log store returned ${path.length} entries for a head with ${head.entryCount}`,
    );
  }
  return path;
}

/**
 * The call that last moved the head, for model-change declaration and
 * tool-snapshot attribution. Part of the call's one head snapshot.
 *
 * @internal
 */
async function readPreviousCall(
  store: ContextLogStore,
  head: ContextHead,
): Promise<LogPreviousCall> {
  const manifest = await store.readManifest(head.lastManifestId);
  return {
    manifestId: manifest.id,
    model: manifest.model,
    toolSnapshotDigest:
      manifest.toolSnapshot === undefined ? undefined : sha256Hex(manifest.toolSnapshot),
  };
}

/** The new user input of a run, after PreGenerate. @internal */
function newUserMessages(genOptions: GenerateOptions): UserModelMessage[] {
  const messages = genOptions.messages ?? [];
  messages.forEach((message, index) => {
    if (message.role !== "user") {
      throw new ValidationError(
        `Context log mode only accepts new user input; message ${index} has role "${message.role}"`,
        { fieldErrors: { messages: ["only user messages are accepted in context log mode"] } },
      );
    }
    assertContextJson(message, `messages[${index}]`);
  });
  return messages as UserModelMessage[];
}

/** The approval response a resolution entry recorded. @internal */
function readResolution(
  entry: ContextEntryInput | undefined,
): { approved: boolean; reason?: string } | undefined {
  if (entry?.kind !== "tool_result") return undefined;
  const part = entry.message.content.find((item) => item.type === "tool-approval-response");
  if (part?.type !== "tool-approval-response") return undefined;
  return { approved: part.approved, ...(part.reason !== undefined && { reason: part.reason }) };
}

/** Turn a head into a checkpoint cursor. @internal */
function toCursor(stream: ContextStreamRef, head: ContextHead | null): ContextLogCursor {
  return {
    branchId: stream.branchId,
    streamId: stream.streamId,
    versionId: head?.versionId ?? null,
    entryCount: head?.entryCount ?? 0,
    revision: head?.revision ?? 0,
    pathDigest: head?.pathDigest ?? null,
  };
}

/**
 * Create the log-mode runtime for an agent whose options enable log mode.
 *
 * @internal
 */
export function createLogContextRuntime(
  options: AgentOptions & { contextLog: ContextLogOptions },
): LogContextRuntime {
  const { store, resolveCore, admit } = options.contextLog;
  const adapter: ProjectionAdapter =
    options.contextLog.projection ?? createMessageProjectionAdapter();
  // The agent's producers, then each plugin's; names must be unique.
  const producers = resolveContextProducers(options.contextLog.producers, options.plugins);
  const cursors = new Map<string, ContextLogCursor>();

  function prepareRunInput(genOptions: GenerateOptions): GenerateOptions {
    if (!genOptions.threadId) {
      throw new ValidationError("Context log mode needs a threadId to identify the log stream", {
        fieldErrors: { threadId: ["required in context log mode"] },
      });
    }
    if (genOptions.messages && genOptions.messages.length > 0) {
      throw new ValidationError(
        "Context log mode does not accept caller-supplied messages: the log is the history. Pass new user input as prompt",
        { fieldErrors: { messages: ["not accepted in context log mode"] } },
      );
    }
    if (genOptions._historyUnlessCheckpointed && genOptions._historyUnlessCheckpointed.length > 0) {
      throw new ValidationError(
        "Context log mode does not accept caller-supplied history: the log is the history",
        { fieldErrors: { messages: ["not accepted in context log mode"] } },
      );
    }
    const {
      prompt,
      messages: _messages,
      _historyUnlessCheckpointed: _history,
      _checkpointSnapshot: _snapshot,
      _logRun: _previousRun,
      ...rest
    } = genOptions;
    return prompt ? { ...rest, messages: [{ role: "user", content: prompt }] } : rest;
  }

  function acceptRunInput(effectiveOptions: GenerateOptions): GenerateOptions {
    const { prompt, ...rest } = effectiveOptions;
    const messages: ModelMessage[] = [
      ...(rest.messages ?? []),
      ...(prompt ? [{ role: "user" as const, content: prompt }] : []),
    ];
    newUserMessages({ messages });
    return messages.length > 0 ? { ...rest, messages } : { ...rest, messages: undefined };
  }

  async function plan(
    genOptions: GenerateOptions,
    model: LanguageModel,
    screen: LogInputScreen,
  ): Promise<LogCallPlan> {
    const threadId = genOptions.threadId;
    if (!threadId) {
      throw new ValidationError("Context log mode needs a threadId to identify the log stream", {
        fieldErrors: { threadId: ["required in context log mode"] },
      });
    }
    const run = genOptions._logRun;
    if (!run) {
      throw new ContextLogInvalidError("missing_run_state", "A log-mode plan needs run state");
    }
    const input = newUserMessages(genOptions);
    const stream: ContextStreamRef = {
      threadId,
      branchId: genOptions.contextStream?.branchId ?? DEFAULT_CONTEXT_BRANCH_ID,
      streamId: genOptions.contextStream?.streamId ?? DEFAULT_CONTEXT_STREAM_ID,
    };
    const target = toContextModelRef(model);
    const expectedContract = buildProjectionContract(
      adapter,
      resolveModelInputCapabilities(options, model),
    );

    // One head read serves the version, the path and the cursor.
    const head = await store.readHead(stream);
    // A delegation only plans on the head it last left its stream at, so a
    // second delivery of the same delegation never appends to the stream.
    const claim = genOptions._contextClaim;
    if (claim && (head?.revision ?? 0) !== claim.revision) {
      throw new ContextLogConflictError("delegation_claim_lost", {
        head,
        message: `Delegation stream "${stream.streamId}" moved to revision ${head?.revision ?? 0} outside this delegation (expected ${claim.revision}); it is not planned again`,
      });
    }

    let core: string;
    let contract: Readonly<Record<string, string>>;
    let transition: ContextTransition | undefined;
    let path: ContextEntry[] = [];
    let previousCall: LogPreviousCall | undefined;
    if (head) {
      const version = await store.readVersion(head.versionId);
      const mismatched = projectionContractMismatches(version.contract, expectedContract);
      if (mismatched.some((key) => key === "adapter" || key === "adapterVersion")) {
        throw new ContextLogConflictError("transition_required", {
          head,
          message: `The head's version was created under a different projection adapter (${mismatched.join(", ")}); projecting it with this adapter needs a declared adapter_change transition`,
        });
      }
      core = version.core;
      contract = version.contract;
      previousCall = await readPreviousCall(store, head);
      // The call goes to another model than the stream's previous call (a
      // fallback, or a host switching models), or to one that accepts
      // different input than the version was projected for. Either is the
      // declared cause of a model_change version, which inherits the whole
      // path under the same frozen core. Same-capability route changes are
      // declared too: a target-sensitive adapter may render differently.
      const modelChanged =
        previousCall !== undefined &&
        (previousCall.model.provider !== target.provider ||
          previousCall.model.modelId !== target.modelId);
      if (mismatched.length > 0 || modelChanged) {
        contract = { ...expectedContract };
        transition = {
          reason: "model_change",
          parent: { versionId: head.versionId, inheritedCount: head.entryCount },
          core,
          contract: { ...expectedContract },
        };
      }
      path = await readFullPath(store, head);
      // A tool call waiting on an interrupt has no result yet, so no request
      // can be projected from this path until the interrupt is resumed.
      const unresolved = findUnresolvedInterrupts(path);
      if (unresolved.length > 0) {
        throw new ContextLogConflictError(INTERRUPT_PENDING_REASON, {
          head,
          message: `The stream has an unresolved interrupt (${unresolved
            .map((pending) => pending.approvalId)
            .join(
              ", ",
            )}); resume it with resume() or resumeDataResponse() before generating on this stream`,
        });
      }
    } else {
      core = resolveCore
        ? await resolveCore({ stream, reason: "initial", parent: null })
        : (options.systemPrompt ?? "");
      contract = expectedContract;
      transition = { reason: "initial", parent: null, core, contract: { ...expectedContract } };
    }

    // The run's input keeps its keys across retries, so a retry finds the
    // input an earlier attempt committed instead of appending it again.
    const onPath = new Set(path.map((entry) => entry.key));
    const userEntries: UserContextEntryInput[] = input
      .map((message, index) => ({ kind: "user" as const, key: `user:${run.id}:${index}`, message }))
      .filter((entry) => !onPath.has(entry.key));
    // Producers run against this same head and path; entries already on the
    // path are dropped. Then the new input and producer output pass the
    // PreGenerate hooks (redaction, guardrails) before anything is committed
    // or projected, and prepare commits them against this head's revision.
    const produced = await runContextProducers({
      producers,
      stream,
      head,
      path,
      ...(genOptions.signal ? { signal: genOptions.signal } : {}),
    });
    const screened = await screen(genOptions, [...userEntries, ...produced]);
    const append = screened.pending;

    const entries: ContextEntryInput[] = [...path.map(toEntryInput), ...append];
    const messages = await project(core, contract, entries, target);

    cursors.set(threadId, toCursor(stream, head));
    return {
      stream,
      head,
      transition,
      append,
      messages,
      projection: { adapter: adapter.id, version: adapter.version },
      target,
      core,
      contract,
      entries,
      // Unique among attempts that commit outputs: each commits them only
      // after its own prepare moved the head past this revision.
      outputKeyPrefix: `output:${run.id}:${head?.revision ?? 0}`,
      previousCall,
      run,
      ...(claim && { claim }),
      options: screened.options,
    };
  }

  async function project(
    core: string,
    contract: Readonly<Record<string, string>>,
    entries: readonly ContextEntryInput[],
    target: ContextModelRef,
  ): Promise<ModelMessage[]> {
    const projected = await adapter.project({ core, contract, entries, target });
    if (!Array.isArray(projected?.messages)) {
      throw new ContextLogInvalidError(
        "invalid_projection",
        `Projection adapter "${adapter.id}" did not return a messages array`,
      );
    }
    return projected.messages;
  }

  function createCall(
    plan: LogCallPlan,
    model: LanguageModel,
    screen: LogInputScreen,
  ): LogCallBoundary {
    return createLogCallBoundary({
      store,
      admit,
      plan,
      model,
      project: (entries) => project(plan.core, plan.contract, entries, plan.target),
      onHead: (head) => {
        cursors.set(plan.stream.threadId, toCursor(plan.stream, head));
        if (plan.claim) {
          plan.claim.revision = head.revision;
        }
      },
      // Only the screened entries are used: the generation's options are
      // fixed once it started, so operational changes here are ignored.
      screenOutputs: async (items) => (await screen(plan.options, [...items])).pending,
    });
  }

  async function readInterrupt(
    genOptions: GenerateOptions,
    interrupt: Interrupt,
    model: LanguageModel,
  ): Promise<LogInterruptSite> {
    const threadId = genOptions.threadId;
    if (!threadId) {
      throw new ValidationError("Context log mode needs a threadId to identify the log stream", {
        fieldErrors: { threadId: ["required in context log mode"] },
      });
    }
    const stream: ContextStreamRef = {
      threadId,
      branchId: genOptions.contextStream?.branchId ?? DEFAULT_CONTEXT_BRANCH_ID,
      streamId: genOptions.contextStream?.streamId ?? DEFAULT_CONTEXT_STREAM_ID,
    };
    // One head read serves the location, the resume state and the tool's input.
    const head = await store.readHead(stream);
    const path = head ? await readFullPath(store, head) : [];
    const location = interrupt.toolCallId
      ? locateInterruptedCall(path, { id: interrupt.id, toolCallId: interrupt.toolCallId })
      : undefined;
    if (!head || !location) {
      throw new ContextLogNotFoundError("interrupt", interrupt.id);
    }
    const keys = interruptEntryKeys(interrupt);
    const onPath = new Set(path.map((entry) => entry.key));
    const state = location.resolved
      ? "resolved"
      : onPath.has(keys.resolution)
        ? "resolving"
        : "pending";
    const manifestId = path[location.index]!.manifestId;
    if (state !== "resolved" && head.lastManifestId !== manifestId) {
      throw new ContextLogConflictError("head_moved", {
        head,
        message: `The stream moved past the call that raised interrupt ${interrupt.id}; it can no longer be resumed`,
      });
    }
    const version = await store.readVersion(head.versionId);
    const messages = await project(
      version.core,
      version.contract,
      path.slice(0, location.index).map(toEntryInput),
      toContextModelRef(model),
    );
    cursors.set(threadId, toCursor(stream, head));
    const resolution = readResolution(path.find((entry) => entry.key === keys.resolution));
    return {
      stream,
      head,
      manifestId,
      call: location.call,
      keys,
      state,
      ...(resolution && { resolution }),
      messages,
    };
  }

  async function commitInterruptOutputs(
    site: LogInterruptSite,
    items: ToolResultContextEntryInput[],
    screenOptions: GenerateOptions,
    screen: LogInputScreen,
  ): Promise<LogInterruptSite> {
    const committed = await appendScreenedOutputs({
      store,
      manifestId: site.manifestId,
      head: site.head,
      items,
      screenOutputs: async (outputs) => (await screen(screenOptions, [...outputs])).pending,
    });
    cursors.set(site.stream.threadId, toCursor(site.stream, committed.head));
    const keys = new Set(committed.entries.map((entry) => entry.key));
    const resolution = readResolution(
      committed.entries.find((entry) => entry.key === site.keys.resolution),
    );
    return {
      ...site,
      ...(resolution && { resolution }),
      head: committed.head,
      state: keys.has(site.keys.result)
        ? "resolved"
        : keys.has(site.keys.resolution)
          ? "resolving"
          : site.state,
    };
  }

  return {
    prepareRunInput,
    acceptRunInput,
    plan,
    createCall,
    readInterrupt,
    commitInterruptOutputs,
    cursor: (threadId) => cursors.get(threadId),
  };
}
