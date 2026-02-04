[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentStepEvent

# Interface: SubagentStepEvent

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:248](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L248)

Event emitted for each subagent step.

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

### stepNumber

> **stepNumber**: `number`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:252](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L252)

Step number (1-indexed)

***

### subagentType

> **subagentType**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:225](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L225)

The subagent type

#### Inherited from

[`SubagentEvent`](SubagentEvent.md).[`subagentType`](SubagentEvent.md#subagenttype)

***

### text

> **text**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:262](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L262)

Text generated in this step

***

### timestamp

> **timestamp**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:228](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L228)

Timestamp of the event

#### Inherited from

[`SubagentEvent`](SubagentEvent.md).[`timestamp`](SubagentEvent.md#timestamp)

***

### toolCalls

> **toolCalls**: \{ `args`: `unknown`; `result`: `unknown`; `toolName`: `string`; \}[]

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:255](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L255)

Tool calls made in this step

#### args

> **args**: `unknown`

#### result

> **result**: `unknown`

#### toolName

> **toolName**: `string`

***

### type

> **type**: `"subagent-step"`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:249](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L249)
