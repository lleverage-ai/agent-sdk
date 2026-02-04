[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MetricsExporter

# Interface: MetricsExporter

Defined in: [packages/agent-sdk/src/observability/metrics.ts:126](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L126)

A metrics exporter sends metrics to an external system.

## Properties

### name

> **name**: `string`

Defined in: [packages/agent-sdk/src/observability/metrics.ts:128](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L128)

Exporter name

## Methods

### close()?

> `optional` **close**(): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/metrics.ts:134](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L134)

Optional close for cleanup

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### export()

> **export**(`metrics`: [`MetricPoint`](MetricPoint.md)[]): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/metrics.ts:130](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L130)

Export metrics

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `metrics` | [`MetricPoint`](MetricPoint.md)[] |

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### flush()?

> `optional` **flush**(): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/metrics.ts:132](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L132)

Optional flush for batch exporters

#### Returns

`void` \| `Promise`&lt;`void`&gt;
