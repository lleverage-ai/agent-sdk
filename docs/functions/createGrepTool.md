[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createGrepTool

# Function: createGrepTool()

> **createGrepTool**(`backend`: [`BackendProtocol`](../interfaces/BackendProtocol.md)): [`Tool`](../type-aliases/Tool.md)&lt;\{ `glob?`: `string`; `path?`: `string`; `pattern`: `string`; \}, `string`&gt;

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:306](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L306)

Creates a tool for searching file contents with regex.

Searches for pattern matches across files, with optional glob filtering.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `backend` | [`BackendProtocol`](../interfaces/BackendProtocol.md) | The backend to use for file operations |

## Returns

[`Tool`](../type-aliases/Tool.md)&lt;\{ `glob?`: `string`; `path?`: `string`; `pattern`: `string`; \}, `string`&gt;

An AI SDK compatible tool for grep searching

## Example

```typescript
import { createGrepTool } from "@lleverage-ai/agent-sdk";

const grep = createGrepTool(backend);
const agent = createAgent({
  model,
  tools: { grep },
});
```
