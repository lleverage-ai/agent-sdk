[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentExecutionResult

# Interface: SubagentExecutionResult

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:160](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L160)

Result from executing a subagent.

## Properties

### context

> **context**: [`SubagentContext`](SubagentContext.md)

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:183](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L183)

The subagent's final context (for merging back)

***

### duration

> **duration**: `number`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:177](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L177)

Execution duration in milliseconds

***

### error?

> `optional` **error**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:180](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L180)

Error message if failed

***

### finishReason

> **finishReason**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:174](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L174)

Why generation finished

***

### output?

> `optional` **output**: `unknown`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:168](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L168)

Structured output if schema was provided

***

### result?

> `optional` **result**: [`GenerateResult`](../type-aliases/GenerateResult.md)

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:186](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L186)

Full generation result

***

### steps

> **steps**: `number`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:171](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L171)

Number of steps taken

***

### success

> **success**: `boolean`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:162](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L162)

Whether execution succeeded

***

### text

> **text**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:165](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L165)

The generated text response
