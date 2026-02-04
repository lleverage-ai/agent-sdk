[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CompactionPolicy

# Interface: CompactionPolicy

Defined in: [packages/agent-sdk/src/context-manager.ts:371](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L371)

Policy for determining when to trigger context compaction.

Provides multi-signal triggering beyond simple threshold checks:
- Token usage threshold (default: 80% of max)
- Hard cap safety (force compaction at 95% to prevent errors)
- Growth rate prediction (preemptive compaction)
- Error-triggered fallback (emergency compaction on context errors)

## Properties

### enabled

> **enabled**: `boolean`

Defined in: [packages/agent-sdk/src/context-manager.ts:375](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L375)

Enable compaction (default: true).

***

### enableErrorFallback

> **enableErrorFallback**: `boolean`

Defined in: [packages/agent-sdk/src/context-manager.ts:401](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L401)

Enable error-triggered fallback compaction (default: true).
If true, automatically triggers emergency compaction on context length errors.

***

### enableGrowthRatePrediction

> **enableGrowthRatePrediction**: `boolean`

Defined in: [packages/agent-sdk/src/context-manager.ts:395](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L395)

Enable growth rate prediction (default: false).
If true, triggers compaction when growth rate suggests next call will exceed threshold.

***

### hardCapThreshold

> **hardCapThreshold**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:389](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L389)

Hard cap threshold for safety (0-1).
Forces compaction when usage \>= hardCapThreshold to prevent errors.

#### Default Value

```ts
0.95 (95% of max tokens)
```

***

### shouldCompact()?

> `optional` **shouldCompact**: (`budget`: [`TokenBudget`](TokenBudget.md), `messages`: [`ModelMessage`](../type-aliases/ModelMessage.md)[]) => \{ `reason?`: [`CompactionTrigger`](../type-aliases/CompactionTrigger.md); `trigger`: `boolean`; \}

Defined in: [packages/agent-sdk/src/context-manager.ts:410](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L410)

Custom function to decide if compaction is needed.
If provided, overrides default policy logic.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `budget` | [`TokenBudget`](TokenBudget.md) | Current token budget |
| `messages` | [`ModelMessage`](../type-aliases/ModelMessage.md)[] | Current message history |

#### Returns

\{ `reason?`: [`CompactionTrigger`](../type-aliases/CompactionTrigger.md); `trigger`: `boolean`; \}

True if compaction should be triggered, and optional trigger reason

##### reason?

> `optional` **reason**: [`CompactionTrigger`](../type-aliases/CompactionTrigger.md)

##### trigger

> **trigger**: `boolean`

***

### tokenThreshold

> **tokenThreshold**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:382](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L382)

Token usage threshold to trigger compaction (0-1).
Compaction occurs when usage \>= threshold.

#### Default Value

```ts
0.8 (80% of max tokens)
```
