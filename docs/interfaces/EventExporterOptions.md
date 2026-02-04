[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / EventExporterOptions

# Interface: EventExporterOptions

Defined in: [packages/agent-sdk/src/observability/events.ts:62](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L62)

Options for event exporters.

## Properties

### includeStackTraces?

> `optional` **includeStackTraces**: `boolean`

Defined in: [packages/agent-sdk/src/observability/events.ts:67](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L67)

Whether to include full error stack traces

***

### minSeverity?

> `optional` **minSeverity**: [`EventSeverity`](../type-aliases/EventSeverity.md)

Defined in: [packages/agent-sdk/src/observability/events.ts:64](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L64)

Minimum severity to export
