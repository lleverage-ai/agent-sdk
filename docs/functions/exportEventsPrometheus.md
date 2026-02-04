[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / exportEventsPrometheus

# Function: exportEventsPrometheus()

> **exportEventsPrometheus**(`events`: [`ObservabilityEvent`](../type-aliases/ObservabilityEvent.md)[]): `string`

Defined in: [packages/agent-sdk/src/observability/events.ts:236](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L236)

Export events in a format suitable for Prometheus/OpenMetrics.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `events` | [`ObservabilityEvent`](../type-aliases/ObservabilityEvent.md)[] | Array of observability events |

## Returns

`string`

Metrics in Prometheus text format

## Example

```typescript
const events = [mcpFailedEvent, mcpRestoredEvent];
const metrics = exportEventsPrometheus(events);
// Send to Pushgateway or expose via /metrics endpoint
```
