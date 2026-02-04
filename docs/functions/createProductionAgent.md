[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createProductionAgent

# Function: createProductionAgent()

> **createProductionAgent**(`options`: [`ProductionAgentOptions`](../interfaces/ProductionAgentOptions.md)): [`ProductionAgentResult`](../interfaces/ProductionAgentResult.md)

Defined in: [packages/agent-sdk/src/presets/production.ts:202](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L202)

Creates a production-ready agent with security, observability, and recommended hooks.

This function provides a convenient way to create an agent configured for production
deployment in a single call. It combines:
- Security policy presets (sandbox, permissions, tool restrictions)
- Observability (logging, metrics, tracing)
- Secrets filtering to prevent credential leakage
- Optional guardrails for content filtering

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`ProductionAgentOptions`](../interfaces/ProductionAgentOptions.md) | Configuration options |

## Returns

[`ProductionAgentResult`](../interfaces/ProductionAgentResult.md)

Production agent and observability preset

## Examples

```typescript
import { createProductionAgent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";

// One-line production agent setup
const { agent, observability } = createProductionAgent({
  model: anthropic("claude-sonnet-4-20250514"),
});

// Access observability primitives
observability.logger?.info("Agent started");
observability.metrics?.requests.inc();
```

```typescript
// Customize security and observability
const { agent } = createProductionAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  securityPreset: "readonly", // Maximum restrictions
  enableGuardrails: true, // Enable content filtering
  blockedInputPatterns: [/ignore.*instructions/i],
  observabilityOptions: {
    name: "my-production-agent",
    loggerOptions: { level: "warn" },
  },
});
```

```typescript
// Add custom plugins and checkpointers
const { agent, observability } = createProductionAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  additionalOptions: {
    plugins: [myCustomPlugin],
    checkpointer: createMemorySaver(),
    systemPrompt: "You are a helpful assistant.",
  },
});
```
