[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / raceGuardrails

# Function: raceGuardrails()

> **raceGuardrails**(`text`: `string`, `guardrails`: [`Guardrail`](../type-aliases/Guardrail.md)[], `signal?`: `AbortSignal`, `options?`: [`RaceGuardrailsOptions`](../interfaces/RaceGuardrailsOptions.md)): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:104](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L104)

Race multiple guardrails - first failure blocks, all run in parallel.

Returns a Promise that resolves when all guardrails pass, or rejects
with GeneratePermissionDeniedError if any guardrail blocks.

## Parameters

| Parameter | Type |
| :------ | :------ |
| `text` | `string` |
| `guardrails` | [`Guardrail`](../type-aliases/Guardrail.md)[] |
| `signal?` | `AbortSignal` |
| `options?` | [`RaceGuardrailsOptions`](../interfaces/RaceGuardrailsOptions.md) |

## Returns

`Promise`&lt;`void`&gt;

## Example

```typescript
const controller = new AbortController();

// Start guardrails and generation in parallel
const guardrailsPromise = raceGuardrails(
  text,
  [regexGuardrail, llmGuardrail],
  controller.signal,
  {
    blockedMessage: "Content blocked",
    onBlock: () => controller.abort(),
  }
);

const generation = agent.streamRaw({
  messages,
  signal: controller.signal,
});

// Wait for guardrails to pass (or throw)
await guardrailsPromise;
```
