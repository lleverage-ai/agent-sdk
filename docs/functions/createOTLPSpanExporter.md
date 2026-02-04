[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createOTLPSpanExporter

# Function: createOTLPSpanExporter()

> **createOTLPSpanExporter**(`options`: \{ `onExport`: (`payload`: `unknown`) => `void` \| `Promise`&lt;`void`&gt;; `serviceName?`: `string`; \}): [`SpanExporter`](../interfaces/SpanExporter.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:689](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L689)

Creates an OTLP-compatible exporter (OpenTelemetry Protocol).

This exporter formats spans for OTLP collectors but does not
include HTTP transport. Use with a custom callback for actual sending.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | \{ `onExport`: (`payload`: `unknown`) => `void` \| `Promise`&lt;`void`&gt;; `serviceName?`: `string`; \} | Exporter options |
| `options.onExport` | (`payload`: `unknown`) => `void` \| `Promise`&lt;`void`&gt; | Callback to handle OTLP payload |
| `options.serviceName?` | `string` | Service name |

## Returns

[`SpanExporter`](../interfaces/SpanExporter.md)

An OTLP-compatible exporter

## Example

```typescript
const exporter = createOTLPSpanExporter({
  onExport: async (payload) => {
    await fetch("http://collector:4318/v1/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
});
```
