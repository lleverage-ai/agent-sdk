[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / Gauge

# Interface: Gauge

Defined in: [packages/agent-sdk/src/observability/metrics.ts:94](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L94)

A gauge metric that can go up and down.

## Methods

### dec()

> **dec**(`value?`: `number`, `labels?`: [`MetricLabels`](../type-aliases/MetricLabels.md)): `void`

Defined in: [packages/agent-sdk/src/observability/metrics.ts:100](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L100)

Decrement the gauge

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `value?` | `number` |
| `labels?` | [`MetricLabels`](../type-aliases/MetricLabels.md) |

#### Returns

`void`

***

### get()

> **get**(`labels?`: [`MetricLabels`](../type-aliases/MetricLabels.md)): `number`

Defined in: [packages/agent-sdk/src/observability/metrics.ts:102](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L102)

Get current value

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `labels?` | [`MetricLabels`](../type-aliases/MetricLabels.md) |

#### Returns

`number`

***

### inc()

> **inc**(`value?`: `number`, `labels?`: [`MetricLabels`](../type-aliases/MetricLabels.md)): `void`

Defined in: [packages/agent-sdk/src/observability/metrics.ts:98](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L98)

Increment the gauge

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `value?` | `number` |
| `labels?` | [`MetricLabels`](../type-aliases/MetricLabels.md) |

#### Returns

`void`

***

### set()

> **set**(`value`: `number`, `labels?`: [`MetricLabels`](../type-aliases/MetricLabels.md)): `void`

Defined in: [packages/agent-sdk/src/observability/metrics.ts:96](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L96)

Set the gauge value

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `value` | `number` |
| `labels?` | [`MetricLabels`](../type-aliases/MetricLabels.md) |

#### Returns

`void`
