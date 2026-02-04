[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MCPConnectionFailedInput

# Interface: MCPConnectionFailedInput

Defined in: [packages/agent-sdk/src/types.ts:1946](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1946)

Input for MCPConnectionFailed hooks.

## Extends

- `BaseHookInput`

## Properties

### config

> **config**: [`MCPServerConfig`](../type-aliases/MCPServerConfig.md)

Defined in: [packages/agent-sdk/src/types.ts:1951](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1951)

Server configuration

***

### cwd

> **cwd**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1831](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1831)

Current working directory

#### Inherited from

`BaseHookInput.cwd`

***

### error

> **error**: `Error`

Defined in: [packages/agent-sdk/src/types.ts:1953](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1953)

Error that occurred during connection

***

### hook\_event\_name

> **hook\_event\_name**: `"MCPConnectionFailed"`

Defined in: [packages/agent-sdk/src/types.ts:1947](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1947)

The event type that triggered this hook

#### Overrides

`BaseHookInput.hook_event_name`

***

### server\_name

> **server\_name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1949](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1949)

Name of the MCP server that failed to connect

***

### session\_id

> **session\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1829](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1829)

Session identifier

#### Inherited from

`BaseHookInput.session_id`
