[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / runWithGuardrails

# Function: runWithGuardrails()

> **runWithGuardrails**&lt;`T`&gt;(`text`: `string`, `guardrails`: [`Guardrail`](../type-aliases/Guardrail.md)[], `generateFn`: (`signal`: `AbortSignal`) => `Promise`&lt;`T`&gt;, `options`: [`RaceGuardrailsOptions`](../interfaces/RaceGuardrailsOptions.md)): `Promise`&lt;`T`&gt;

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:145](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L145)

Run guardrails in parallel with generation, aborting on first failure.

This is a convenience wrapper that sets up the abort controller and
coordinates guardrails with the generation function.

## Type Parameters

| Type Parameter |
| :------ |
| `T` |

## Parameters

| Parameter | Type |
| :------ | :------ |
| `text` | `string` |
| `guardrails` | [`Guardrail`](../type-aliases/Guardrail.md)[] |
| `generateFn` | (`signal`: `AbortSignal`) => `Promise`&lt;`T`&gt; |
| `options` | [`RaceGuardrailsOptions`](../interfaces/RaceGuardrailsOptions.md) |

## Returns

`Promise`&lt;`T`&gt;

## Example

```typescript
const result = await runWithGuardrails(
  extractText(messages),
  [regexGuardrail, llmGuardrail],
  (signal) => agent.generate({ messages, signal })
);
```
