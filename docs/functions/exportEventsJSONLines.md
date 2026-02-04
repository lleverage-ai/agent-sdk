[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / exportEventsJSONLines

# Function: exportEventsJSONLines()

> **exportEventsJSONLines**(`events`: [`ObservabilityEvent`](../type-aliases/ObservabilityEvent.md)[], `options`: [`EventExporterOptions`](../interfaces/EventExporterOptions.md)): `string`

Defined in: [packages/agent-sdk/src/observability/events.ts:197](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L197)

Export events as JSON Lines format for log aggregation tools.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `events` | [`ObservabilityEvent`](../type-aliases/ObservabilityEvent.md)[] | Array of observability events |
| `options` | [`EventExporterOptions`](../interfaces/EventExporterOptions.md) | Export options |

## Returns

`string`

JSON Lines string (one JSON object per line)

## Example

```typescript
const events = [mcpFailedEvent, toolRegisteredEvent];
const jsonl = exportEventsJSONLines(events);
await fs.writeFile("events.jsonl", jsonl);
```
