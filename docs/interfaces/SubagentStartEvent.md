[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentStartEvent

# Interface: SubagentStartEvent

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:236](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L236)

Event emitted when a subagent starts.

## Extends

- [`SubagentEvent`](SubagentEvent.md)

## Properties

### executionId

> **executionId**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:222](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L222)

Unique identifier for this execution

#### Inherited from

[`SubagentEvent`](SubagentEvent.md).[`executionId`](SubagentEvent.md#executionid)

***

### prompt

> **prompt**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:240](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L240)

The task prompt

***

### subagentType

> **subagentType**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:225](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L225)

The subagent type

#### Inherited from

[`SubagentEvent`](SubagentEvent.md).[`subagentType`](SubagentEvent.md#subagenttype)

***

### timestamp

> **timestamp**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:228](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L228)

Timestamp of the event

#### Inherited from

[`SubagentEvent`](SubagentEvent.md).[`timestamp`](SubagentEvent.md#timestamp)

***

### type

> **type**: `"subagent-start"`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:237](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L237)
