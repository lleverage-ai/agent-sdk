[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / executeSubagentsParallel

# Function: executeSubagentsParallel()

> **executeSubagentsParallel**(`tasks`: [`ParallelTask`](../interfaces/ParallelTask.md)[], `parentAgent`: [`Agent`](../interfaces/Agent.md), `onResult?`: (`result`: [`SubagentExecutionResult`](../interfaces/SubagentExecutionResult.md), `index`: `number`) => `void`): `Promise`&lt;[`ParallelExecutionResult`](../interfaces/ParallelExecutionResult.md)&gt;

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:663](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L663)

Executes multiple subagents in parallel.

All subagents share the same parent context initially.
After completion, file changes from all subagents are merged back.

Note: If multiple subagents modify the same file, the last one wins.
For better conflict handling, consider using different file paths.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `tasks` | [`ParallelTask`](../interfaces/ParallelTask.md)[] | Array of tasks to execute |
| `parentAgent` | [`Agent`](../interfaces/Agent.md) | Parent agent for configuration |
| `onResult?` | (`result`: [`SubagentExecutionResult`](../interfaces/SubagentExecutionResult.md), `index`: `number`) => `void` | Optional callback for each completed task |

## Returns

`Promise`&lt;[`ParallelExecutionResult`](../interfaces/ParallelExecutionResult.md)&gt;

Combined results from all executions

## Example

```typescript
const results = await executeSubagentsParallel(
  [
    {
      definition: researcherDef,
      prompt: "Research TypeScript history",
    },
    {
      definition: coderDef,
      prompt: "Write a utility function",
    },
  ],
  parentAgent,
  (result, index) => console.log(`Task ${index} completed`),
);

console.log(`${results.successCount}/${results.results.length} succeeded`);
```
