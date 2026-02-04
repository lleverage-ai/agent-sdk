[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createConsoleSpanExporter

# Function: createConsoleSpanExporter()

> **createConsoleSpanExporter**(): [`SpanExporter`](../interfaces/SpanExporter.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:587](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L587)

Creates a console exporter for debugging.

## Returns

[`SpanExporter`](../interfaces/SpanExporter.md)

A console span exporter

## Example

```typescript
const tracer = createTracer({
  exporters: [createConsoleSpanExporter()],
});
```
