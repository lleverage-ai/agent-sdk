[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / Guardrail

# Type Alias: Guardrail()

> **Guardrail** = (`text`: `string`, `signal?`: `AbortSignal`) => `Promise`&lt;[`GuardrailCheckResult`](../interfaces/GuardrailCheckResult.md)&gt; \| [`GuardrailCheckResult`](../interfaces/GuardrailCheckResult.md)

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:55](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L55)

A guardrail is a function that checks content and returns a result.

Guardrails can be sync or async. They receive the text to check and
an optional AbortSignal for cancellation.

## Parameters

| Parameter | Type |
| :------ | :------ |
| `text` | `string` |
| `signal?` | `AbortSignal` |

## Returns

`Promise`&lt;[`GuardrailCheckResult`](../interfaces/GuardrailCheckResult.md)&gt; \| [`GuardrailCheckResult`](../interfaces/GuardrailCheckResult.md)

## Example

```typescript
// Simple regex guardrail
const noSecrets: Guardrail = async (text) => ({
  blocked: /SECRET_API_KEY/i.test(text),
  reason: "Contains sensitive pattern",
});

// LLM-based guardrail
const llmModeration: Guardrail = async (text, signal) => {
  const result = await moderateWithLLM(text, { signal });
  return {
    blocked: result.flagged,
    reason: result.reason,
  };
};
```
