[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SpanLink

# Interface: SpanLink

Defined in: [packages/agent-sdk/src/observability/tracing.ts:60](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L60)

Span link (reference to another span).

## Properties

### attributes?

> `optional` **attributes**: [`SpanAttributes`](../type-aliases/SpanAttributes.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:66](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L66)

Optional attributes

***

### spanId

> **spanId**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:64](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L64)

Span ID of linked span

***

### traceId

> **traceId**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:62](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L62)

Trace ID of linked span
