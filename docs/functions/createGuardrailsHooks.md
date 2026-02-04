[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createGuardrailsHooks

# Function: createGuardrailsHooks()

> **createGuardrailsHooks**(`options`: [`GuardrailsHooksOptions`](../interfaces/GuardrailsHooksOptions.md)): \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]

Defined in: [packages/agent-sdk/src/hooks/guardrails.ts:194](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/guardrails.ts#L194)

Creates guardrails hooks for input and output content filtering.

The PreGenerate hook blocks requests matching input patterns.
The PostGenerate hook filters output matching output patterns.

This replaces guardrails middleware with hook-based filtering that
works correctly with the unified hook system.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`GuardrailsHooksOptions`](../interfaces/GuardrailsHooksOptions.md) | Configuration options |

## Returns

\[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]

Array of two hooks: [PreGenerate input filter, PostGenerate output filter]

## Examples

```typescript
const [inputFilter, outputFilter] = createGuardrailsHooks({
  blockedInputPatterns: [
    /password/i,
    /api.?key/i,
    /secret/i,
  ],
  blockedOutputPatterns: [
    /\b\d{16}\b/,  // Credit card numbers
    /\b\d{3}-\d{2}-\d{4}\b/,  // SSN
  ],
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
// Custom validation with transformation
const hooks = createGuardrailsHooks({
  checkInput: (input) => {
    // Allow but transform: remove PII from messages
    const cleaned = cleanPII(input.options.messages);
    return {
      ...input,
      options: { ...input.options, messages: cleaned },
    };
  },
  checkOutput: (input) => {
    // Filter harmful content
    if (isHarmful(input.result.text)) {
      return { ...input.result, text: "[Content filtered for safety]" };
    }
  },
});
```
