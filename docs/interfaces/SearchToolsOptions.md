[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SearchToolsOptions

# Interface: SearchToolsOptions

Defined in: [packages/agent-sdk/src/tools/search.ts:17](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/search.ts#L17)

Options for creating the search_tools tool.

## Properties

### enableLoad?

> `optional` **enableLoad**: `boolean`

Defined in: [packages/agent-sdk/src/tools/search.ts:32](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/search.ts#L32)

Whether to enable loading tools after search.
When true, the tool accepts an optional 'load' parameter.

#### Default Value

```ts
false
```

***

### manager

> **manager**: [`MCPManager`](../classes/MCPManager.md)

Defined in: [packages/agent-sdk/src/tools/search.ts:19](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/search.ts#L19)

MCP manager to search

***

### maxResults?

> `optional` **maxResults**: `number`

Defined in: [packages/agent-sdk/src/tools/search.ts:25](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/search.ts#L25)

Maximum results to return.

#### Default Value

```ts
10
```

***

### onToolsLoaded()?

> `optional` **onToolsLoaded**: (`toolNames`: `string`[]) => `void`

Defined in: [packages/agent-sdk/src/tools/search.ts:38](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/search.ts#L38)

Callback when tools are loaded.
Used to notify the agent that tools have changed.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `toolNames` | `string`[] |

#### Returns

`void`
