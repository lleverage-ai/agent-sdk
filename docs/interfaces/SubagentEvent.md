[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentEvent

# Interface: SubagentEvent

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:220](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L220)

Base event for subagent lifecycle.

## Extended by

- [`SubagentErrorEvent`](SubagentErrorEvent.md)
- [`SubagentFinishEvent`](SubagentFinishEvent.md)
- [`SubagentStartEvent`](SubagentStartEvent.md)
- [`SubagentStepEvent`](SubagentStepEvent.md)

## Properties

### executionId

> **executionId**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:222](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L222)

Unique identifier for this execution

***

### subagentType

> **subagentType**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:225](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L225)

The subagent type

***

### timestamp

> **timestamp**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:228](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L228)

Timestamp of the event
