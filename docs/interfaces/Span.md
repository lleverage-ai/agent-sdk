[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / Span

# Interface: Span

Defined in: [packages/agent-sdk/src/observability/tracing.ts:118](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L118)

An active span that can be modified.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:124](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L124)

Span name

***

### spanId

> `readonly` **spanId**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:122](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L122)

Span ID

***

### traceId

> `readonly` **traceId**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:120](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L120)

Trace ID

## Methods

### addEvent()

> **addEvent**(`name`: `string`, `attributes?`: [`SpanAttributes`](../type-aliases/SpanAttributes.md)): `Span`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:131](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L131)

Add an event

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `name` | `string` |
| `attributes?` | [`SpanAttributes`](../type-aliases/SpanAttributes.md) |

#### Returns

`Span`

***

### addLink()

> **addLink**(`traceId`: `string`, `spanId`: `string`, `attributes?`: [`SpanAttributes`](../type-aliases/SpanAttributes.md)): `Span`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:133](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L133)

Add a link to another span

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `traceId` | `string` |
| `spanId` | `string` |
| `attributes?` | [`SpanAttributes`](../type-aliases/SpanAttributes.md) |

#### Returns

`Span`

***

### end()

> **end**(): `void`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:139](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L139)

End the span

#### Returns

`void`

***

### getData()

> **getData**(): [`SpanData`](SpanData.md) \| `null`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:141](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L141)

Get span data (only valid after end)

#### Returns

[`SpanData`](SpanData.md) \| `null`

***

### isRecording()

> **isRecording**(): `boolean`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:143](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L143)

Check if span is recording

#### Returns

`boolean`

***

### recordException()

> **recordException**(`error`: `Error`, `attributes?`: [`SpanAttributes`](../type-aliases/SpanAttributes.md)): `Span`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:137](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L137)

Record an exception

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `error` | `Error` |
| `attributes?` | [`SpanAttributes`](../type-aliases/SpanAttributes.md) |

#### Returns

`Span`

***

### setAttribute()

> **setAttribute**(`key`: `string`, `value`: `string` \| `number` \| `boolean`): `Span`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:127](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L127)

Set an attribute

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `key` | `string` |
| `value` | `string` \| `number` \| `boolean` |

#### Returns

`Span`

***

### setAttributes()

> **setAttributes**(`attributes`: [`SpanAttributes`](../type-aliases/SpanAttributes.md)): `Span`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:129](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L129)

Set multiple attributes

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `attributes` | [`SpanAttributes`](../type-aliases/SpanAttributes.md) |

#### Returns

`Span`

***

### setStatus()

> **setStatus**(`code`: [`SpanStatusCode`](../type-aliases/SpanStatusCode.md), `message?`: `string`): `Span`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:135](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L135)

Set status

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `code` | [`SpanStatusCode`](../type-aliases/SpanStatusCode.md) |
| `message?` | `string` |

#### Returns

`Span`
