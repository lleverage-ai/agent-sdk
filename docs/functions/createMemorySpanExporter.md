[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createMemorySpanExporter

# Function: createMemorySpanExporter()

> **createMemorySpanExporter**(): [`SpanExporter`](../interfaces/SpanExporter.md) & \{ `spans`: [`SpanData`](../interfaces/SpanData.md)[]; `clear`: `void`; \}

Defined in: [packages/agent-sdk/src/observability/tracing.ts:623](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L623)

Creates a memory exporter that stores spans.

## Returns

[`SpanExporter`](../interfaces/SpanExporter.md) & \{ `spans`: [`SpanData`](../interfaces/SpanData.md)[]; `clear`: `void`; \}

A memory span exporter with access to stored spans

## Example

```typescript
const exporter = createMemorySpanExporter();
const tracer = createTracer({ exporters: [exporter] });

tracer.startSpan("test").end();
await tracer.flush();

console.log(exporter.spans);
```
