[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createGenerationLoggingHooks

# Function: createGenerationLoggingHooks()

> **createGenerationLoggingHooks**(`options`: [`GenerationLoggingHooksOptions`](../interfaces/GenerationLoggingHooksOptions.md)): [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/hooks/logging.ts:146](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L146)

Creates logging hooks for generation lifecycle events.

Provides Pre/Post logging for generation with timing information,
usage statistics, and error logging.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`GenerationLoggingHooksOptions`](../interfaces/GenerationLoggingHooksOptions.md) | Configuration options |

## Returns

[`HookCallback`](../type-aliases/HookCallback.md)[]

Array of hooks for generation events

## Examples

```typescript
const logHooks = createLoggingHooks({
  prefix: "[MyAgent]",
  logTiming: true,
  maxTextLength: 100,
});

const agent = createAgent({
  model,
  hooks: {
    PreGenerate: [{ hooks: [logHooks[0]] }],
    PostGenerate: [{ hooks: [logHooks[1]] }],
    PostGenerateFailure: [{ hooks: [logHooks[2]] }],
  },
});
```

```typescript
// Custom logger (e.g., structured logging)
const logHooks = createLoggingHooks({
  log: (msg) => logger.info(msg),
});
```
