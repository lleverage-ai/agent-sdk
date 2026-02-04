[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PreCompactInput

# Interface: PreCompactInput

Defined in: [packages/agent-sdk/src/types.ts:2000](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2000)

Input for PreCompact hooks.

## Extends

- `BaseHookInput`

## Properties

### cwd

> **cwd**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1831](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1831)

Current working directory

#### Inherited from

`BaseHookInput.cwd`

***

### hook\_event\_name

> **hook\_event\_name**: `"PreCompact"`

Defined in: [packages/agent-sdk/src/types.ts:2001](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2001)

The event type that triggered this hook

#### Overrides

`BaseHookInput.hook_event_name`

***

### message\_count

> **message\_count**: `number`

Defined in: [packages/agent-sdk/src/types.ts:2003](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2003)

Number of messages before compaction

***

### session\_id

> **session\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1829](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1829)

Session identifier

#### Inherited from

`BaseHookInput.session_id`

***

### tokens\_before

> **tokens\_before**: `number`

Defined in: [packages/agent-sdk/src/types.ts:2005](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2005)

Estimated token count before compaction
