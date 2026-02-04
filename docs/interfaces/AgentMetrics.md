[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / AgentMetrics

# Interface: AgentMetrics

Defined in: [packages/agent-sdk/src/observability/metrics.ts:612](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L612)

Pre-defined metrics for agent SDK.

## Properties

### checkpointsTotal

> **checkpointsTotal**: [`Counter`](Counter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:636](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L636)

Checkpoint operations

***

### compactionsTotal

> **compactionsTotal**: [`Counter`](Counter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:634](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L634)

Context compactions

***

### errorsTotal

> **errorsTotal**: [`Counter`](Counter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:632](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L632)

Errors by type

***

### inputTokensTotal

> **inputTokensTotal**: [`Counter`](Counter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:620](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L620)

Input tokens used

***

### outputTokensTotal

> **outputTokensTotal**: [`Counter`](Counter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:622](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L622)

Output tokens used

***

### requestDurationMs

> **requestDurationMs**: [`Histogram`](Histogram.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:618](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L618)

Request duration in milliseconds

***

### requestsInProgress

> **requestsInProgress**: [`Gauge`](Gauge.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:616](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L616)

Requests in progress

***

### requestsTotal

> **requestsTotal**: [`Counter`](Counter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:614](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L614)

Total requests made

***

### subagentSpawnsTotal

> **subagentSpawnsTotal**: [`Counter`](Counter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:630](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L630)

Subagent spawns

***

### tokensTotal

> **tokensTotal**: [`Counter`](Counter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:624](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L624)

Total tokens used

***

### toolCallsTotal

> **toolCallsTotal**: [`Counter`](Counter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:626](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L626)

Tool calls made

***

### toolErrorsTotal

> **toolErrorsTotal**: [`Counter`](Counter.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:628](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L628)

Tool call errors
