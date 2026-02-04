[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / AgentDataTypes

# Interface: AgentDataTypes

Defined in: [packages/agent-sdk/src/types.ts:267](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L267)

Custom data types for agent-specific streaming events.
These extend AI SDK's UIDataTypes to add subagent, progress, and other events.

## Extends

- `UIDataTypes`

## Indexable

\[`key`: `string`\]: `unknown`

## Properties

### agent-progress

> **agent-progress**: \{ `message`: `string`; `percent?`: `number`; \}

Defined in: [packages/agent-sdk/src/types.ts:282](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L282)

Progress updates during agent execution

#### message

> **message**: `string`

#### percent?

> `optional` **percent**: `number`

***

### context-compaction

> **context-compaction**: \{ `summary`: `string`; `tokensAfter`: `number`; `tokensBefore`: `number`; \}

Defined in: [packages/agent-sdk/src/types.ts:287](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L287)

Emitted when context compaction occurs

#### summary

> **summary**: `string`

#### tokensAfter

> **tokensAfter**: `number`

#### tokensBefore

> **tokensBefore**: `number`

***

### skill-loaded

> **skill-loaded**: \{ `prompt`: `string`; `skillName`: `string`; \}

Defined in: [packages/agent-sdk/src/types.ts:293](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L293)

Emitted when a skill is loaded

#### prompt

> **prompt**: `string`

#### skillName

> **skillName**: `string`

***

### subagent-complete

> **subagent-complete**: \{ `agentId`: `string`; `duration`: `number`; `summary`: `string`; \}

Defined in: [packages/agent-sdk/src/types.ts:276](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L276)

Emitted when a subagent completes

#### agentId

> **agentId**: `string`

#### duration

> **duration**: `number`

#### summary

> **summary**: `string`

***

### subagent-spawn

> **subagent-spawn**: \{ `agentId`: `string`; `parentToolUseId`: `string`; `prompt`: `string`; `type`: `string`; \}

Defined in: [packages/agent-sdk/src/types.ts:269](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L269)

Emitted when a subagent is spawned

#### agentId

> **agentId**: `string`

#### parentToolUseId

> **parentToolUseId**: `string`

#### prompt

> **prompt**: `string`

#### type

> **type**: `string`
