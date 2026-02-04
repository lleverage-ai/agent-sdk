[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SummarizationConfig

# Interface: SummarizationConfig

Defined in: [packages/agent-sdk/src/context-manager.ts:488](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L488)

Configuration for automatic context summarization.

## Properties

### enableStructuredSummary?

> `optional` **enableStructuredSummary**: `boolean`

Defined in: [packages/agent-sdk/src/context-manager.ts:540](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L540)

Enable structured summary format.
When true, generates summaries with distinct sections.

#### Default Value

```ts
false
```

***

### enableTieredSummaries?

> `optional` **enableTieredSummaries**: `boolean`

Defined in: [packages/agent-sdk/src/context-manager.ts:520](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L520)

Enable tiered summaries (requires strategy: "tiered").
When enabled, creates multiple summary layers over time.

#### Default Value

```ts
false
```

***

### keepMessageCount

> **keepMessageCount**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:494](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L494)

Number of recent messages to always keep uncompacted.
These messages are preserved to maintain recent context.

#### Default Value

```ts
10
```

***

### keepToolResultCount

> **keepToolResultCount**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:501](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L501)

Number of recent tool results to preserve.
Tool results are often referenced, so keep some recent ones.

#### Default Value

```ts
5
```

***

### maxSummaryTiers?

> `optional` **maxSummaryTiers**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:526](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L526)

Maximum number of summary tiers (for tiered strategy).

#### Default Value

```ts
3
```

***

### messagesPerTier?

> `optional` **messagesPerTier**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:533](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L533)

Messages per tier (for tiered strategy).
Each tier summarizes this many previous summaries.

#### Default Value

```ts
5
```

***

### strategy?

> `optional` **strategy**: [`CompactionStrategy`](../type-aliases/CompactionStrategy.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:513](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L513)

Compaction strategy to use.

#### Default Value

```ts
"rollup"
```

***

### summaryPrompt?

> `optional` **summaryPrompt**: `string`

Defined in: [packages/agent-sdk/src/context-manager.ts:507](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L507)

Custom summarization prompt.
If not provided, a default prompt is used.
