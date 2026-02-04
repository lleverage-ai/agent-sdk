[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / GenerateResult

# Type Alias: GenerateResult

> **GenerateResult** = [`GenerateResultComplete`](../interfaces/GenerateResultComplete.md) \| [`GenerateResultInterrupted`](../interfaces/GenerateResultInterrupted.md)

Defined in: [packages/agent-sdk/src/types.ts:1414](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1414)

Result from a generation request.

This is a discriminated union - check `status` to determine the result type:
- `"complete"`: Generation finished successfully
- `"interrupted"`: Generation paused for user input

## Example

```typescript
const result = await agent.generate({ prompt, threadId });

if (result.status === "complete") {
  console.log(result.text);
} else {
  // Handle interrupt
  const response = await handleInterrupt(result.interrupt);
  return agent.resume(threadId, result.interrupt.id, response);
}
```
