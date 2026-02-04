[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SpanExporter

# Interface: SpanExporter

Defined in: [packages/agent-sdk/src/observability/tracing.ts:167](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L167)

A span exporter sends spans to a backend.

## Properties

### name

> **name**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:169](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L169)

Exporter name

## Methods

### export()

> **export**(`spans`: [`SpanData`](SpanData.md)[]): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/tracing.ts:171](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L171)

Export spans

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `spans` | [`SpanData`](SpanData.md)[] |

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### flush()?

> `optional` **flush**(): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/tracing.ts:173](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L173)

Optional flush for batch exporters

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### shutdown()?

> `optional` **shutdown**(): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/tracing.ts:175](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L175)

Optional shutdown for cleanup

#### Returns

`void` \| `Promise`&lt;`void`&gt;
