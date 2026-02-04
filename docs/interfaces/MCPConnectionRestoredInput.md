[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MCPConnectionRestoredInput

# Interface: MCPConnectionRestoredInput

Defined in: [packages/agent-sdk/src/types.ts:1960](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1960)

Input for MCPConnectionRestored hooks.

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

> **hook\_event\_name**: `"MCPConnectionRestored"`

Defined in: [packages/agent-sdk/src/types.ts:1961](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1961)

The event type that triggered this hook

#### Overrides

`BaseHookInput.hook_event_name`

***

### server\_name

> **server\_name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1963](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1963)

Name of the MCP server that was restored

***

### session\_id

> **session\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1829](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1829)

Session identifier

#### Inherited from

`BaseHookInput.session_id`

***

### tool\_count

> **tool\_count**: `number`

Defined in: [packages/agent-sdk/src/types.ts:1965](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1965)

Number of tools now available from this server
