[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ToolExecutionOptions

# Interface: ToolExecutionOptions

Defined in: node\_modules/.bun/@ai-sdk+provider-utils@4.0.11+3c5d820c62823f0b/node\_modules/@ai-sdk/provider-utils/dist/index.d.ts:943

Additional options that are sent into each tool call.

## Extended by

- [`ExtendedToolExecutionOptions`](ExtendedToolExecutionOptions.md)

## Properties

### abortSignal?

> `optional` **abortSignal**: `AbortSignal`

Defined in: node\_modules/.bun/@ai-sdk+provider-utils@4.0.11+3c5d820c62823f0b/node\_modules/@ai-sdk/provider-utils/dist/index.d.ts:956

An optional abort signal that indicates that the overall operation should be aborted.

***

### experimental\_context?

> `optional` **experimental\_context**: `unknown`

Defined in: node\_modules/.bun/@ai-sdk+provider-utils@4.0.11+3c5d820c62823f0b/node\_modules/@ai-sdk/provider-utils/dist/index.d.ts:969

User-defined context.

Treat the context object as immutable inside tools.
Mutating the context object can lead to race conditions and unexpected results
when tools are called in parallel.

If you need to mutate the context, analyze the tool calls and results
in `prepareStep` and update it there.

Experimental (can break in patch releases).

***

### messages

> **messages**: [`ModelMessage`](../type-aliases/ModelMessage.md)[]

Defined in: node\_modules/.bun/@ai-sdk+provider-utils@4.0.11+3c5d820c62823f0b/node\_modules/@ai-sdk/provider-utils/dist/index.d.ts:952

Messages that were sent to the language model to initiate the response that contained the tool call.
The messages **do not** include the system prompt nor the assistant response that contained the tool call.

***

### toolCallId

> **toolCallId**: `string`

Defined in: node\_modules/.bun/@ai-sdk+provider-utils@4.0.11+3c5d820c62823f0b/node\_modules/@ai-sdk/provider-utils/dist/index.d.ts:947

The ID of the tool call. You can use it e.g. when sending tool-call related information with stream data.
