[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / TodoWriteToolOptions

# Interface: TodoWriteToolOptions

Defined in: [packages/agent-sdk/src/tools/todos.ts:77](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/todos.ts#L77)

Options for creating the todo_write tool.

## Properties

### onTodosChanged?

> `optional` **onTodosChanged**: [`OnTodosChanged`](../type-aliases/OnTodosChanged.md)

Defined in: [packages/agent-sdk/src/tools/todos.ts:96](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/todos.ts#L96)

Callback invoked when todos change.

Use this to integrate with the hook system for emitting `todos:changed` events.

#### Example

```typescript
const todoWrite = createTodoWriteTool({
  state,
  onTodosChanged: (data) => {
    console.log("Todos changed:", data);
  },
});
```

***

### state

> **state**: [`AgentState`](AgentState.md)

Defined in: [packages/agent-sdk/src/tools/todos.ts:79](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/todos.ts#L79)

The agent state containing the todo list
