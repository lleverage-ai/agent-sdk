[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ContextManagerOptions

# Interface: ContextManagerOptions

Defined in: [packages/agent-sdk/src/context-manager.ts:991](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L991)

Options for creating a context manager.

## Properties

### maxTokens

> **maxTokens**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:993](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L993)

Maximum tokens allowed in context

***

### onBudgetUpdate()?

> `optional` **onBudgetUpdate**: (`budget`: [`TokenBudget`](TokenBudget.md)) => `void`

Defined in: [packages/agent-sdk/src/context-manager.ts:1014](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1014)

Callback when context budget is updated.
Useful for emitting events or updating UI.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `budget` | [`TokenBudget`](TokenBudget.md) |

#### Returns

`void`

***

### onCompact()?

> `optional` **onCompact**: (`result`: [`CompactionResult`](CompactionResult.md)) => `void`

Defined in: [packages/agent-sdk/src/context-manager.ts:1020](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1020)

Callback when compaction occurs.
Useful for logging or emitting events.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `result` | [`CompactionResult`](CompactionResult.md) |

#### Returns

`void`

***

### policy?

> `optional` **policy**: `Partial`&lt;[`CompactionPolicy`](CompactionPolicy.md)&gt;

Defined in: [packages/agent-sdk/src/context-manager.ts:999](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L999)

Compaction policy configuration

***

### scheduler?

> `optional` **scheduler**: [`CompactionSchedulerOptions`](CompactionSchedulerOptions.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:1008](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1008)

Scheduler configuration for background compaction

***

### summarization?

> `optional` **summarization**: `Partial`&lt;[`SummarizationConfig`](SummarizationConfig.md)&gt;

Defined in: [packages/agent-sdk/src/context-manager.ts:1002](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1002)

Summarization configuration

***

### summarizationModel?

> `optional` **summarizationModel**: [`LanguageModel`](../type-aliases/LanguageModel.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:1005](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1005)

Model to use for summarization (if different from agent model)

***

### tokenCounter?

> `optional` **tokenCounter**: [`TokenCounter`](TokenCounter.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:996](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L996)

Token counter to use (default: approximate counter)
