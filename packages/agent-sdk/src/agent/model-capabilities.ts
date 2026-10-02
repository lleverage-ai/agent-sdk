/**
 * Model-capability projection.
 *
 * Replaces tool-result media that the active model cannot accept with text
 * placeholders. Legacy mode applies it per attempt at the AI SDK call site,
 * because it depends on which model the retry loop selected. Log mode applies
 * it inside the projection adapter, keyed by the version's contract, so the
 * projected input is deterministic for a path.
 *
 * @packageDocumentation
 * @internal
 */

import type { ModelMessage } from "ai";
import type { AgentOptions, ModelInputCapabilities } from "../types.js";

type ToolContentOutputPart =
  | { type: "text"; text: string; [key: string]: unknown }
  | { type: "media"; data: string; mediaType: string; [key: string]: unknown }
  | { type: "image-data"; data: string; mediaType: string; [key: string]: unknown }
  | { type: "image-url"; url: string; [key: string]: unknown }
  | { type: "image-file-id"; fileId: string | Record<string, string>; [key: string]: unknown }
  | {
      type: "file-data";
      data: string;
      mediaType: string;
      filename?: string;
      [key: string]: unknown;
    }
  | { type: "file-url"; url: string; [key: string]: unknown }
  | { type: "file-id"; fileId: string | Record<string, string>; [key: string]: unknown }
  | { type: "custom"; [key: string]: unknown }
  | { type: string; [key: string]: unknown };

type ToolContentOutput = {
  type: "content";
  value: ToolContentOutputPart[];
  [key: string]: unknown;
};

/** @internal */
function isToolContentOutput(output: unknown): output is ToolContentOutput {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { type?: unknown }).type === "content" &&
    Array.isArray((output as { value?: unknown }).value)
  );
}

/** @internal */
export function resolveModelInputCapabilities(
  options: AgentOptions,
  model: AgentOptions["model"],
): ModelInputCapabilities | undefined {
  const resolver = options.modelCapabilities;

  if (!resolver) {
    return undefined;
  }

  return typeof resolver === "function" ? resolver(model) : resolver;
}

/** @internal */
function downgradeToolContentOutput(
  output: unknown,
  capabilities: ModelInputCapabilities | undefined,
): unknown {
  if (
    typeof output === "object" &&
    output !== null &&
    (output as { type?: unknown }).type === "json" &&
    "value" in output
  ) {
    return {
      ...output,
      value: downgradeToolContentOutput((output as { value: unknown }).value, capabilities),
    };
  }

  if (!isToolContentOutput(output)) {
    return output;
  }

  const value: ToolContentOutputPart[] = [];

  for (const part of output.value) {
    switch (part.type) {
      case "text":
        value.push(part);
        break;
      case "image-data":
      case "image-url":
      case "image-file-id":
      case "media":
        value.push(
          capabilities?.imageInput === false
            ? {
                type: "text",
                text: "[Image omitted: active model does not support image input.]",
              }
            : part,
        );
        break;
      case "file-data":
      case "file-url":
      case "file-id":
        value.push(
          capabilities?.fileInput === false
            ? {
                type: "text",
                text: "[File omitted: active model does not support file input.]",
              }
            : part,
        );
        break;
      case "custom":
        value.push(part);
        break;
      default:
        value.push(part);
        break;
    }
  }

  return { ...output, value };
}

/**
 * Replace tool-result media the active model cannot accept with text
 * placeholders. Returns the input array untouched when nothing needs
 * downgrading.
 *
 * @internal
 */
export function projectMessagesForModel(
  messages: ModelMessage[],
  capabilities: ModelInputCapabilities | undefined,
): ModelMessage[] {
  if (capabilities?.imageInput !== false && capabilities?.fileInput !== false) {
    return messages;
  }

  return messages.map((message) => {
    if (message.role !== "tool" || !Array.isArray(message.content)) {
      return message;
    }

    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-result") {
          return part;
        }

        const output = "output" in part ? part.output : undefined;
        const result = "result" in part ? (part as { result?: unknown }).result : undefined;

        return {
          ...part,
          ...("output" in part ? { output: downgradeToolContentOutput(output, capabilities) } : {}),
          ...("result" in part ? { result: downgradeToolContentOutput(result, capabilities) } : {}),
        };
      }),
    };
  }) as ModelMessage[];
}

/** Placeholder for an image the active model cannot accept. @internal */
const IMAGE_OMITTED = "[Image omitted: active model does not support image input.]";
/** Placeholder for a file the active model cannot accept. @internal */
const FILE_OMITTED = "[File omitted: active model does not support file input.]";

/**
 * Replace user image and file parts the capabilities exclude with text
 * placeholders. A file part whose media type is an image counts as image
 * input. Only log mode applies this, keyed by a version's contract; legacy
 * mode sends user parts as given. Returns the input array untouched when
 * nothing needs downgrading.
 *
 * @internal
 */
export function projectUserMediaForModel(
  messages: ModelMessage[],
  capabilities: ModelInputCapabilities | undefined,
): ModelMessage[] {
  if (capabilities?.imageInput !== false && capabilities?.fileInput !== false) {
    return messages;
  }

  return messages.map((message) => {
    if (message.role !== "user" || !Array.isArray(message.content)) {
      return message;
    }
    let changed = false;
    const content = message.content.map((part) => {
      if (part.type !== "image" && part.type !== "file") return part;
      const image =
        part.type === "image" ||
        (typeof part.mediaType === "string" && part.mediaType.toLowerCase().startsWith("image/"));
      const omitted = image
        ? capabilities?.imageInput === false
        : capabilities?.fileInput === false;
      if (!omitted) return part;
      changed = true;
      return { type: "text" as const, text: image ? IMAGE_OMITTED : FILE_OMITTED };
    });
    return changed ? { ...message, content } : message;
  });
}
