[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PostToolUseInput

# Interface: PostToolUseInput

Defined in: [packages/agent-sdk/src/types.ts:1850](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1850)

Input for PostToolUse hooks.

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

> **hook\_event\_name**: `"PostToolUse"`

Defined in: [packages/agent-sdk/src/types.ts:1851](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1851)

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

Defined in: [packages/agent-sdk/src/types.ts:1855](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1855)

Input parameters for the tool

***

### tool\_name

> **tool\_name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1853](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1853)

Name of the tool that was executed

***

### tool\_response

> **tool\_response**: `unknown`

Defined in: [packages/agent-sdk/src/types.ts:1857](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1857)

Result from the tool execution
