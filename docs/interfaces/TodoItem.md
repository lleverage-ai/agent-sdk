[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / TodoItem

# Interface: TodoItem

Defined in: [packages/agent-sdk/src/backends/state.ts:60](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L60)

A single todo item for task tracking.

## Example

```typescript
const todo: TodoItem = {
  id: "todo-1",
  content: "Implement feature X",
  status: "in_progress",
  createdAt: "2026-01-30T10:00:00Z",
};
```

## Properties

### completedAt?

> `optional` **completedAt**: `string`

Defined in: [packages/agent-sdk/src/backends/state.ts:74](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L74)

ISO 8601 timestamp when the todo was completed (if applicable)

***

### content

> **content**: `string`

Defined in: [packages/agent-sdk/src/backends/state.ts:65](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L65)

Description of the task

***

### createdAt

> **createdAt**: `string`

Defined in: [packages/agent-sdk/src/backends/state.ts:71](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L71)

ISO 8601 timestamp when the todo was created

***

### id

> **id**: `string`

Defined in: [packages/agent-sdk/src/backends/state.ts:62](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L62)

Unique identifier for this todo

***

### status

> **status**: [`TodoStatus`](../type-aliases/TodoStatus.md)

Defined in: [packages/agent-sdk/src/backends/state.ts:68](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L68)

Current status of the task
