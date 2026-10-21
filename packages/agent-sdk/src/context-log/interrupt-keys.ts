/**
 * Entry keys of a resumed interrupt in log mode.
 *
 * Resuming an interrupt commits two `tool_result` entries keyed
 * `interrupt:<segment>:<createdAt>:resolution` and `…:result`. The segment
 * is the interrupt's id when that is already portable: short, and made only
 * of characters a host store can keep in an identifier. Anything else (for
 * example a Gemini tool call id carrying a base64 thought signature, often
 * thousands of characters with `+` and `=`) becomes a bounded segment of
 * the same shape as a subagent stream's: a readable prefix of the id plus a
 * SHA-256 digest of the whole id.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";

/**
 * The longest interrupt id {@link interruptEntryKeySegment} keeps unchanged.
 * Longer ids are digested.
 *
 * @experimental
 * @category Context Log
 */
export const INTERRUPT_KEY_SEGMENT_MAX_CHARS = 256;

/**
 * Characters an id kept unchanged may use: letters, digits and
 * `._:@/%!~*'()-`, the identifier characters host stores accept.
 */
const PORTABLE_SEGMENT = /^[A-Za-z0-9._:@/%!~*'()-]+$/;

/** Characters of a digested id's readable prefix. */
const PREFIX_CHARACTER = /[A-Za-z0-9._-]/;

/** The most characters of the id a digested segment starts with. */
const DIGESTED_PREFIX_MAX_CHARS = 64;

/**
 * The interrupt id's segment in its resume entry keys.
 *
 * An id of at most {@link INTERRUPT_KEY_SEGMENT_MAX_CHARS} characters, made
 * only of letters, digits and `._:@/%!~*'()-`, is returned unchanged, so
 * keys for ids like Anthropic's `toolu_…` or OpenAI's `call_…` are the same
 * as before. Any other id becomes `<prefix>~<digest>`: its leading letters,
 * digits, `.`, `_` and `-` (at most 64), then the first 32 hex characters of
 * the SHA-256 of the whole id. The result is deterministic, at most 97
 * characters for a digested id, and distinct ids get distinct segments
 * (barring a digest collision, or an id crafted to equal another's
 * digested form).
 *
 * A host that looks up a resume's entries itself must build keys with this
 * function (or {@link interruptEntryKeys}), never from the raw id.
 *
 * @param interruptId - The interrupt's id
 * @returns The id's key segment
 *
 * @example
 * ```typescript
 * interruptEntryKeySegment("int_toolu_01ABC"); // "int_toolu_01ABC"
 * interruptEntryKeySegment("int_call_1__thought__Eu+h/3=");
 * // "int_call_1__thought__Eu~<32 hex characters>"
 * ```
 *
 * @experimental
 * @category Context Log
 */
export function interruptEntryKeySegment(interruptId: string): string {
  if (interruptId.length <= INTERRUPT_KEY_SEGMENT_MAX_CHARS && PORTABLE_SEGMENT.test(interruptId)) {
    return interruptId;
  }
  let prefix = "";
  for (const character of interruptId) {
    if (prefix.length >= DIGESTED_PREFIX_MAX_CHARS || !PREFIX_CHARACTER.test(character)) break;
    prefix += character;
  }
  const digest = createHash("sha256").update(interruptId, "utf8").digest("hex").slice(0, 32);
  return `${prefix}~${digest}`;
}

/**
 * Keys of a resume's entries: `interrupt:<segment>:<createdAt>:resolution`
 * and `…:result`, where the segment is
 * {@link interruptEntryKeySegment | the id's key segment}. They include the
 * interrupt's creation time, so each round of a tool that interrupts again
 * during a resume has its own.
 *
 * @param interrupt - The interrupt's id and creation time
 * @returns The resolution and result entry keys
 *
 * @example
 * ```typescript
 * interruptEntryKeys({ id: "int_toolu_01ABC", createdAt: "2026-10-21T10:44:00.000Z" });
 * // {
 * //   resolution: "interrupt:int_toolu_01ABC:2026-10-21T10:44:00.000Z:resolution",
 * //   result: "interrupt:int_toolu_01ABC:2026-10-21T10:44:00.000Z:result",
 * // }
 * ```
 *
 * @experimental
 * @category Context Log
 */
export function interruptEntryKeys(interrupt: { id: string; createdAt: string }): {
  resolution: string;
  result: string;
} {
  const base = `interrupt:${interruptEntryKeySegment(interrupt.id)}:${interrupt.createdAt}`;
  return { resolution: `${base}:resolution`, result: `${base}:result` };
}
