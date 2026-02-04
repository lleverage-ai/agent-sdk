[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PostGenerateFailureInput

# Interface: PostGenerateFailureInput

Defined in: [packages/agent-sdk/src/types.ts:1904](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1904)

Input for PostGenerateFailure hooks.

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

### error

> **error**: `Error`

Defined in: [packages/agent-sdk/src/types.ts:1909](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1909)

Error that occurred

***

### hook\_event\_name

> **hook\_event\_name**: `"PostGenerateFailure"`

Defined in: [packages/agent-sdk/src/types.ts:1905](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1905)

The event type that triggered this hook

#### Overrides

`BaseHookInput.hook_event_name`

***

### options

> **options**: [`GenerateOptions`](GenerateOptions.md)

Defined in: [packages/agent-sdk/src/types.ts:1907](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1907)

Generation options

***

### session\_id

> **session\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1829](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1829)

Session identifier

#### Inherited from

`BaseHookInput.session_id`
