[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / isBackend

# Function: isBackend()

> **isBackend**(`value`: `unknown`): `value is BackendProtocol`

Defined in: [packages/agent-sdk/src/backend.ts:431](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L431)

Check if a value implements the BackendProtocol interface.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `value` | `unknown` | Value to check |

## Returns

`value is BackendProtocol`

True if value is a BackendProtocol

## Example

```typescript
function processBackend(backend: unknown) {
  if (isBackend(backend)) {
    const files = await backend.lsInfo("/");
  }
}
```
