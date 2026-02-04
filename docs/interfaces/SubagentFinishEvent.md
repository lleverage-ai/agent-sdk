[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentFinishEvent

# Interface: SubagentFinishEvent

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:270](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L270)

Event emitted when a subagent finishes.

## Extends

- [`SubagentEvent`](SubagentEvent.md)

## Properties

### duration

> **duration**: `number`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:283](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L283)

Execution duration in milliseconds

***

### executionId

> **executionId**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:222](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L222)

Unique identifier for this execution

#### Inherited from

[`SubagentEvent`](SubagentEvent.md).[`executionId`](SubagentEvent.md#executionid)

***

### finishReason

> **finishReason**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:286](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L286)

Finish reason

***

### steps

> **steps**: `number`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:280](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L280)

Total steps taken

***

### subagentType

> **subagentType**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:225](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L225)

The subagent type

#### Inherited from

[`SubagentEvent`](SubagentEvent.md).[`subagentType`](SubagentEvent.md#subagenttype)

***

### success

> **success**: `boolean`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:274](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L274)

Whether execution succeeded

***

### summary

> **summary**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:277](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L277)

Summary of the result

***

### timestamp

> **timestamp**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:228](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L228)

Timestamp of the event

#### Inherited from

[`SubagentEvent`](SubagentEvent.md).[`timestamp`](SubagentEvent.md#timestamp)

***

### type

> **type**: `"subagent-finish"`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:271](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L271)
