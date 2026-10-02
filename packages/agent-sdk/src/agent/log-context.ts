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
 * - Media capability projection happens inside the adapter, keyed by the
 *   version's contract. A version whose contract does not match the current
 *   adapter and model is never projected; that needs a declared transition.
 *
 * Nothing here reads or writes `Checkpoint.messages`.
 *
 * @packageDocumentation
 * @internal
 */

import type { LanguageModel, ModelMessage, UserModelMessage } from "ai";
import { ContextLogConflictError, ContextLogInvalidError } from "../context-log/errors.js";
import { assertContextJson } from "../context-log/json.js";
import {
  buildProjectionContract,
  createMessageProjectionAdapter,
  projectionContractMismatches,
} from "../context-log/projection.js";
import {
  type ContextEntry,
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
  type UserContextEntryInput,
} from "../context-log/types.js";
import { ConfigurationError, ValidationError } from "../errors/index.js";
import { resolveModelIdentity } from "../observability/execution-metadata.js";
import type { AgentOptions, GenerateOptions } from "../types.js";
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
  if (contextLog.producers && contextLog.producers.length > 0) {
    throw new ConfigurationError(
      "contextLog.producers are not supported by this release's log-mode runtime yet",
      { configKey: "contextLog.producers" },
    );
  }
  if (contextLog.admit) {
    throw new ConfigurationError(
      "contextLog.admit is not supported by this release's log-mode runtime yet",
      { configKey: "contextLog.admit" },
    );
  }
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
  /** The new user input, as entries to append after the head's path. */
  append: UserContextEntryInput[];
  /** The projected request messages, including the core system message. */
  messages: ModelMessage[];
  /** The adapter that projected the messages. */
  projection: { adapter: string; version: string };
  /** The model the messages were projected for. */
  target: ContextModelRef;
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
  /** Read the head once and project the call's request. */
  plan(genOptions: GenerateOptions, model: LanguageModel): Promise<LogCallPlan>;
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
  const { store, resolveCore } = options.contextLog;
  const adapter: ProjectionAdapter =
    options.contextLog.projection ?? createMessageProjectionAdapter();
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

  async function plan(genOptions: GenerateOptions, model: LanguageModel): Promise<LogCallPlan> {
    const threadId = genOptions.threadId;
    if (!threadId) {
      throw new ValidationError("Context log mode needs a threadId to identify the log stream", {
        fieldErrors: { threadId: ["required in context log mode"] },
      });
    }
    const input = newUserMessages(genOptions);
    const stream: ContextStreamRef = {
      threadId,
      branchId: DEFAULT_CONTEXT_BRANCH_ID,
      streamId: DEFAULT_CONTEXT_STREAM_ID,
    };
    const target = toContextModelRef(model);
    const expectedContract = buildProjectionContract(
      adapter,
      resolveModelInputCapabilities(options, model),
    );

    // One head read serves the version, the path and the cursor.
    const head = await store.readHead(stream);

    let core: string;
    let contract: Readonly<Record<string, string>>;
    let transition: ContextTransition | undefined;
    let path: ContextEntry[] = [];
    if (head) {
      const version = await store.readVersion(head.versionId);
      const mismatched = projectionContractMismatches(version.contract, expectedContract);
      if (mismatched.length > 0) {
        throw new ContextLogConflictError("transition_required", {
          head,
          message: `The head's version was created under a different projection contract (${mismatched.join(", ")}); projecting it for this adapter and model needs a declared adapter_change or model_change transition`,
        });
      }
      core = version.core;
      contract = version.contract;
      path = await readFullPath(store, head);
    } else {
      core = resolveCore
        ? await resolveCore({ stream, reason: "initial", parent: null })
        : (options.systemPrompt ?? "");
      contract = expectedContract;
      transition = { reason: "initial", parent: null, core, contract: { ...expectedContract } };
    }

    // Entry keys must be unique per call, so never fall back to a constant.
    const runId = genOptions._runId;
    if (!runId) {
      throw new ContextLogInvalidError("missing_run_id", "A log-mode plan needs a run id");
    }
    const revision = head?.revision ?? 0;
    const append: UserContextEntryInput[] = input.map((message, index) => ({
      kind: "user",
      key: `user:${runId}:${revision}:${index}`,
      message,
    }));

    const projected = await adapter.project({
      core,
      contract,
      entries: [...path, ...append],
      target,
    });
    if (!Array.isArray(projected?.messages)) {
      throw new ContextLogInvalidError(
        "invalid_projection",
        `Projection adapter "${adapter.id}" did not return a messages array`,
      );
    }

    cursors.set(threadId, toCursor(stream, head));
    return {
      stream,
      head,
      transition,
      append,
      messages: projected.messages,
      projection: { adapter: adapter.id, version: adapter.version },
      target,
    };
  }

  return {
    prepareRunInput,
    acceptRunInput,
    plan,
    cursor: (threadId) => cursors.get(threadId),
  };
}
