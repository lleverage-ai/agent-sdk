[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createTaskTool

# Function: createTaskTool()

> **createTaskTool**(`options`: [`TaskToolOptions_Tool`](../interfaces/TaskToolOptions_Tool.md)): [`Tool`](../type-aliases/Tool.md)

Defined in: [packages/agent-sdk/src/tools/task.ts:470](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L470)

Creates the task tool for delegating work to specialized subagents.

This tool delegates tasks to subagents with isolated context. It supports
both foreground (blocking) and background execution.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`TaskToolOptions_Tool`](../interfaces/TaskToolOptions_Tool.md) | Configuration options |

## Returns

[`Tool`](../type-aliases/Tool.md)

An AI SDK tool for task delegation

## Example

```typescript
import { createTaskTool } from "@lleverage-ai/agent-sdk";

const task = createTaskTool({
  subagents: [
    {
      type: "researcher",
      description: "Searches for information",
      create: () => createSubagent(parentAgent, { ... }),
    },
    {
      type: "coder",
      description: "Writes and modifies code",
      create: () => createSubagent(parentAgent, { ... }),
    },
  ],
  defaultModel: anthropic("claude-sonnet-4-20250514"),
  parentAgent,
  includeGeneralPurpose: true,
});

const agent = createAgent({
  model,
  tools: { task },
});
```
