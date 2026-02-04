[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createEditTool

# Function: createEditTool()

> **createEditTool**(`backend`: [`BackendProtocol`](../interfaces/BackendProtocol.md)): [`Tool`](../type-aliases/Tool.md)&lt;\{ `file_path`: `string`; `new_string`: `string`; `old_string`: `string`; `replace_all?`: `boolean`; \}, `string`&gt;

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:168](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L168)

Creates a tool for editing files via string replacement.

Replaces text in a file. By default, the `old_string` must be unique
in the file to prevent accidental replacements. Use `replace_all: true`
to replace all occurrences.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `backend` | [`BackendProtocol`](../interfaces/BackendProtocol.md) | The backend to use for file operations |

## Returns

[`Tool`](../type-aliases/Tool.md)&lt;\{ `file_path`: `string`; `new_string`: `string`; `old_string`: `string`; `replace_all?`: `boolean`; \}, `string`&gt;

An AI SDK compatible tool for editing files

## Example

```typescript
import { createEditTool } from "@lleverage-ai/agent-sdk";

const edit = createEditTool(backend);
const agent = createAgent({
  model,
  tools: { edit },
});
```
