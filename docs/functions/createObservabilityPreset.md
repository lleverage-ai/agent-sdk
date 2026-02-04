[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createObservabilityPreset

# Function: createObservabilityPreset()

> **createObservabilityPreset**(`options`: [`ObservabilityPresetOptions`](../interfaces/ObservabilityPresetOptions.md)): [`ObservabilityPreset`](../interfaces/ObservabilityPreset.md)

Defined in: [packages/agent-sdk/src/observability/preset.ts:198](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/preset.ts#L198)

Creates a complete observability setup with logger, metrics, tracer, and hooks.

This function provides a convenient way to set up comprehensive observability
for your agent in a single call. It returns configured observability primitives
and hooks that can be passed directly to `createAgent()`.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`ObservabilityPresetOptions`](../interfaces/ObservabilityPresetOptions.md) | Configuration options |

## Returns

[`ObservabilityPreset`](../interfaces/ObservabilityPreset.md)

Observability preset with logger, metrics, tracer, and hooks

## Examples

```typescript
import { createAgent, createObservabilityPreset } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";

// One-line observability setup
const observability = createObservabilityPreset({
  name: "my-agent",
});

// Create agent with full observability
const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  hooks: observability.hooks,
});

// Access observability primitives
observability.logger?.info("Agent started");
observability.metrics?.requests.inc();
const span = observability.tracer?.startSpan("custom-operation");
```

```typescript
// Customize observability setup
const observability = createObservabilityPreset({
  name: "my-agent",
  enableTracing: false, // Disable tracing
  loggerOptions: {
    level: "warn", // Only log warnings and errors
  },
  loggingHooksOptions: {
    logTiming: true,
    maxTextLength: 500,
  },
});
```

```typescript
// Export traces to OpenTelemetry collector
import { createOTLPSpanExporter } from "@lleverage-ai/agent-sdk";

const observability = createObservabilityPreset({
  name: "production-agent",
  spanExporters: [
    createOTLPSpanExporter({
      url: "http://localhost:4318/v1/traces",
    }),
  ],
});
```
