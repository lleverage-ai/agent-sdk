[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / withTimeout

# Function: withTimeout()

> **withTimeout**(`guardrail`: [`Guardrail`](../type-aliases/Guardrail.md), `timeoutMs`: `number`, `failOpen`: `boolean`): [`Guardrail`](../type-aliases/Guardrail.md)

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:226](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L226)

Create a guardrail with a timeout.

If the guardrail doesn't complete within the timeout, it returns
a non-blocking result (fail-open behavior).

## Parameters

| Parameter | Type | Default value |
| :------ | :------ | :------ |
| `guardrail` | [`Guardrail`](../type-aliases/Guardrail.md) | `undefined` |
| `timeoutMs` | `number` | `undefined` |
| `failOpen` | `boolean` | `true` |

## Returns

[`Guardrail`](../type-aliases/Guardrail.md)

## Example

```typescript
const timedLLMGuardrail = withTimeout(llmGuardrail, 5000);
```
