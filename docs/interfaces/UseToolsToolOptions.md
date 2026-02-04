[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / UseToolsToolOptions

# Interface: UseToolsToolOptions

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:700](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L700)

Options for creating the use_tools meta-tool.

## Properties

### descriptionPrefix?

> `optional` **descriptionPrefix**: `string`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:713](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L713)

Custom description prefix.

***

### groupByPlugin?

> `optional` **groupByPlugin**: `boolean`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:719](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L719)

Whether to include plugin groupings in tool index.

#### Default Value

```ts
true
```

***

### name?

> `optional` **name**: `string`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:708](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L708)

Custom name for the tool.

#### Default Value

```ts
"use_tools"
```

***

### registry

> **registry**: [`ToolRegistry`](../classes/ToolRegistry.md)

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:702](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L702)

The tool registry to use
