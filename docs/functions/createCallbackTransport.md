[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createCallbackTransport

# Function: createCallbackTransport()

> **createCallbackTransport**(`callback`: (`entry`: [`LogEntry`](../interfaces/LogEntry.md)) => `void` \| `Promise`&lt;`void`&gt;): [`LogTransport`](../interfaces/LogTransport.md)

Defined in: [packages/agent-sdk/src/observability/logger.ts:418](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L418)

Creates a callback transport that invokes a function for each entry.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `callback` | (`entry`: [`LogEntry`](../interfaces/LogEntry.md)) => `void` \| `Promise`&lt;`void`&gt; | Function to call for each log entry |

## Returns

[`LogTransport`](../interfaces/LogTransport.md)

A callback transport

## Example

```typescript
const transport = createCallbackTransport((entry) => {
  sendToExternalService(entry);
});
```
