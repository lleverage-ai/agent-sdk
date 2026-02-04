[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ToolLoadResult

# Interface: ToolLoadResult

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:66](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L66)

Result from loading tools.

## Properties

### error?

> `optional` **error**: `string`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:83](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L83)

Error message if something went wrong

***

### loaded

> **loaded**: `string`[]

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:71](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L71)

Names of tools that were loaded

***

### notFound

> **notFound**: `string`[]

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:77](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L77)

Names of tools that weren't found

***

### skipped

> **skipped**: `string`[]

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:74](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L74)

Names of tools that were already loaded (skipped)

***

### success

> **success**: `boolean`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:68](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L68)

Whether loading was successful

***

### tools

> **tools**: [`ToolSet`](../type-aliases/ToolSet.md)

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:80](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L80)

The loaded tools as a ToolSet
