[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / toolsFrom

# Function: toolsFrom()

> **toolsFrom**(...`refs`: [`ToolReference`](../type-aliases/ToolReference.md)[]): `string`[]

Defined in: [packages/agent-sdk/src/tools/utils.ts:171](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/utils.ts#L171)

Extracts tool names from various sources.

Accepts strings, plugins, tool sets, or arrays of these and returns
a flat array of tool name strings.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| ...`refs` | [`ToolReference`](../type-aliases/ToolReference.md)[] | Tool references to extract names from |

## Returns

`string`[]

Array of tool name strings

## Example

```typescript
// Mix of different reference types
const tools = toolsFrom(
  "read",                           // String
  "write",
  myPlugin,                         // Plugin (extracts tool names)
  { custom: customTool },           // ToolSet (extracts keys)
);

const subagent = createSubagent(parent, {
  allowedTools: tools,
});
```
