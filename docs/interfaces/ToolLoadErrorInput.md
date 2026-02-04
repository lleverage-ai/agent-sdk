[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ToolLoadErrorInput

# Interface: ToolLoadErrorInput

Defined in: [packages/agent-sdk/src/types.ts:1986](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1986)

Input for ToolLoadError hooks.

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

Defined in: [packages/agent-sdk/src/types.ts:1991](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1991)

Error that occurred during loading

***

### hook\_event\_name

> **hook\_event\_name**: `"ToolLoadError"`

Defined in: [packages/agent-sdk/src/types.ts:1987](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1987)

The event type that triggered this hook

#### Overrides

`BaseHookInput.hook_event_name`

***

### session\_id

> **session\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1829](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1829)

Session identifier

#### Inherited from

`BaseHookInput.session_id`

***

### source?

> `optional` **source**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1993](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1993)

Source plugin or server (if any)

***

### tool\_name

> **tool\_name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1989](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1989)

Name of the tool that failed to load
