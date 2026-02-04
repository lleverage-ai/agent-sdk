[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ObservabilityPresetOptions

# Interface: ObservabilityPresetOptions

Defined in: [packages/agent-sdk/src/observability/preset.ts:42](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L42)

Options for creating an observability preset.

## Properties

### enableHooks?

> `optional` **enableHooks**: `boolean`

Defined in: [packages/agent-sdk/src/observability/preset.ts:71](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L71)

Whether to create hooks that wire the agent to the observability system.

#### Default Value

```ts
true
```

***

### enableLogging?

> `optional` **enableLogging**: `boolean`

Defined in: [packages/agent-sdk/src/observability/preset.ts:53](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L53)

Whether to enable logging.

#### Default Value

```ts
true
```

***

### enableMetrics?

> `optional` **enableMetrics**: `boolean`

Defined in: [packages/agent-sdk/src/observability/preset.ts:59](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L59)

Whether to enable metrics.

#### Default Value

```ts
true
```

***

### enableTracing?

> `optional` **enableTracing**: `boolean`

Defined in: [packages/agent-sdk/src/observability/preset.ts:65](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L65)

Whether to enable tracing.

#### Default Value

```ts
true
```

***

### loggerOptions?

> `optional` **loggerOptions**: `Partial`&lt;[`LoggerOptions`](LoggerOptions.md)&gt;

Defined in: [packages/agent-sdk/src/observability/preset.ts:76](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L76)

Logger options (overrides defaults).

***

### loggingHooksOptions?

> `optional` **loggingHooksOptions**: `Partial`&lt;[`GenerationLoggingHooksOptions`](GenerationLoggingHooksOptions.md)&gt;

Defined in: [packages/agent-sdk/src/observability/preset.ts:91](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L91)

Logging hooks options (overrides defaults).

***

### metricsOptions?

> `optional` **metricsOptions**: `Partial`&lt;[`MetricsRegistryOptions`](MetricsRegistryOptions.md)&gt;

Defined in: [packages/agent-sdk/src/observability/preset.ts:81](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L81)

Metrics registry options (overrides defaults).

***

### name?

> `optional` **name**: `string`

Defined in: [packages/agent-sdk/src/observability/preset.ts:47](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L47)

Name for the logger, tracer, and metrics (typically your agent name).

#### Default Value

```ts
"agent"
```

***

### spanExporters?

> `optional` **spanExporters**: [`SpanExporter`](SpanExporter.md)[]

Defined in: [packages/agent-sdk/src/observability/preset.ts:97](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L97)

Custom span exporters for tracing.
If not provided, defaults to console exporter.

***

### tracerOptions?

> `optional` **tracerOptions**: `Partial`&lt;[`TracerOptions`](TracerOptions.md)&gt;

Defined in: [packages/agent-sdk/src/observability/preset.ts:86](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L86)

Tracer options (overrides defaults).
