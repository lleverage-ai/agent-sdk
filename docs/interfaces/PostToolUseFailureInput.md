[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PostToolUseFailureInput

# Interface: PostToolUseFailureInput

Defined in: [packages/agent-sdk/src/types.ts:1864](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1864)

Input for PostToolUseFailure hooks.

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

> **error**: `string` \| `Error`

Defined in: [packages/agent-sdk/src/types.ts:1871](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1871)

Error message or error object

***

### hook\_event\_name

> **hook\_event\_name**: `"PostToolUseFailure"`

Defined in: [packages/agent-sdk/src/types.ts:1865](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1865)

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

### tool\_input

> **tool\_input**: `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/types.ts:1869](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1869)

Input parameters for the tool

***

### tool\_name

> **tool\_name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1867](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1867)

Name of the tool that failed
