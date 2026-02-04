[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ToolMetadata

# Interface: ToolMetadata

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:30](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L30)

Lightweight metadata for a registered tool.

This is what the agent sees before loading - just enough information
to decide whether to load the full tool definition.

## Properties

### category?

> `optional` **category**: `string`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:41](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L41)

Category for grouping related tools

***

### description

> **description**: `string`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:35](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L35)

Brief description for search/discovery

***

### name

> **name**: `string`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:32](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L32)

Tool name (unique identifier)

***

### plugin?

> `optional` **plugin**: `string`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:38](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L38)

Plugin that provides this tool (if any)

***

### tags?

> `optional` **tags**: `string`[]

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:44](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L44)

Tags for semantic search
