[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createSecureProductionAgent

# Function: createSecureProductionAgent()

> **createSecureProductionAgent**(`options`: [`SecureProductionAgentOptions`](../interfaces/SecureProductionAgentOptions.md)): [`ProductionAgentResult`](../interfaces/ProductionAgentResult.md)

Defined in: [packages/agent-sdk/src/presets/production.ts:436](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L436)

Creates a secure production-ready agent with all security features enabled by default.

This is the **recommended entry point** for production deployments. It provides:
- Production security policy (blocks dangerous commands, limits file operations)
- **Guardrails enabled by default** (content filtering for inputs and outputs)
- Secrets filtering to prevent credential leakage
- Full observability (logging, metrics, tracing)

Use this instead of `createProductionAgent()` unless you have specific reasons
to disable guardrails or want more permissive defaults.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`SecureProductionAgentOptions`](../interfaces/SecureProductionAgentOptions.md) | Configuration options |

## Returns

[`ProductionAgentResult`](../interfaces/ProductionAgentResult.md)

Secure production agent and observability preset

## Examples

```typescript
import { createSecureProductionAgent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";

// Recommended production setup - all security features enabled
const { agent, observability } = createSecureProductionAgent({
  model: anthropic("claude-sonnet-4-20250514"),
});

// Use the agent
const result = await agent.generate({
  prompt: "Help me with a task",
});

// Access observability
observability.logger?.info("Request completed");
observability.metrics?.requests.inc();
```

```typescript
// Customize with additional blocked patterns
const { agent } = createSecureProductionAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  blockedInputPatterns: [
    /confidential/i,  // Additional custom pattern
  ],
  blockedOutputPatterns: [
    /internal-only/i,
  ],
  observabilityOptions: {
    name: "my-secure-agent",
  },
});
```

```typescript
// Disable default patterns, use only custom ones
const { agent } = createSecureProductionAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  useDefaultInputPatterns: false,
  useDefaultOutputPatterns: false,
  blockedInputPatterns: [/my-custom-pattern/],
  blockedOutputPatterns: [/another-pattern/],
});
```

```typescript
// Add custom plugins and system prompt
const { agent, observability } = createSecureProductionAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  additionalOptions: {
    plugins: [myCustomPlugin],
    systemPrompt: "You are a helpful assistant.",
    checkpointer: createMemorySaver(),
  },
});
```
