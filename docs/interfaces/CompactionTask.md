[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CompactionTask

# Interface: CompactionTask

Defined in: [packages/agent-sdk/src/context-manager.ts:618](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L618)

A background compaction task.

## Properties

### completedAt?

> `optional` **completedAt**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:635](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L635)

Timestamp when task completed (if done)

***

### createdAt

> **createdAt**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:629](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L629)

Timestamp when task was created

***

### error?

> `optional` **error**: `Error`

Defined in: [packages/agent-sdk/src/context-manager.ts:641](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L641)

Error (if failed)

***

### id

> **id**: `string`

Defined in: [packages/agent-sdk/src/context-manager.ts:620](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L620)

Unique identifier for this task

***

### messages

> **messages**: [`ModelMessage`](../type-aliases/ModelMessage.md)[]

Defined in: [packages/agent-sdk/src/context-manager.ts:626](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L626)

Messages to compact

***

### result?

> `optional` **result**: [`CompactionResult`](CompactionResult.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:638](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L638)

Compaction result (if completed)

***

### startedAt?

> `optional` **startedAt**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:632](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L632)

Timestamp when task started (if running)

***

### status

> **status**: [`CompactionTaskStatus`](../type-aliases/CompactionTaskStatus.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:623](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L623)

Current status

***

### trigger

> **trigger**: [`CompactionTrigger`](../type-aliases/CompactionTrigger.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:644](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L644)

Reason compaction was triggered
