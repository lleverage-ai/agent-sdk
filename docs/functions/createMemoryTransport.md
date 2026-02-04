[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createMemoryTransport

# Function: createMemoryTransport()

> **createMemoryTransport**(`options?`: \{ `maxEntries?`: `number`; \}): [`LogTransport`](../interfaces/LogTransport.md) & \{ `entries`: [`LogEntry`](../interfaces/LogEntry.md)[]; `clear`: `void`; \}

Defined in: [packages/agent-sdk/src/observability/logger.ts:381](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L381)

Creates a memory transport that stores log entries.

Useful for testing or collecting logs for later analysis.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options?` | \{ `maxEntries?`: `number`; \} | Transport options |
| `options.maxEntries?` | `number` | Maximum entries to store (default: 1000) |

## Returns

[`LogTransport`](../interfaces/LogTransport.md) & \{ `entries`: [`LogEntry`](../interfaces/LogEntry.md)[]; `clear`: `void`; \}

A memory transport with access to stored entries

## Example

```typescript
const memoryTransport = createMemoryTransport({ maxEntries: 100 });
const logger = createLogger({ transports: [memoryTransport] });

logger.info("Test");
console.log(memoryTransport.entries); // [{ level: "info", ... }]
```
