[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / isSandboxBackend

# Function: isSandboxBackend()

> **isSandboxBackend**(`value`: `unknown`): `value is SandboxBackendProtocol`

Defined in: [packages/agent-sdk/src/backend.ts:466](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L466)

Check if a value implements the SandboxBackendProtocol interface.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `value` | `unknown` | Value to check |

## Returns

`value is SandboxBackendProtocol`

True if value is a SandboxBackendProtocol

## Example

```typescript
function maybeExecute(backend: BackendProtocol, command: string) {
  if (isSandboxBackend(backend)) {
    return backend.execute(command);
  }
  throw new Error("Backend does not support command execution");
}
```
