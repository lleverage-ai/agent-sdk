import type { ToolExecutionOptions } from "ai";
import type { ExtendedToolExecutionOptions, StreamingContext } from "../types.js";

export type ProxyToolCallOptions = Partial<ExtendedToolExecutionOptions> & {
  streamingContext?: StreamingContext | null;
};

export type NormalizedInlineToolExecutionOptions = Omit<
  ProxyToolCallOptions,
  "streamingContext" | "toolCallId" | "messages" | "abortSignal"
> &
  Pick<ToolExecutionOptions, "toolCallId" | "messages" | "abortSignal">;

export function createInlineToolExecutionOptions(
  options: ProxyToolCallOptions = {},
): NormalizedInlineToolExecutionOptions {
  const { streamingContext: _streamingContext, ...toolExecutionOptions } = options;

  return {
    ...toolExecutionOptions,
    toolCallId: toolExecutionOptions.toolCallId ?? `virtual-${Date.now()}`,
    messages: toolExecutionOptions.messages ?? [],
    abortSignal: toolExecutionOptions.abortSignal ?? new AbortController().signal,
  };
}
