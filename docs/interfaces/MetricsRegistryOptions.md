[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MetricsRegistryOptions

# Interface: MetricsRegistryOptions

Defined in: [packages/agent-sdk/src/observability/metrics.ts:142](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L142)

Options for creating a metrics registry.

## Properties

### defaultLabels?

> `optional` **defaultLabels**: [`MetricLabels`](../type-aliases/MetricLabels.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:144](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L144)

Default labels for all metrics

***

### exporters?

> `optional` **exporters**: [`MetricsExporter`](MetricsExporter.md)[]

Defined in: [packages/agent-sdk/src/observability/metrics.ts:146](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L146)

Exporters to send metrics to

***

### exportInterval?

> `optional` **exportInterval**: `number`

Defined in: [packages/agent-sdk/src/observability/metrics.ts:148](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L148)

Export interval in milliseconds (0 = manual only)

***

### prefix?

> `optional` **prefix**: `string`

Defined in: [packages/agent-sdk/src/observability/metrics.ts:150](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L150)

Prefix for all metric names
