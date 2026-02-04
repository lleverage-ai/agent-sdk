[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / mergeSubagentContext

# Function: mergeSubagentContext()

> **mergeSubagentContext**(`context`: [`SubagentContext`](../interfaces/SubagentContext.md)): `void`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:396](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L396)

Merges subagent context changes back to parent.

Only file changes are merged back (if files were shared).
Todo changes are NOT merged (todos are isolated by design).

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `context` | [`SubagentContext`](../interfaces/SubagentContext.md) | The subagent context to merge |

## Returns

`void`

## Example

```typescript
// After subagent completes
mergeSubagentContext(result.context);

// Parent now has any files the subagent created/modified
```
