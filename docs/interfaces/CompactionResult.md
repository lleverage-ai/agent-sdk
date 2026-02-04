[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CompactionResult

# Interface: CompactionResult

Defined in: [packages/agent-sdk/src/context-manager.ts:567](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L567)

Result from a context compaction operation.

## Properties

### compactedMessages

> **compactedMessages**: [`ModelMessage`](../type-aliases/ModelMessage.md)[]

Defined in: [packages/agent-sdk/src/context-manager.ts:584](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L584)

Messages that were compacted

***

### messagesAfter

> **messagesAfter**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:572](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L572)

Number of messages after compaction

***

### messagesBefore

> **messagesBefore**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:569](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L569)

Number of messages before compaction

***

### newMessages

> **newMessages**: [`ModelMessage`](../type-aliases/ModelMessage.md)[]

Defined in: [packages/agent-sdk/src/context-manager.ts:587](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L587)

New message history after compaction

***

### strategy?

> `optional` **strategy**: [`CompactionStrategy`](../type-aliases/CompactionStrategy.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:593](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L593)

Strategy used for compaction

***

### structuredSummary?

> `optional` **structuredSummary**: [`StructuredSummary`](StructuredSummary.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:596](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L596)

Structured summary (if structured format enabled)

***

### summary

> **summary**: `string`

Defined in: [packages/agent-sdk/src/context-manager.ts:581](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L581)

The generated summary of compacted content

***

### summaryTier?

> `optional` **summaryTier**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:599](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L599)

Summary tier level (for tiered summaries)

***

### tokensAfter

> **tokensAfter**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:578](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L578)

Token count after compaction

***

### tokensBefore

> **tokensBefore**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:575](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L575)

Token count before compaction

***

### trigger

> **trigger**: [`CompactionTrigger`](../type-aliases/CompactionTrigger.md)

Defined in: [packages/agent-sdk/src/context-manager.ts:590](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L590)

Reason compaction was triggered
