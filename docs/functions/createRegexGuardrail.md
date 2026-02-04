[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createRegexGuardrail

# Function: createRegexGuardrail()

> **createRegexGuardrail**(`patterns`: `RegExp`[], `reason?`: `string`): [`Guardrail`](../type-aliases/Guardrail.md)

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:198](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L198)

Create a regex-based guardrail.

## Parameters

| Parameter | Type |
| :------ | :------ |
| `patterns` | `RegExp`[] |
| `reason?` | `string` |

## Returns

[`Guardrail`](../type-aliases/Guardrail.md)

## Example

```typescript
const noSecrets = createRegexGuardrail([
  /SECRET_API_KEY/i,
  /password\s*=\s*["'][^"']+["']/i,
], "Contains sensitive data");
```
