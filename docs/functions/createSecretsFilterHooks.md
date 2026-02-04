[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createSecretsFilterHooks

# Function: createSecretsFilterHooks()

> **createSecretsFilterHooks**(`options`: [`SecretsFilterHooksOptions`](../interfaces/SecretsFilterHooksOptions.md)): \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]

Defined in: [packages/agent-sdk/src/hooks/secrets.ts:237](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/secrets.ts#L237)

Creates secrets filtering hooks for input and output.

The PreGenerate hook redacts secrets from input messages before sending
to the model. The PostGenerate hook redacts secrets from model responses.

This addresses the secrets redaction requirement from CODE_REVIEW.md
using the unified hook system.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`SecretsFilterHooksOptions`](../interfaces/SecretsFilterHooksOptions.md) | Configuration options |

## Returns

\[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]

Array of two hooks: [PreGenerate input filter, PostGenerate output filter]

## Examples

```typescript
const [inputFilter, outputFilter] = createSecretsFilterHooks({
  redactionText: "***REDACTED***",
});

const agent = createAgent({
  model,
  hooks: {
    PreGenerate: [{ hooks: [inputFilter] }],
    PostGenerate: [{ hooks: [outputFilter] }],
  },
});
```

```typescript
// Custom patterns with alerting
const hooks = createSecretsFilterHooks({
  customPatterns: [/my-secret-format-[A-Z0-9]{16}/g],
  onSecretDetected: (type, pattern, match) => {
    console.warn(`Secret detected in ${type}:`, pattern.source);
    alertSecurityTeam({ type, pattern: pattern.source });
  },
});
```

```typescript
// Only specific patterns
const hooks = createSecretsFilterHooks({
  patterns: [
    COMMON_SECRET_PATTERNS.AWS_ACCESS_KEY,
    COMMON_SECRET_PATTERNS.GITHUB_TOKEN,
  ],
});
```
