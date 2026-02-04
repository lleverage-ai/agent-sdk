[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createMemoryMetricsExporter

# Function: createMemoryMetricsExporter()

> **createMemoryMetricsExporter**(): [`MetricsExporter`](../interfaces/MetricsExporter.md) & \{ `metrics`: [`MetricPoint`](../interfaces/MetricPoint.md)[]; `clear`: `void`; \}

Defined in: [packages/agent-sdk/src/observability/metrics.ts:561](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L561)

Creates a memory exporter that stores metrics.

## Returns

[`MetricsExporter`](../interfaces/MetricsExporter.md) & \{ `metrics`: [`MetricPoint`](../interfaces/MetricPoint.md)[]; `clear`: `void`; \}

A memory exporter with access to stored metrics

## Example

```typescript
const exporter = createMemoryMetricsExporter();
const registry = createMetricsRegistry({ exporters: [exporter] });

registry.counter("test").inc();
await registry.export();

console.log(exporter.metrics);
```
