[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createCallbackSpanExporter

# Function: createCallbackSpanExporter()

> **createCallbackSpanExporter**(`callback`: (`spans`: [`SpanData`](../interfaces/SpanData.md)[]) => `void` \| `Promise`&lt;`void`&gt;): [`SpanExporter`](../interfaces/SpanExporter.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:656](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L656)

Creates a callback exporter that invokes a function for each batch.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `callback` | (`spans`: [`SpanData`](../interfaces/SpanData.md)[]) => `void` \| `Promise`&lt;`void`&gt; | Function to call with spans |

## Returns

[`SpanExporter`](../interfaces/SpanExporter.md)

A callback span exporter

## Example

```typescript
const exporter = createCallbackSpanExporter((spans) => {
  sendToJaeger(spans);
});
```
