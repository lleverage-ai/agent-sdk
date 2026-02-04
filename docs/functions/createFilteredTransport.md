[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createFilteredTransport

# Function: createFilteredTransport()

> **createFilteredTransport**(`transport`: [`LogTransport`](../interfaces/LogTransport.md), `filter`: (`entry`: [`LogEntry`](../interfaces/LogEntry.md)) => `boolean`): [`LogTransport`](../interfaces/LogTransport.md)

Defined in: [packages/agent-sdk/src/observability/logger.ts:445](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L445)

Creates a filtered transport that only passes entries matching criteria.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `transport` | [`LogTransport`](../interfaces/LogTransport.md) | The underlying transport |
| `filter` | (`entry`: [`LogEntry`](../interfaces/LogEntry.md)) => `boolean` | Filter function |

## Returns

[`LogTransport`](../interfaces/LogTransport.md)

A filtered transport

## Example

```typescript
// Only log errors
const errorTransport = createFilteredTransport(
  createConsoleTransport(),
  (entry) => entry.level === "error"
);
```
