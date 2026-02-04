[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / Counter

# Interface: Counter

Defined in: [packages/agent-sdk/src/observability/metrics.ts:80](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L80)

A counter metric that can only increase.

## Methods

### get()

> **get**(`labels?`: [`MetricLabels`](../type-aliases/MetricLabels.md)): `number`

Defined in: [packages/agent-sdk/src/observability/metrics.ts:84](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L84)

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

Defined in: [packages/agent-sdk/src/observability/metrics.ts:82](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L82)

Increment the counter

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `value?` | `number` |
| `labels?` | [`MetricLabels`](../type-aliases/MetricLabels.md) |

#### Returns

`void`

***

### reset()

> **reset**(`labels?`: [`MetricLabels`](../type-aliases/MetricLabels.md)): `void`

Defined in: [packages/agent-sdk/src/observability/metrics.ts:86](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L86)

Reset to zero

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `labels?` | [`MetricLabels`](../type-aliases/MetricLabels.md) |

#### Returns

`void`
