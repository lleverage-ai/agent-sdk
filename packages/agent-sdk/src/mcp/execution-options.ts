import type { ToolExecutionOptions } from "ai";
import type { ExtendedToolExecutionOptions, StreamingContext } from "../types.js";

export type ProxyToolCallOptions = Omit<
  Partial<ExtendedToolExecutionOptions>,
  "streamingContext"
> & {
  streamingContext?: StreamingContext | null;
};

export type NormalizedInlineToolExecutionOptions = Omit<
  ProxyToolCallOptions,
  "streamingContext" | "toolCallId" | "messages" | "abortSignal"
> &
  Pick<ToolExecutionOptions<unknown>, "toolCallId" | "messages" | "abortSignal" | "context"> & {
    streamingContext?: StreamingContext;
  };

export function createInlineToolExecutionOptions(
  options: ProxyToolCallOptions = {},
): NormalizedInlineToolExecutionOptions {
  const { streamingContext, ...toolExecutionOptions } = options;

  return {
    ...toolExecutionOptions,
    // Deferred tools reached through call_tool see the same request context
    // that directly registered tools receive from the streaming-context layer.
    ...(streamingContext ? { streamingContext } : {}),
    toolCallId: toolExecutionOptions.toolCallId ?? `virtual-${Date.now()}`,
    messages: toolExecutionOptions.messages ?? [],
    abortSignal: toolExecutionOptions.abortSignal ?? new AbortController().signal,
    // AI SDK 7 requires `context` on tool execution options. Inline tools are
    // untyped, so we forward whatever was supplied (undefined when absent).
    context: toolExecutionOptions.context,
  };
}
