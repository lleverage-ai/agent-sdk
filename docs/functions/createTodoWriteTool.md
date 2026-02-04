[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createTodoWriteTool

# Function: createTodoWriteTool()

> **createTodoWriteTool**(`options`: [`TodoWriteToolOptions`](../interfaces/TodoWriteToolOptions.md)): [`Tool`](../type-aliases/Tool.md)&lt;\{ `todos`: [`TodoInput`](../interfaces/TodoInput.md)[]; \}, \{ `count`: `number`; `success`: `boolean`; `summary`: \{ `completed`: `number`; `inProgress`: `number`; `pending`: `number`; \}; \}&gt;

Defined in: [packages/agent-sdk/src/tools/todos.ts:178](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/todos.ts#L178)

Creates the todo_write tool for managing task lists.

This tool replaces the entire todo list with the provided items. It's designed
to match Claude Code's TodoWrite behavior where the agent always provides the
complete list state.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`TodoWriteToolOptions`](../interfaces/TodoWriteToolOptions.md) | Configuration options |

## Returns

[`Tool`](../type-aliases/Tool.md)&lt;\{ `todos`: [`TodoInput`](../interfaces/TodoInput.md)[]; \}, \{ `count`: `number`; `success`: `boolean`; `summary`: \{ `completed`: `number`; `inProgress`: `number`; `pending`: `number`; \}; \}&gt;

An AI SDK compatible tool for writing todos

## Examples

```typescript
import { createTodoWriteTool, createAgentState } from "@lleverage-ai/agent-sdk";

const state = createAgentState();
const todoWrite = createTodoWriteTool({ state });

const agent = createAgent({
  model,
  tools: { todo_write: todoWrite },
});
```

```typescript
// With change callback for UI integration
const todoWrite = createTodoWriteTool({
  state,
  onTodosChanged: (data) => {
    console.log(`Todos updated: ${data.summary.completed}/${data.totalCount} completed`);
  },
});
```
