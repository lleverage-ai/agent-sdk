[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / executeSubagent

# Function: executeSubagent()

> **executeSubagent**(`options`: [`SubagentExecutionOptions`](../interfaces/SubagentExecutionOptions.md)): `Promise`&lt;[`SubagentExecutionResult`](../interfaces/SubagentExecutionResult.md)&gt;

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:445](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L445)

Executes a subagent with isolated context.

Creates a subagent from the definition, executes the prompt,
and returns the result with the final context for merging.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`SubagentExecutionOptions`](../interfaces/SubagentExecutionOptions.md) | Execution options |

## Returns

`Promise`&lt;[`SubagentExecutionResult`](../interfaces/SubagentExecutionResult.md)&gt;

Execution result with context

## Example

```typescript
const result = await executeSubagent({
  definition: {
    type: "researcher",
    description: "Researches topics",
    systemPrompt: "You are a research assistant.",
  },
  prompt: "Research the history of TypeScript",
  parentAgent,
  hooks,
  onStep: (event) => console.log(`Step ${event.stepNumber}`),
});

if (result.success) {
  mergeSubagentContext(result.context);
  console.log(result.text);
}
```
