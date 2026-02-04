[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / Histogram

# Interface: Histogram

Defined in: [packages/agent-sdk/src/observability/metrics.ts:110](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L110)

A histogram metric for measuring distributions.

## Methods

### get()

> **get**(`labels?`: [`MetricLabels`](../type-aliases/MetricLabels.md)): [`HistogramData`](HistogramData.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:114](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L114)

Get histogram data

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `labels?` | [`MetricLabels`](../type-aliases/MetricLabels.md) |

#### Returns

[`HistogramData`](HistogramData.md)

***

### observe()

> **observe**(`value`: `number`, `labels?`: [`MetricLabels`](../type-aliases/MetricLabels.md)): `void`

Defined in: [packages/agent-sdk/src/observability/metrics.ts:112](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L112)

Observe a value

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `value` | `number` |
| `labels?` | [`MetricLabels`](../type-aliases/MetricLabels.md) |

#### Returns

`void`

***

### reset()

> **reset**(`labels?`: [`MetricLabels`](../type-aliases/MetricLabels.md)): `void`

Defined in: [packages/agent-sdk/src/observability/metrics.ts:118](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L118)

Reset the histogram

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `labels?` | [`MetricLabels`](../type-aliases/MetricLabels.md) |

#### Returns

`void`

***

### startTimer()

> **startTimer**(`labels?`: [`MetricLabels`](../type-aliases/MetricLabels.md)): () => `number`

Defined in: [packages/agent-sdk/src/observability/metrics.ts:116](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L116)

Start a timer that observes duration when stopped

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `labels?` | [`MetricLabels`](../type-aliases/MetricLabels.md) |

#### Returns

> (): `number`

##### Returns

`number`
