[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createMetricsRegistry

# Function: createMetricsRegistry()

> **createMetricsRegistry**(`options`: [`MetricsRegistryOptions`](../interfaces/MetricsRegistryOptions.md)): [`MetricsRegistry`](../interfaces/MetricsRegistry.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:350](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L350)

Creates a metrics registry.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`MetricsRegistryOptions`](../interfaces/MetricsRegistryOptions.md) | Registry options |

## Returns

[`MetricsRegistry`](../interfaces/MetricsRegistry.md)

A metrics registry

## Example

```typescript
const registry = createMetricsRegistry({
  defaultLabels: { service: "my-agent" },
});

const requestCounter = registry.counter("requests_total");
const latencyHistogram = registry.histogram("request_duration_ms");

requestCounter.inc();
latencyHistogram.observe(150);
```
