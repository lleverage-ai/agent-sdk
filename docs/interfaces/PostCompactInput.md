[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PostCompactInput

# Interface: PostCompactInput

Defined in: [packages/agent-sdk/src/types.ts:2012](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2012)

Input for PostCompact hooks.

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

> **hook\_event\_name**: `"PostCompact"`

Defined in: [packages/agent-sdk/src/types.ts:2013](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2013)

The event type that triggered this hook

#### Overrides

`BaseHookInput.hook_event_name`

***

### messages\_after

> **messages\_after**: `number`

Defined in: [packages/agent-sdk/src/types.ts:2017](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2017)

Number of messages after compaction

***

### messages\_before

> **messages\_before**: `number`

Defined in: [packages/agent-sdk/src/types.ts:2015](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2015)

Number of messages before compaction

***

### session\_id

> **session\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1829](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1829)

Session identifier

#### Inherited from

`BaseHookInput.session_id`

***

### tokens\_after

> **tokens\_after**: `number`

Defined in: [packages/agent-sdk/src/types.ts:2021](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2021)

Token count after compaction

***

### tokens\_before

> **tokens\_before**: `number`

Defined in: [packages/agent-sdk/src/types.ts:2019](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2019)

Token count before compaction

***

### tokens\_saved

> **tokens\_saved**: `number`

Defined in: [packages/agent-sdk/src/types.ts:2023](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2023)

Token savings from compaction
