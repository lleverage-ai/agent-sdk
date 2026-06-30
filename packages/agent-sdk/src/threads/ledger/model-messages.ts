/**
 * Conversion from canonical transcript messages to AI SDK `ModelMessage`s.
 *
 * The ledger stores durable transcripts as {@link CanonicalMessage}s. To replay
 * a transcript back into a model call (e.g. when reconstructing a checkpoint),
 * those canonical messages must be projected into the AI SDK `ModelMessage`
 * shape. This module owns that projection.
 *
 * @module
 */

import type { JSONValue, ModelMessage } from "ai";
import type { CanonicalMessage, CanonicalPart } from "../../canonical.js";

type ModelContentPart = Extract<ModelMessage["content"], unknown[]>[number];

function toToolOutput(output: unknown, isError: boolean) {
  if (typeof output === "string") {
    return isError
      ? ({ type: "error-text", value: output } as const)
      : ({ type: "text", value: output } as const);
  }
  const value = (output ?? null) as JSONValue;
  return isError ? ({ type: "error-json", value } as const) : ({ type: "json", value } as const);
}

function toFileData(url: string): { type: "url"; url: URL } | { type: "text"; text: string } {
  try {
    return { type: "url", url: new URL(url) };
  } catch {
    // Not an absolute URL (e.g. a bare path) — fall back to inline text so the
    // reconstructed message stays structurally valid rather than throwing.
    return { type: "text", text: url };
  }
}

/**
 * Projects a single canonical part to an AI SDK model content part, or `null`
 * when the part has no model-message equivalent for the given role.
 */
function partToModelContent(part: CanonicalPart): ModelContentPart | null {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "reasoning":
      return { type: "reasoning", text: part.text };
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      };
    case "tool-result":
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: toToolOutput(part.output, part.isError),
      };
    case "file":
      return {
        type: "file",
        mediaType: part.mimeType,
        data: toFileData(part.url),
        ...(part.name ? { filename: part.name } : {}),
      };
    case "compaction-summary":
      // A compaction summary substitutes for a range of replaced messages;
      // render its text so the reconstructed transcript keeps that context.
      return { type: "text", text: part.text };
    default:
      return null;
  }
}

const ROLE_ALLOWED_PART_TYPES: Record<
  CanonicalMessage["role"],
  ReadonlySet<CanonicalPart["type"]>
> = {
  system: new Set(["text", "compaction-summary"]),
  user: new Set(["text", "file", "compaction-summary"]),
  assistant: new Set(["text", "reasoning", "tool-call", "file", "compaction-summary"]),
  tool: new Set(["tool-result"]),
};

/**
 * Converts canonical transcript messages into AI SDK `ModelMessage`s.
 *
 * Parts that are not valid for a message's role are dropped (for example, a
 * tool-call part on a user message). System messages are flattened to a single
 * text string, matching the AI SDK `SystemModelMessage` shape. Messages that
 * project to no content are omitted.
 *
 * @param messages - The canonical transcript messages to convert
 * @returns The equivalent AI SDK model messages
 *
 * @category Threads
 */
export function canonicalMessagesToModelMessages(
  messages: readonly CanonicalMessage[],
): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const message of messages) {
    const allowed = ROLE_ALLOWED_PART_TYPES[message.role];
    const parts = message.parts.filter((part) => allowed.has(part.type));

    if (message.role === "system") {
      const text = parts
        .map((part) =>
          part.type === "text" || part.type === "compaction-summary" ? part.text : "",
        )
        .filter(Boolean)
        .join("\n\n");
      if (text) {
        result.push({ role: "system", content: text });
      }
      continue;
    }

    const content = parts
      .map(partToModelContent)
      .filter((part): part is ModelContentPart => part !== null);

    if (content.length === 0) {
      continue;
    }

    // The content union is role-specific; the per-role part filtering above
    // guarantees only valid parts reach each role, so the cast is sound.
    result.push({ role: message.role, content } as ModelMessage);
  }

  return result;
}
