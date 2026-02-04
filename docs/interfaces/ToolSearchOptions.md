[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ToolSearchOptions

# Interface: ToolSearchOptions

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:126](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L126)

Options for searching tools.

## Properties

### category?

> `optional` **category**: `string`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:134](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L134)

Filter by category

***

### includeLoaded?

> `optional` **includeLoaded**: `boolean`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:140](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L140)

Include already-loaded tools in results

***

### limit?

> `optional` **limit**: `number`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:143](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L143)

Maximum results to return

***

### plugin?

> `optional` **plugin**: `string`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:131](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L131)

Filter by plugin name

***

### query?

> `optional` **query**: `string`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:128](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L128)

Search query (matches name, description, tags)

***

### tags?

> `optional` **tags**: `string`[]

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:137](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L137)

Filter by tags (any match)
