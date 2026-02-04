[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createCallbackMetricsExporter

# Function: createCallbackMetricsExporter()

> **createCallbackMetricsExporter**(`callback`: (`metrics`: [`MetricPoint`](../interfaces/MetricPoint.md)[]) => `void` \| `Promise`&lt;`void`&gt;): [`MetricsExporter`](../interfaces/MetricsExporter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:594](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L594)

Creates a callback exporter that invokes a function for each export.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `callback` | (`metrics`: [`MetricPoint`](../interfaces/MetricPoint.md)[]) => `void` \| `Promise`&lt;`void`&gt; | Function to call with metrics |

## Returns

[`MetricsExporter`](../interfaces/MetricsExporter.md)

A callback exporter

## Example

```typescript
const exporter = createCallbackMetricsExporter((metrics) => {
  sendToPrometheus(metrics);
});
```
