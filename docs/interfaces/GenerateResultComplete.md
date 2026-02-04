[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / GenerateResultComplete

# Interface: GenerateResultComplete

Defined in: [packages/agent-sdk/src/types.ts:1320](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1320)

Result from a completed generation request.

This is returned when the agent completes successfully without interruption.

## Properties

### finishReason

> **finishReason**: [`FinishReason`](../type-aliases/FinishReason.md)

Defined in: [packages/agent-sdk/src/types.ts:1331](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1331)

Reason why generation finished

***

### forkedSessionId?

> `optional` **forkedSessionId**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1340](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1340)

New session ID if session was forked via forkSession option

***

### output?

> `optional` **output**: `unknown`

Defined in: [packages/agent-sdk/src/types.ts:1334](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1334)

Structured output if responseSchema was provided

***

### status

> **status**: `"complete"`

Defined in: [packages/agent-sdk/src/types.ts:1322](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1322)

Status indicating the generation completed successfully

***

### steps

> **steps**: [`GenerateStep`](GenerateStep.md)[]

Defined in: [packages/agent-sdk/src/types.ts:1337](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1337)

All steps from the generation (includes tool calls)

***

### text

> **text**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1325](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1325)

The generated text

***

### usage?

> `optional` **usage**: [`LanguageModelUsage`](../type-aliases/LanguageModelUsage.md)

Defined in: [packages/agent-sdk/src/types.ts:1328](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1328)

Token usage information (AI SDK type)
