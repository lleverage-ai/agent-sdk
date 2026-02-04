[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createTracer

# Function: createTracer()

> **createTracer**(`options`: [`TracerOptions`](../interfaces/TracerOptions.md)): [`Tracer`](../interfaces/Tracer.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:449](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L449)

Creates a tracer for distributed tracing.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`TracerOptions`](../interfaces/TracerOptions.md) | Tracer options |

## Returns

[`Tracer`](../interfaces/Tracer.md)

A tracer instance

## Example

```typescript
const tracer = createTracer({
  name: "my-agent",
  exporters: [createConsoleSpanExporter()],
});

const span = tracer.startSpan("generate");
try {
  const result = await agent.generate({ prompt: "Hello" });
  span.setAttribute("tokens", result.usage?.totalTokens ?? 0);
  span.setStatus("ok");
} catch (error) {
  span.recordException(error as Error);
} finally {
  span.end();
}
```
