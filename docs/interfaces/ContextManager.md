[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ContextManager

# Interface: ContextManager

Defined in: [packages/agent-sdk/src/context-manager.ts:1028](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1028)

Manages conversation context with token tracking and auto-compaction.

## Properties

### maxTokens

> `readonly` **maxTokens**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:1039](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1039)

Maximum tokens allowed

***

### pinnedMessages

> `readonly` **pinnedMessages**: [`PinnedMessageMetadata`](PinnedMessageMetadata.md)[]

Defined in: [packages/agent-sdk/src/context-manager.ts:1045](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1045)

Pinned messages that should always be kept

***

### policy

> `readonly` **policy**: [`CompactionPolicy`](CompactionPolicy.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:1033](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1033)

Current compaction policy

***

### scheduler?

> `readonly` `optional` **scheduler**: [`CompactionScheduler`](CompactionScheduler.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:1042](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1042)

Compaction scheduler (if background compaction is enabled)

***

### summarizationConfig

> `readonly` **summarizationConfig**: [`SummarizationConfig`](SummarizationConfig.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:1036](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1036)

Current summarization config

***

### tokenCounter

> `readonly` **tokenCounter**: [`TokenCounter`](TokenCounter.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:1030](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1030)

Current token counter

## Methods

### compact()

> **compact**(`messages`: [`ModelMessage`](../type-aliases/ModelMessage.md)[], `agent`: [`Agent`](Agent.md), `trigger?`: [`CompactionTrigger`](../type-aliases/CompactionTrigger.md)): `Promise`&lt;[`CompactionResult`](CompactionResult.md)&gt;

Defined in: [packages/agent-sdk/src/context-manager.ts:1071](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1071)

Compact the message history by summarizing older messages.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `messages` | [`ModelMessage`](../type-aliases/ModelMessage.md)[] | Current message history |
| `agent` | [`Agent`](Agent.md) | Agent to use for summarization |
| `trigger?` | [`CompactionTrigger`](../type-aliases/CompactionTrigger.md) | Reason compaction was triggered (default: "token_threshold") |

#### Returns

`Promise`&lt;[`CompactionResult`](CompactionResult.md)&gt;

Compaction result with new message history

***

### getBudget()

> **getBudget**(`messages`: [`ModelMessage`](../type-aliases/ModelMessage.md)[]): [`TokenBudget`](TokenBudget.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:1052](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1052)

Get the current token budget.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `messages` | [`ModelMessage`](../type-aliases/ModelMessage.md)[] | Current message history |

#### Returns

[`TokenBudget`](TokenBudget.md)

The token budget

***

### isPinned()

> **isPinned**(`messageIndex`: `number`): `boolean`

Defined in: [packages/agent-sdk/src/context-manager.ts:1120](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1120)

Check if a message is pinned.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `messageIndex` | `number` | Index of the message to check |

#### Returns

`boolean`

True if the message is pinned

***

### pinMessage()

> **pinMessage**(`messageIndex`: `number`, `reason`: `string`): `void`

Defined in: [packages/agent-sdk/src/context-manager.ts:1107](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1107)

Pin a message to prevent it from being compacted.
Pinned messages are always kept in the conversation history.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `messageIndex` | `number` | Index of the message to pin |
| `reason` | `string` | Reason for pinning this message |

#### Returns

`void`

***

### process()

> **process**(`messages`: [`ModelMessage`](../type-aliases/ModelMessage.md)[], `agent`: [`Agent`](Agent.md)): `Promise`&lt;[`ModelMessage`](../type-aliases/ModelMessage.md)[]&gt;

Defined in: [packages/agent-sdk/src/context-manager.ts:1083](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1083)

Process messages, automatically compacting if needed.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `messages` | [`ModelMessage`](../type-aliases/ModelMessage.md)[] | Current message history |
| `agent` | [`Agent`](Agent.md) | Agent to use for summarization |

#### Returns

`Promise`&lt;[`ModelMessage`](../type-aliases/ModelMessage.md)[]&gt;

The processed messages (may be compacted)

***

### shouldCompact()

> **shouldCompact**(`messages`: [`ModelMessage`](../type-aliases/ModelMessage.md)[]): \{ `reason?`: [`CompactionTrigger`](../type-aliases/CompactionTrigger.md); `trigger`: `boolean`; \}

Defined in: [packages/agent-sdk/src/context-manager.ts:1059](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1059)

Check if compaction is needed based on current token usage.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `messages` | [`ModelMessage`](../type-aliases/ModelMessage.md)[] | Current message history |

#### Returns

\{ `reason?`: [`CompactionTrigger`](../type-aliases/CompactionTrigger.md); `trigger`: `boolean`; \}

Object with trigger status and optional reason

##### reason?

> `optional` **reason**: [`CompactionTrigger`](../type-aliases/CompactionTrigger.md)

##### trigger

> **trigger**: `boolean`

***

### unpinMessage()

> **unpinMessage**(`messageIndex`: `number`): `void`

Defined in: [packages/agent-sdk/src/context-manager.ts:1113](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1113)

Unpin a message.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `messageIndex` | `number` | Index of the message to unpin |

#### Returns

`void`

***

### updateUsage()?

> `optional` **updateUsage**(`usage`: \{ `inputTokens`: `number` \| `undefined`; `outputTokens`: `number` \| `undefined`; `totalTokens`: `number` \| `undefined`; \}): `void`

Defined in: [packages/agent-sdk/src/context-manager.ts:1094](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L1094)

Update token tracking with actual usage from a model response.
This provides more accurate token counts than estimation.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `usage` | \{ `inputTokens`: `number` \| `undefined`; `outputTokens`: `number` \| `undefined`; `totalTokens`: `number` \| `undefined`; \} | Token usage from the model response (AI SDK v6 format) |
| `usage.inputTokens` | `number` \| `undefined` | Tokens used in the input/prompt |
| `usage.outputTokens` | `number` \| `undefined` | Tokens used in the output/completion |
| `usage.totalTokens` | `number` \| `undefined` | Total tokens used |

#### Returns

`void`
