[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createFileSaver

# Function: createFileSaver()

> **createFileSaver**(`options`: [`FileSaverOptions`](../interfaces/FileSaverOptions.md)): [`FileSaver`](../classes/FileSaver.md)

Defined in: [packages/agent-sdk/src/checkpointer/file-saver.ts:380](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/file-saver.ts#L380)

Create a new FileSaver instance.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`FileSaverOptions`](../interfaces/FileSaverOptions.md) | Configuration including the directory path |

## Returns

[`FileSaver`](../classes/FileSaver.md)

A new FileSaver instance

## Example

```typescript
// Basic usage
const saver = createFileSaver({ dir: "./.checkpoints" });

// With namespace for multi-tenant isolation
const userSaver = createFileSaver({
  dir: "./.checkpoints",
  namespace: "user-123",
});

// Compact JSON (no pretty printing)
const compactSaver = createFileSaver({
  dir: "./.checkpoints",
  pretty: false,
});
```
