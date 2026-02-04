[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ToolRegisteredInput

# Interface: ToolRegisteredInput

Defined in: [packages/agent-sdk/src/types.ts:1972](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1972)

Input for ToolRegistered hooks.

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

### description

> **description**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1977](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1977)

Tool description

***

### hook\_event\_name

> **hook\_event\_name**: `"ToolRegistered"`

Defined in: [packages/agent-sdk/src/types.ts:1973](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1973)

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

Defined in: [packages/agent-sdk/src/types.ts:1979](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1979)

Source plugin or server (if any)

***

### tool\_name

> **tool\_name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1975](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1975)

Name of the tool that was registered
