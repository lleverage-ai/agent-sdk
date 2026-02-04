[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ExtendedToolExecutionOptions

# Interface: ExtendedToolExecutionOptions

Defined in: [packages/agent-sdk/src/types.ts:125](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L125)

Extended tool execution options that include interrupt capability.

This extends the AI SDK's ToolExecutionOptions to add the `interrupt`
function for requesting user input during tool execution.

## Example

```typescript
execute: async (input, options) => {
  const { interrupt } = options as ExtendedToolExecutionOptions;

  if (needsConfirmation) {
    const { confirmed } = await interrupt<
      { message: string },
      { confirmed: boolean }
    >({ message: "Are you sure?" });

    if (!confirmed) {
      return { cancelled: true };
    }
  }

  return performAction(input);
}
```

## Extends

- [`ToolExecutionOptions`](ToolExecutionOptions.md)

## Properties

### abortSignal?

> `optional` **abortSignal**: `AbortSignal`

Defined in: node\_modules/.bun/@ai-sdk+provider-utils@4.0.11+3c5d820c62823f0b/node\_modules/@ai-sdk/provider-utils/dist/index.d.ts:956

An optional abort signal that indicates that the overall operation should be aborted.

#### Inherited from

[`ToolExecutionOptions`](ToolExecutionOptions.md).[`abortSignal`](ToolExecutionOptions.md#abortsignal)

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

#### Inherited from

[`ToolExecutionOptions`](ToolExecutionOptions.md).[`experimental_context`](ToolExecutionOptions.md#experimental_context)

***

### interrupt

> **interrupt**: [`InterruptFunction`](../type-aliases/InterruptFunction.md)

Defined in: [packages/agent-sdk/src/types.ts:130](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L130)

Function to request an interrupt during tool execution.
Available when the agent has a checkpointer configured.

***

### messages

> **messages**: [`ModelMessage`](../type-aliases/ModelMessage.md)[]

Defined in: node\_modules/.bun/@ai-sdk+provider-utils@4.0.11+3c5d820c62823f0b/node\_modules/@ai-sdk/provider-utils/dist/index.d.ts:952

Messages that were sent to the language model to initiate the response that contained the tool call.
The messages **do not** include the system prompt nor the assistant response that contained the tool call.

#### Inherited from

[`ToolExecutionOptions`](ToolExecutionOptions.md).[`messages`](ToolExecutionOptions.md#messages)

***

### toolCallId

> **toolCallId**: `string`

Defined in: node\_modules/.bun/@ai-sdk+provider-utils@4.0.11+3c5d820c62823f0b/node\_modules/@ai-sdk/provider-utils/dist/index.d.ts:947

The ID of the tool call. You can use it e.g. when sending tool-call related information with stream data.

#### Inherited from

[`ToolExecutionOptions`](ToolExecutionOptions.md).[`toolCallId`](ToolExecutionOptions.md#toolcallid)
