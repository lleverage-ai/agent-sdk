[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createWriteTool

# Function: createWriteTool()

> **createWriteTool**(`backend`: [`BackendProtocol`](../interfaces/BackendProtocol.md)): [`Tool`](../type-aliases/Tool.md)&lt;\{ `content`: `string`; `file_path`: `string`; \}, `string`&gt;

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:114](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L114)

Creates a tool for writing/creating files.

Creates new files or overwrites existing ones. Parent directories are
created automatically if they don't exist.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `backend` | [`BackendProtocol`](../interfaces/BackendProtocol.md) | The backend to use for file operations |

## Returns

[`Tool`](../type-aliases/Tool.md)&lt;\{ `content`: `string`; `file_path`: `string`; \}, `string`&gt;

An AI SDK compatible tool for writing files

## Example

```typescript
import { createWriteTool } from "@lleverage-ai/agent-sdk";

const write = createWriteTool(backend);
const agent = createAgent({
  model,
  tools: { write },
});
```
