[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentStopInput

# Interface: SubagentStopInput

Defined in: [packages/agent-sdk/src/types.ts:1930](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1930)

Input for SubagentStop hooks.

## Extends

- `BaseHookInput`

## Properties

### agent\_id

> **agent\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1933](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1933)

Unique identifier for the subagent

***

### agent\_type

> **agent\_type**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1935](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1935)

Type of subagent

***

### cwd

> **cwd**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1831](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1831)

Current working directory

#### Inherited from

`BaseHookInput.cwd`

***

### error?

> `optional` **error**: `Error`

Defined in: [packages/agent-sdk/src/types.ts:1939](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1939)

Error from subagent execution

***

### hook\_event\_name

> **hook\_event\_name**: `"SubagentStop"`

Defined in: [packages/agent-sdk/src/types.ts:1931](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1931)

The event type that triggered this hook

#### Overrides

`BaseHookInput.hook_event_name`

***

### result?

> `optional` **result**: `unknown`

Defined in: [packages/agent-sdk/src/types.ts:1937](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1937)

Result from subagent execution

***

### session\_id

> **session\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1829](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1829)

Session identifier

#### Inherited from

`BaseHookInput.session_id`
