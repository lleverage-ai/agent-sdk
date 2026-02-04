[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createComprehensiveLoggingHooks

# Function: createComprehensiveLoggingHooks()

> **createComprehensiveLoggingHooks**(`options`: [`GenerationLoggingHooksOptions`](../interfaces/GenerationLoggingHooksOptions.md)): \{ `compactionHooks`: [`HookCallback`](../type-aliases/HookCallback.md)[]; `generationHooks`: [`HookCallback`](../type-aliases/HookCallback.md)[]; `toolHooks`: [`HookCallback`](../type-aliases/HookCallback.md)[]; \}

Defined in: [packages/agent-sdk/src/hooks/logging.ts:484](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L484)

Creates comprehensive logging hooks for all lifecycle events.

Combines generation, tool, and compaction logging into a single set of hooks.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`GenerationLoggingHooksOptions`](../interfaces/GenerationLoggingHooksOptions.md) | Configuration options |

## Returns

\{ `compactionHooks`: [`HookCallback`](../type-aliases/HookCallback.md)[]; `generationHooks`: [`HookCallback`](../type-aliases/HookCallback.md)[]; `toolHooks`: [`HookCallback`](../type-aliases/HookCallback.md)[]; \}

Object with hooks for all events

### compactionHooks

> **compactionHooks**: [`HookCallback`](../type-aliases/HookCallback.md)[]

### generationHooks

> **generationHooks**: [`HookCallback`](../type-aliases/HookCallback.md)[]

### toolHooks

> **toolHooks**: [`HookCallback`](../type-aliases/HookCallback.md)[]

## Example

```typescript
const { generationHooks, toolHooks, compactionHooks } = createComprehensiveLoggingHooks({
  prefix: "[MyAgent]",
  logTiming: true,
});

const agent = createAgent({
  model,
  hooks: {
    PreGenerate: [generationHooks[0]],
    PostGenerate: [generationHooks[1]],
    PostGenerateFailure: [generationHooks[2]],
    PreToolUse: [toolHooks[0]],
    PostToolUse: [toolHooks[1]],
    PostToolUseFailure: [toolHooks[2]],
    PreCompact: [compactionHooks[0]],
    PostCompact: [compactionHooks[1]],
  },
});
```
