[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ToolRegistryOptions

# Interface: ToolRegistryOptions

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:91](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L91)

Options for creating a tool registry.

## Properties

### onRegistryUpdated()?

> `optional` **onRegistryUpdated**: () => `void`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:100](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L100)

Callback when the registry is updated.

#### Returns

`void`

***

### onToolLoadError()?

> `optional` **onToolLoadError**: (`input`: \{ `error`: `Error`; `source?`: `string`; `tool_name`: `string`; \}) => `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:114](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L114)

Callback when a tool fails to load.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | \{ `error`: `Error`; `source?`: `string`; `tool_name`: `string`; \} |
| `input.error` | `Error` |
| `input.source?` | `string` |
| `input.tool_name` | `string` |

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### onToolRegistered()?

> `optional` **onToolRegistered**: (`input`: \{ `description`: `string`; `source?`: `string`; `tool_name`: `string`; \}) => `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:105](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L105)

Callback when a tool is registered.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | \{ `description`: `string`; `source?`: `string`; `tool_name`: `string`; \} |
| `input.description` | `string` |
| `input.source?` | `string` |
| `input.tool_name` | `string` |

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### onToolsLoaded()?

> `optional` **onToolsLoaded**: (`result`: [`ToolLoadResult`](ToolLoadResult.md)) => `void`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:95](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L95)

Callback when tools are loaded.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `result` | [`ToolLoadResult`](ToolLoadResult.md) |

#### Returns

`void`
