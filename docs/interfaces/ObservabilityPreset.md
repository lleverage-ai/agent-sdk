[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ObservabilityPreset

# Interface: ObservabilityPreset

Defined in: [packages/agent-sdk/src/observability/preset.ts:105](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L105)

Result of creating an observability preset.

## Properties

### hooks?

> `optional` **hooks**: [`HookRegistration`](HookRegistration.md)

Defined in: [packages/agent-sdk/src/observability/preset.ts:129](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L129)

Hook registration to pass to agent.hooks (if enabled).

***

### logger?

> `optional` **logger**: [`Logger`](Logger.md)

Defined in: [packages/agent-sdk/src/observability/preset.ts:109](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L109)

The logger instance (if enabled).

***

### metrics?

> `optional` **metrics**: [`AgentMetrics`](AgentMetrics.md)

Defined in: [packages/agent-sdk/src/observability/preset.ts:119](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L119)

Agent-specific metrics helpers (if metrics enabled).

***

### metricsRegistry?

> `optional` **metricsRegistry**: [`MetricsRegistry`](MetricsRegistry.md)

Defined in: [packages/agent-sdk/src/observability/preset.ts:114](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L114)

The metrics registry (if enabled).

***

### tracer?

> `optional` **tracer**: [`Tracer`](Tracer.md)

Defined in: [packages/agent-sdk/src/observability/preset.ts:124](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L124)

The tracer instance (if enabled).
