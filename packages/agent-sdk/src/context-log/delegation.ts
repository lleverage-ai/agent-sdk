/**
 * Child streams for delegated subagents in log mode.
 *
 * In log mode a delegated subagent runs on its own stream of the parent's
 * thread, in the parent's store. The stream is derived from the parent's
 * stream and the originating tool call, so recreating the same delegation
 * (for example when a host re-executes a tool call after a crash) finds the
 * same stream. What the stream holds then decides what happens:
 *
 * - no head: the delegation starts;
 * - a final reply: the delegation finished, and its reply is the result;
 * - anything else: the child stopped mid-task. Its tools may have run, so the
 *   task is never replayed and the delegation fails with
 *   {@link DelegationRecoveryRequiredError}.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import type { AssistantModelMessage } from "ai";
import { ContextLogInvalidError } from "./errors.js";
import type { ContextHead, ContextLogStore, ContextStreamRef } from "./types.js";

/**
 * Input of a {@link SubagentStreamResolver}.
 *
 * @experimental
 * @category Context Log
 */
export interface SubagentStreamInput {
  /** The stream of the parent call that delegated. */
  parent: ContextStreamRef;
  /** The parent's tool call that started the delegation. */
  toolCallId: string;
  /** The subagent type the parent delegated to. */
  subagentType: string;
}

/**
 * Chooses the branch and stream of a delegated subagent. The child stream
 * always belongs to the parent's thread. It must be deterministic: the same
 * input must always resolve to the same stream, and different delegations
 * to different streams.
 *
 * @experimental
 * @category Context Log
 */
export type SubagentStreamResolver = (input: SubagentStreamInput) => {
  branchId: string;
  streamId: string;
};

/**
 * The default child stream of a delegation: the parent's branch, and the
 * stream `<parent stream>/subagent/<type>-<digest>`, where the type is
 * percent-encoded (`encodeURIComponent`) and the digest is the first 32 hex
 * characters of the SHA-256 of the tool call id.
 *
 * @param input - The parent stream, tool call and subagent type
 * @returns The child stream
 *
 * @example
 * ```typescript
 * deriveSubagentContextStream({
 *   parent: { threadId: "t1", branchId: "main", streamId: "main" },
 *   toolCallId: "call_1",
 *   subagentType: "researcher",
 * });
 * // { threadId: "t1", branchId: "main", streamId: "main/subagent/researcher-<digest>" }
 * ```
 *
 * @experimental
 * @category Context Log
 */
export function deriveSubagentContextStream(input: SubagentStreamInput): ContextStreamRef {
  const digest = createHash("sha256").update(input.toolCallId, "utf8").digest("hex").slice(0, 32);
  // The type is percent-encoded, so the last segment never contains "/" and
  // the parent stream, type and digest are recoverable from the id: distinct
  // delegations never share a stream.
  return {
    threadId: input.parent.threadId,
    branchId: input.parent.branchId,
    streamId: `${input.parent.streamId}/subagent/${encodeURIComponent(input.subagentType)}-${digest}`,
  };
}

/**
 * Resolve a delegation's child stream with the host's resolver, or the
 * default one, and check it is a stream of its own on the parent's thread.
 *
 * @internal
 */
export function resolveSubagentContextStream(
  input: SubagentStreamInput,
  resolver: SubagentStreamResolver | undefined,
): ContextStreamRef {
  if (!resolver) {
    return deriveSubagentContextStream(input);
  }
  const resolved = resolver(input);
  if (
    typeof resolved?.branchId !== "string" ||
    typeof resolved.streamId !== "string" ||
    resolved.branchId.length === 0 ||
    resolved.streamId.length === 0
  ) {
    throw new ContextLogInvalidError(
      "invalid_subagent_stream",
      "contextLog.subagentStream must return a non-empty branchId and streamId",
    );
  }
  if (resolved.branchId === input.parent.branchId && resolved.streamId === input.parent.streamId) {
    throw new ContextLogInvalidError(
      "invalid_subagent_stream",
      "contextLog.subagentStream returned the parent's own stream; a subagent needs a stream of its own",
    );
  }
  return {
    threadId: input.parent.threadId,
    branchId: resolved.branchId,
    streamId: resolved.streamId,
  };
}

/**
 * What a delegation's child stream holds.
 *
 * - `absent` - The stream has no head: the delegation has not started
 * - `completed` - The child's last call completed with a final reply (an
 *   assistant message without tool calls); `text` is the reply's text
 * - `unfinished` - The stream has a head but no final reply, for example
 *   after a crash mid-task, a failed call, or a run stopped on a tool call
 *
 * @experimental
 * @category Context Log
 */
export type SubagentDelegationState =
  | { status: "absent" }
  | { status: "completed"; head: ContextHead; text: string }
  | { status: "unfinished"; head: ContextHead };

/** The text parts of an assistant reply, or `undefined` if it calls tools. @internal */
function finalReplyText(message: AssistantModelMessage): string | undefined {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (message.content.some((part) => part.type === "tool-call")) {
    return undefined;
  }
  return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/**
 * Read what a delegation's child stream holds, from one head snapshot.
 *
 * The delegation completed when the head's last call committed a final
 * reply: the path's last entry is an assistant message without tool calls,
 * appended by that call's output commit, and the call's outcome is
 * `completed` (or not yet recorded, because the outputs are already
 * durable). Anything else on an existing head is `unfinished`.
 *
 * @param store - The store the child stream lives in
 * @param stream - The child stream
 * @returns The delegation's state
 *
 * @experimental
 * @category Context Log
 */
export async function readSubagentDelegation(
  store: ContextLogStore,
  stream: ContextStreamRef,
): Promise<SubagentDelegationState> {
  const head = await store.readHead(stream);
  if (!head) {
    return { status: "absent" };
  }
  if (head.entryCount === 0) {
    return { status: "unfinished", head };
  }
  const manifest = await store.readManifest(head.lastManifestId);
  const outcome = manifest.outcome?.status;
  const outputsCommitted =
    manifest.versionId === head.versionId && head.entryCount > manifest.entryCount;
  if (!outputsCommitted || (outcome !== undefined && outcome !== "completed")) {
    return { status: "unfinished", head };
  }
  const page = await store.readPath(head, { after: head.entryCount - 1, limit: 1 });
  const last = page.entries[0];
  if (
    !last ||
    last.position !== head.entryCount ||
    last.kind !== "assistant" ||
    last.manifestId !== head.lastManifestId
  ) {
    return { status: "unfinished", head };
  }
  const text = finalReplyText(last.message);
  return text === undefined ? { status: "unfinished", head } : { status: "completed", head, text };
}

/**
 * The log-mode scope of a parent call that its tools can delegate from: the
 * parent's store and the stream the call runs on. Injected into tool
 * execution options under `experimental_context.agentSdk.contextLog`.
 *
 * @internal
 */
export interface DelegationScope {
  store: ContextLogStore;
  stream: ContextStreamRef;
  subagentStream?: SubagentStreamResolver;
}

/**
 * Read the parent call's {@link DelegationScope} from a tool's execution
 * options, or `undefined` outside log mode.
 *
 * @internal
 */
export function readDelegationScope(toolOptions: unknown): DelegationScope | undefined {
  const context = (toolOptions as { experimental_context?: unknown } | undefined)
    ?.experimental_context as { agentSdk?: { contextLog?: DelegationScope } } | undefined;
  const scope = context?.agentSdk?.contextLog;
  return scope && typeof scope === "object" && scope.store && scope.stream ? scope : undefined;
}

/**
 * A delegation's claim on its child stream: the head revision the delegation
 * last left the stream at, `0` before its first write. Every log-mode call
 * that carries the claim refuses to plan on any other head (a conflict with
 * reason `delegation_claim_lost`), and each of its own commits moves the
 * claim forward. A second delivery of the same delegation therefore cannot
 * append the task again after the first one started.
 *
 * @internal
 */
export class DelegationStreamClaim {
  revision = 0;
}
