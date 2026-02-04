[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createSubagentContext

# Function: createSubagentContext()

> **createSubagentContext**(`options`: [`SubagentContextOptions`](../interfaces/SubagentContextOptions.md)): [`SubagentContext`](../interfaces/SubagentContext.md)

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:359](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L359)

Creates an isolated context for subagent execution.

By default:
- Files are shared (subagent sees parent's files)
- Todos are isolated (subagent gets empty todos)

This follows the DeepAgentSDK pattern where files represent shared
work product but todos represent the agent's internal planning.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`SubagentContextOptions`](../interfaces/SubagentContextOptions.md) | Context creation options |

## Returns

[`SubagentContext`](../interfaces/SubagentContext.md)

Isolated subagent context

## Example

```typescript
const context = createSubagentContext({
  parentState: parentAgent.state,
  shareFiles: true,
  isolateTodos: true,
});

// Subagent can see parent's files
// Subagent has empty todos
```
