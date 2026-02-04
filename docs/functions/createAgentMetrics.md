[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createAgentMetrics

# Function: createAgentMetrics()

> **createAgentMetrics**(`registry`: [`MetricsRegistry`](../interfaces/MetricsRegistry.md)): [`AgentMetrics`](../interfaces/AgentMetrics.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:662](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L662)

Creates pre-defined agent metrics.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `registry` | [`MetricsRegistry`](../interfaces/MetricsRegistry.md) | The metrics registry to use |

## Returns

[`AgentMetrics`](../interfaces/AgentMetrics.md)

Agent metrics object

## Example

```typescript
const registry = createMetricsRegistry();
const metrics = createAgentMetrics(registry);

// Use in agent hooks
hooks.on("PostGenerate", (ctx) => {
  metrics.requestsTotal.inc({ model: "claude-3" });
  if (ctx.data.type === "PostGenerate" && ctx.data.result.usage) {
    metrics.inputTokensTotal.inc(ctx.data.result.usage.inputTokens);
    metrics.outputTokensTotal.inc(ctx.data.result.usage.outputTokens);
  }
});
```
