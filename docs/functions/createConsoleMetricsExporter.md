[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createConsoleMetricsExporter

# Function: createConsoleMetricsExporter()

> **createConsoleMetricsExporter**(): [`MetricsExporter`](../interfaces/MetricsExporter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:534](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L534)

Creates a console exporter for debugging.

## Returns

[`MetricsExporter`](../interfaces/MetricsExporter.md)

A console exporter

## Example

```typescript
const registry = createMetricsRegistry({
  exporters: [createConsoleMetricsExporter()],
});
```
