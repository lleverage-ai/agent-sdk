[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MetricsRegistry

# Interface: MetricsRegistry

Defined in: [packages/agent-sdk/src/observability/metrics.ts:158](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L158)

A registry for managing metrics.

## Methods

### close()

> **close**(): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/metrics.ts:174](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L174)

Close the registry and exporters

#### Returns

`Promise`&lt;`void`&gt;

***

### counter()

> **counter**(`name`: `string`, `description?`: `string`): [`Counter`](Counter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:160](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L160)

Create or get a counter

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `name` | `string` |
| `description?` | `string` |

#### Returns

[`Counter`](Counter.md)

***

### export()

> **export**(): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/metrics.ts:172](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L172)

Export metrics to all exporters

#### Returns

`Promise`&lt;`void`&gt;

***

### gauge()

> **gauge**(`name`: `string`, `description?`: `string`): [`Gauge`](Gauge.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:162](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L162)

Create or get a gauge

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `name` | `string` |
| `description?` | `string` |

#### Returns

[`Gauge`](Gauge.md)

***

### getMetrics()

> **getMetrics**(): [`MetricPoint`](MetricPoint.md)[]

Defined in: [packages/agent-sdk/src/observability/metrics.ts:170](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L170)

Get all current metric values

#### Returns

[`MetricPoint`](MetricPoint.md)[]

***

### histogram()

> **histogram**(`name`: `string`, `buckets?`: `number`[], `description?`: `string`): [`Histogram`](Histogram.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:164](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L164)

Create or get a histogram

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `name` | `string` |
| `buckets?` | `number`[] |
| `description?` | `string` |

#### Returns

[`Histogram`](Histogram.md)
