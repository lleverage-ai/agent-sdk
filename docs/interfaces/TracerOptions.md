[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / TracerOptions

# Interface: TracerOptions

Defined in: [packages/agent-sdk/src/observability/tracing.ts:183](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L183)

Options for creating a tracer.

## Properties

### defaultAttributes?

> `optional` **defaultAttributes**: [`SpanAttributes`](../type-aliases/SpanAttributes.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:189](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L189)

Default attributes for all spans

***

### enabled?

> `optional` **enabled**: `boolean`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:193](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L193)

Whether to enable tracing

***

### exporters?

> `optional` **exporters**: [`SpanExporter`](SpanExporter.md)[]

Defined in: [packages/agent-sdk/src/observability/tracing.ts:191](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L191)

Span exporters

***

### name?

> `optional` **name**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:185](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L185)

Tracer/service name

***

### samplingRate?

> `optional` **samplingRate**: `number`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:195](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L195)

Sampling rate (0-1)

***

### version?

> `optional` **version**: `string`

Defined in: [packages/agent-sdk/src/observability/tracing.ts:187](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L187)

Tracer version
