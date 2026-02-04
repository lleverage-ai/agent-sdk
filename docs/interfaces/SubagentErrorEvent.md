[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentErrorEvent

# Interface: SubagentErrorEvent

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:294](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L294)

Event emitted when an error occurs.

## Extends

- [`SubagentEvent`](SubagentEvent.md)

## Properties

### error

> **error**: `Error`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:298](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L298)

The error that occurred

***

### executionId

> **executionId**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:222](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L222)

Unique identifier for this execution

#### Inherited from

[`SubagentEvent`](SubagentEvent.md).[`executionId`](SubagentEvent.md#executionid)

***

### stepNumber?

> `optional` **stepNumber**: `number`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:301](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L301)

Step number where error occurred (if applicable)

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

> **type**: `"subagent-error"`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:295](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L295)
