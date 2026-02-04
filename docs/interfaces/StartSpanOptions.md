[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / StartSpanOptions

# Interface: StartSpanOptions

Defined in: [packages/agent-sdk/src/observability/tracing.ts:203](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L203)

Options for starting a span.

## Properties

### attributes?

> `optional` **attributes**: [`SpanAttributes`](../type-aliases/SpanAttributes.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:207](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L207)

Initial attributes

***

### kind?

> `optional` **kind**: [`SpanKind`](../type-aliases/SpanKind.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:205](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L205)

Span kind

***

### links?

> `optional` **links**: [`SpanLink`](SpanLink.md)[]

Defined in: [packages/agent-sdk/src/observability/tracing.ts:211](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L211)

Links to other spans

***

### parent?

> `optional` **parent**: [`SpanContext`](SpanContext.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:209](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L209)

Parent span context
