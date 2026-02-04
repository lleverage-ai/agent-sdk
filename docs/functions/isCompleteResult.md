[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / isCompleteResult

# Function: isCompleteResult()

> **isCompleteResult**(`result`: [`GenerateResult`](../type-aliases/GenerateResult.md)): `result is GenerateResultComplete`

Defined in: [packages/agent-sdk/src/types.ts:1439](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1439)

Type guard to check if a generation result is complete.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `result` | [`GenerateResult`](../type-aliases/GenerateResult.md) | The generation result to check |

## Returns

`result is GenerateResultComplete`

True if the result is a complete result

## Example

```typescript
const result = await agent.generate({ prompt, threadId });

if (isCompleteResult(result)) {
  console.log("Generation complete:", result.text);
} else {
  console.log("Generation interrupted:", result.interrupt.type);
}
```
