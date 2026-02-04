[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PartialGenerateResult

# Interface: PartialGenerateResult

Defined in: [packages/agent-sdk/src/types.ts:1348](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1348)

Partial result data available when generation is interrupted.

## Properties

### steps

> **steps**: [`GenerateStep`](GenerateStep.md)[]

Defined in: [packages/agent-sdk/src/types.ts:1353](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1353)

Steps completed before the interrupt

***

### text

> **text**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1350](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1350)

Text generated before the interrupt

***

### usage?

> `optional` **usage**: [`LanguageModelUsage`](../type-aliases/LanguageModelUsage.md)

Defined in: [packages/agent-sdk/src/types.ts:1356](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1356)

Token usage up to the point of interruption
