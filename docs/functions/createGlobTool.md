[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createGlobTool

# Function: createGlobTool()

> **createGlobTool**(`backend`: [`BackendProtocol`](../interfaces/BackendProtocol.md)): [`Tool`](../type-aliases/Tool.md)&lt;\{ `path?`: `string`; `pattern`: `string`; \}, `string`&gt;

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:241](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L241)

Creates a tool for finding files matching glob patterns.

Supports glob patterns like `**/*.ts`, `src/**/*.test.ts`, etc.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `backend` | [`BackendProtocol`](../interfaces/BackendProtocol.md) | The backend to use for file operations |

## Returns

[`Tool`](../type-aliases/Tool.md)&lt;\{ `path?`: `string`; `pattern`: `string`; \}, `string`&gt;

An AI SDK compatible tool for glob searching

## Example

```typescript
import { createGlobTool } from "@lleverage-ai/agent-sdk";

const glob = createGlobTool(backend);
const agent = createAgent({
  model,
  tools: { glob },
});
```
