[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentExecutionOptions

# Interface: SubagentExecutionOptions

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:107](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L107)

Options for executing a subagent.

## Properties

### context?

> `optional` **context**: [`SubagentContext`](SubagentContext.md)

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:121](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L121)

Isolated context for the subagent.
If not provided, context is created automatically.

***

### definition

> **definition**: [`EnhancedSubagentDefinition`](EnhancedSubagentDefinition.md)

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:109](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L109)

The subagent definition to execute

***

### maxTokens?

> `optional` **maxTokens**: `number`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:127](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L127)

Maximum tokens for generation.
If not specified, uses definition.maxSteps * 4096.

***

### onError()?

> `optional` **onError**: (`event`: [`SubagentErrorEvent`](SubagentErrorEvent.md)) => `void`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:152](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L152)

Callback when an error occurs.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `event` | [`SubagentErrorEvent`](SubagentErrorEvent.md) |

#### Returns

`void`

***

### onFinish()?

> `optional` **onFinish**: (`event`: [`SubagentFinishEvent`](SubagentFinishEvent.md)) => `void`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:147](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L147)

Callback when the subagent finishes.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `event` | [`SubagentFinishEvent`](SubagentFinishEvent.md) |

#### Returns

`void`

***

### onStart()?

> `optional` **onStart**: (`event`: [`SubagentStartEvent`](SubagentStartEvent.md)) => `void`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:137](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L137)

Callback when the subagent starts.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `event` | [`SubagentStartEvent`](SubagentStartEvent.md) |

#### Returns

`void`

***

### onStep()?

> `optional` **onStep**: (`event`: [`SubagentStepEvent`](SubagentStepEvent.md)) => `void`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:142](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L142)

Callback for each step the subagent takes.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `event` | [`SubagentStepEvent`](SubagentStepEvent.md) |

#### Returns

`void`

***

### parentAgent

> **parentAgent**: [`Agent`](Agent.md)

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:115](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L115)

Parent agent for inheriting configuration

***

### prompt

> **prompt**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:112](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L112)

The task/prompt for the subagent

***

### signal?

> `optional` **signal**: `AbortSignal`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:132](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L132)

Abort signal for cancellation.
