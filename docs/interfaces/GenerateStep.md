[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / GenerateStep

# Interface: GenerateStep

Defined in: [packages/agent-sdk/src/types.ts:1470](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1470)

A single step in the generation process.

## Properties

### finishReason

> **finishReason**: [`FinishReason`](../type-aliases/FinishReason.md)

Defined in: [packages/agent-sdk/src/types.ts:1481](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1481)

Finish reason for this step

***

### text

> **text**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1472](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1472)

Text generated in this step

***

### toolCalls

> **toolCalls**: [`ToolCallResult`](ToolCallResult.md)[]

Defined in: [packages/agent-sdk/src/types.ts:1475](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1475)

Tool calls made in this step

***

### toolResults

> **toolResults**: [`ToolResultPart`](ToolResultPart.md)[]

Defined in: [packages/agent-sdk/src/types.ts:1478](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1478)

Tool results from this step

***

### usage?

> `optional` **usage**: [`LanguageModelUsage`](../type-aliases/LanguageModelUsage.md)

Defined in: [packages/agent-sdk/src/types.ts:1484](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1484)

Usage for this step
