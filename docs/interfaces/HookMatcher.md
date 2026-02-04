[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / HookMatcher

# Interface: HookMatcher

Defined in: [packages/agent-sdk/src/types.ts:2191](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2191)

Matcher for filtering which tools trigger hooks.

## Properties

### hooks

> **hooks**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2203](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2203)

Hook callbacks to run when pattern matches

***

### matcher?

> `optional` **matcher**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2200](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2200)

Regex pattern to match tool names (omit for all tools).
Examples:
- 'Write|Edit' - File modification tools
- '^mcp__' - All MCP tools
- 'mcp__playwright__' - Specific MCP server
- undefined - All tools (no filter)

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [packages/agent-sdk/src/types.ts:2209](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2209)

Timeout in milliseconds for hook execution.

#### Default Value

```ts
60000 (60 seconds)
```
