[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / Tracer

# Interface: Tracer

Defined in: [packages/agent-sdk/src/observability/tracing.ts:219](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L219)

A tracer creates and manages spans.

## Properties

### enabled

> `readonly` **enabled**: `boolean`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:223](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L223)

Whether tracing is enabled

***

### name

> `readonly` **name**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:221](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L221)

Tracer name

## Methods

### flush()

> **flush**(): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/tracing.ts:242](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L242)

Export all pending spans

#### Returns

`Promise`&lt;`void`&gt;

***

### getActiveSpan()

> **getActiveSpan**(): [`Span`](Span.md) \| `null`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:239](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L239)

Get the current active span (if any)

#### Returns

[`Span`](Span.md) \| `null`

***

### shutdown()

> **shutdown**(): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/tracing.ts:245](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L245)

Shutdown the tracer

#### Returns

`Promise`&lt;`void`&gt;

***

### startSpan()

> **startSpan**(`name`: `string`, `options?`: [`StartSpanOptions`](StartSpanOptions.md)): [`Span`](Span.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:226](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L226)

Start a new span

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `name` | `string` |
| `options?` | [`StartSpanOptions`](StartSpanOptions.md) |

#### Returns

[`Span`](Span.md)

***

### withSpan()

> **withSpan**&lt;`T`&gt;(`name`: `string`, `fn`: (`span`: [`Span`](Span.md)) => `T` \| `Promise`&lt;`T`&gt;, `options?`: [`StartSpanOptions`](StartSpanOptions.md)): `Promise`&lt;`T`&gt;

Defined in: [packages/agent-sdk/src/observability/tracing.ts:232](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L232)

Execute a function within a span.
The span is automatically ended when the function completes.

#### Type Parameters

| Type Parameter |
| :------ |
| `T` |

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `name` | `string` |
| `fn` | (`span`: [`Span`](Span.md)) => `T` \| `Promise`&lt;`T`&gt; |
| `options?` | [`StartSpanOptions`](StartSpanOptions.md) |

#### Returns

`Promise`&lt;`T`&gt;
