[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SpanData

# Interface: SpanData

Defined in: [packages/agent-sdk/src/observability/tracing.ts:86](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L86)

A completed span data structure.

## Properties

### attributes

> **attributes**: [`SpanAttributes`](../type-aliases/SpanAttributes.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:104](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L104)

Span attributes

***

### durationMs

> **durationMs**: `number`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:102](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L102)

Duration in milliseconds

***

### endTime

> **endTime**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:100](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L100)

End time (ISO string)

***

### events

> **events**: [`SpanEvent`](SpanEvent.md)[]

Defined in: [packages/agent-sdk/src/observability/tracing.ts:106](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L106)

Span events

***

### kind

> **kind**: [`SpanKind`](../type-aliases/SpanKind.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:96](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L96)

Span kind

***

### links

> **links**: [`SpanLink`](SpanLink.md)[]

Defined in: [packages/agent-sdk/src/observability/tracing.ts:108](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L108)

Span links

***

### name

> **name**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:94](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L94)

Span name/operation

***

### parentSpanId?

> `optional` **parentSpanId**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:92](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L92)

Parent span ID (if any)

***

### spanId

> **spanId**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:90](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L90)

Unique span identifier

***

### startTime

> **startTime**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:98](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L98)

Start time (ISO string)

***

### status

> **status**: [`SpanStatus`](SpanStatus.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:110](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L110)

Span status

***

### traceId

> **traceId**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:88](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L88)

Unique trace identifier
