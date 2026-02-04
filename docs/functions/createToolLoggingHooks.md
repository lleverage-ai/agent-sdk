[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createToolLoggingHooks

# Function: createToolLoggingHooks()

> **createToolLoggingHooks**(`options`: [`GenerationLoggingHooksOptions`](../interfaces/GenerationLoggingHooksOptions.md)): [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/hooks/logging.ts:273](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L273)

Creates logging hooks for tool execution events.

Provides Pre/Post logging for tool calls with arguments, results,
and error information.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`GenerationLoggingHooksOptions`](../interfaces/GenerationLoggingHooksOptions.md) | Configuration options |

## Returns

[`HookCallback`](../type-aliases/HookCallback.md)[]

Array of hooks for tool events

## Example

```typescript
const toolLogHooks = createToolLoggingHooks({
  prefix: "[Tools]",
  maxTextLength: 150,
});

const agent = createAgent({
  model,
  hooks: {
    PreToolUse: [{ hooks: [toolLogHooks[0]] }],
    PostToolUse: [{ hooks: [toolLogHooks[1]] }],
    PostToolUseFailure: [{ hooks: [toolLogHooks[2]] }],
  },
});
```
