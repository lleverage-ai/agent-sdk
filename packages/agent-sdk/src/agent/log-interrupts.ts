/**
 * How interrupts and their resolutions are recorded in a context log.
 *
 * A log-mode interrupt never adds anything a provider would see:
 *
 * ```
 *   interrupt   assistant entry: the model's tool call, plus a
 *               `tool-approval-request` part { approvalId: interrupt.id }
 *               (the call's placeholder result is not committed)
 *   resume      tool_result entry `interrupt:<id>:<createdAt>:resolution`:
 *               a `tool-approval-response` part, committed before the tool runs
 *               tool_result entry `interrupt:<id>:<createdAt>:result`:
 *               the call's result, as the tool pipeline returned it
 * ```
 *
 * In both keys `<id>` is the interrupt id's key segment
 * (`interruptEntryKeySegment`), digested when the id is long or has
 * characters a host store cannot keep.
 *
 * The AI SDK drops approval parts that are not provider-executed before a
 * request reaches the provider, and merges adjacent tool messages, so the
 * resumed stream projects to the same provider input as a run that was
 * never interrupted. Both resume entries are outputs of the interrupted call
 * (`appendOutputs` on its manifest), so they pass the same screening as any
 * other output.
 *
 * A call with an approval request and no result is unresolved: no request
 * can be projected from the path until it is resumed. A resolution without
 * a result means a resume may have started the tool and stopped before its
 * result was committed.
 *
 * @packageDocumentation
 * @internal
 */

import type { ToolCallPart } from "ai";
import type { Interrupt } from "../checkpointer/types.js";
import { interruptEntryKeys } from "../context-log/interrupt-keys.js";
import type { ContextEntryInput } from "../context-log/types.js";

/**
 * Conflict reason for a call planned on a stream whose path has an
 * unresolved interrupt.
 *
 * @internal
 */
export const INTERRUPT_PENDING_REASON = "interrupt_pending";

/**
 * Conflict reason for a resume that may already have started the
 * interrupted tool without committing its result.
 *
 * @internal
 */
export const RESUME_IN_DOUBT_REASON = "resume_in_doubt";

/** An approval request on a path whose tool call has no result. @internal */
export interface UnresolvedInterrupt {
  approvalId: string;
  toolCallId: string;
}

/** Content parts of an entry's message, or none for runtime context and string content. */
function partsOf(entry: ContextEntryInput): ReadonlyArray<{ type: string }> {
  if (entry.kind === "runtime_context" || typeof entry.message.content === "string") {
    return [];
  }
  return entry.message.content as ReadonlyArray<{ type: string }>;
}

/**
 * Approval requests on a path whose tool call has no committed result, in
 * path order.
 *
 * @internal
 */
export function findUnresolvedInterrupts(
  entries: readonly ContextEntryInput[],
): UnresolvedInterrupt[] {
  const requests: UnresolvedInterrupt[] = [];
  const results = new Set<string>();
  for (const entry of entries) {
    for (const part of partsOf(entry)) {
      if (entry.kind === "assistant" && part.type === "tool-approval-request") {
        const { approvalId, toolCallId } = part as unknown as UnresolvedInterrupt;
        requests.push({ approvalId, toolCallId });
      } else if (entry.kind === "tool_result" && part.type === "tool-result") {
        results.add((part as unknown as { toolCallId: string }).toolCallId);
      }
    }
  }
  return requests.filter((request) => !results.has(request.toolCallId));
}

/**
 * Keys of the round of `interrupt` whose entries are on a path. A round
 * keeps the keys it started with: before LLE-16135 the SDK keyed every
 * round by the raw interrupt id, so when the path already holds this
 * round's resolution under the raw id (an older SDK committed it, then
 * stopped before the result), the round continues under those keys. Its
 * committed answer is then read, an in-doubt resume is still refused, and
 * the result lands beside its resolution. Any other round uses
 * {@link interruptEntryKeys}.
 *
 * @internal
 */
export function interruptRoundKeys(
  interrupt: Pick<Interrupt, "id" | "createdAt">,
  onPath: ReadonlySet<string>,
): { resolution: string; result: string } {
  const keys = interruptEntryKeys(interrupt);
  if (onPath.has(keys.resolution)) return keys;
  const base = `interrupt:${interrupt.id}:${interrupt.createdAt}`;
  const legacy = { resolution: `${base}:resolution`, result: `${base}:result` };
  return onPath.has(legacy.resolution) ? legacy : keys;
}

/**
 * Where an interrupted tool call sits on a path.
 *
 * @internal
 */
export interface InterruptedCallLocation {
  /** Index of the assistant entry that made the call. */
  index: number;
  /** The tool call, exactly as committed. */
  call: ToolCallPart;
  /** Whether a result for the call is on the path. */
  resolved: boolean;
}

/**
 * Finds the tool call an interrupt was recorded on: the assistant entry
 * whose approval request carries the interrupt's id, and its call.
 *
 * @internal
 */
export function locateInterruptedCall(
  entries: readonly ContextEntryInput[],
  interrupt: Pick<Interrupt, "id" | "toolCallId">,
): InterruptedCallLocation | undefined {
  let found: { index: number; call: ToolCallPart } | undefined;
  let resolved = false;
  entries.forEach((entry, index) => {
    const parts = partsOf(entry);
    if (entry.kind === "assistant" && !found) {
      const requested = parts.some(
        (part) =>
          part.type === "tool-approval-request" &&
          (part as unknown as UnresolvedInterrupt).approvalId === interrupt.id &&
          (part as unknown as UnresolvedInterrupt).toolCallId === interrupt.toolCallId,
      );
      const call = parts.find(
        (part): part is ToolCallPart =>
          part.type === "tool-call" &&
          (part as unknown as ToolCallPart).toolCallId === interrupt.toolCallId,
      );
      if (requested && call) found = { index, call };
    } else if (found && entry.kind === "tool_result") {
      resolved ||= parts.some(
        (part) =>
          part.type === "tool-result" &&
          (part as unknown as { toolCallId: string }).toolCallId === interrupt.toolCallId,
      );
    }
  });
  return found && { ...found, resolved };
}
