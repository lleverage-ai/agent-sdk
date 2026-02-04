[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createReadTool

# Function: createReadTool()

> **createReadTool**(`backend`: [`BackendProtocol`](../interfaces/BackendProtocol.md)): [`Tool`](../type-aliases/Tool.md)&lt;\{ `file_path`: `string`; `limit?`: `number`; `offset?`: `number`; \}, `string`&gt;

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:51](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L51)

Creates a tool for reading file contents.

Reads files with line numbers and supports offset/limit for large files.
By default reads the first 2000 lines.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `backend` | [`BackendProtocol`](../interfaces/BackendProtocol.md) | The backend to use for file operations |

## Returns

[`Tool`](../type-aliases/Tool.md)&lt;\{ `file_path`: `string`; `limit?`: `number`; `offset?`: `number`; \}, `string`&gt;

An AI SDK compatible tool for reading files

## Example

```typescript
import { createReadTool } from "@lleverage-ai/agent-sdk";

const read = createReadTool(backend);
const agent = createAgent({
  model,
  tools: { read },
});
```
