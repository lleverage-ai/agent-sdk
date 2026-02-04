[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentStartInput

# Interface: SubagentStartInput

Defined in: [packages/agent-sdk/src/types.ts:1916](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1916)

Input for SubagentStart hooks.

## Extends

- `BaseHookInput`

## Properties

### agent\_id

> **agent\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1919](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1919)

Unique identifier for the subagent

***

### agent\_type

> **agent\_type**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1921](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1921)

Type of subagent

***

### cwd

> **cwd**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1831](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1831)

Current working directory

#### Inherited from

`BaseHookInput.cwd`

***

### hook\_event\_name

> **hook\_event\_name**: `"SubagentStart"`

Defined in: [packages/agent-sdk/src/types.ts:1917](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1917)

The event type that triggered this hook

#### Overrides

`BaseHookInput.hook_event_name`

***

### prompt?

> `optional` **prompt**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1923](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1923)

Task prompt for the subagent

***

### session\_id

> **session\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1829](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1829)

Session identifier

#### Inherited from

`BaseHookInput.session_id`
