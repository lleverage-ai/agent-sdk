[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / isInterruptedResult

# Function: isInterruptedResult()

> **isInterruptedResult**(`result`: [`GenerateResult`](../type-aliases/GenerateResult.md)): `result is GenerateResultInterrupted`

Defined in: [packages/agent-sdk/src/types.ts:1461](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1461)

Type guard to check if a generation result is interrupted.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `result` | [`GenerateResult`](../type-aliases/GenerateResult.md) | The generation result to check |

## Returns

`result is GenerateResultInterrupted`

True if the result is an interrupted result

## Example

```typescript
const result = await agent.generate({ prompt, threadId });

if (isInterruptedResult(result)) {
  const { interrupt } = result;
  // Handle the interrupt...
}
```
