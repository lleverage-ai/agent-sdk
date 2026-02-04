[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / BackgroundTask

# Interface: BackgroundTask

Defined in: [packages/agent-sdk/src/task-store/types.ts:54](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L54)

Complete snapshot of a background task's state.

A background task captures the execution state of an async subagent,
including:
- Task metadata (ID, type, description)
- Current status and timestamps
- Result or error information
- Optional metadata for custom data

## Example

```typescript
const task: BackgroundTask = {
  id: "task-123",
  subagentType: "researcher",
  description: "Research TypeScript history",
  status: "running",
  createdAt: "2026-01-30T10:00:00Z",
  updatedAt: "2026-01-30T10:05:00Z",
};
```

## Properties

### completedAt?

> `optional` **completedAt**: `string`

Defined in: [packages/agent-sdk/src/task-store/types.ts:74](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L74)

ISO 8601 timestamp when this task completed (if completed/failed)

***

### createdAt

> **createdAt**: `string`

Defined in: [packages/agent-sdk/src/task-store/types.ts:68](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L68)

ISO 8601 timestamp when this task was created

***

### description

> **description**: `string`

Defined in: [packages/agent-sdk/src/task-store/types.ts:62](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L62)

Task description/prompt

***

### error?

> `optional` **error**: `string`

Defined in: [packages/agent-sdk/src/task-store/types.ts:80](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L80)

Error message (when failed)

***

### id

> **id**: `string`

Defined in: [packages/agent-sdk/src/task-store/types.ts:56](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L56)

Unique identifier for this task

***

### metadata?

> `optional` **metadata**: `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/task-store/types.ts:83](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L83)

Optional metadata for custom data

***

### result?

> `optional` **result**: `string`

Defined in: [packages/agent-sdk/src/task-store/types.ts:77](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L77)

Result text (when completed)

***

### status

> **status**: [`BackgroundTaskStatus`](../type-aliases/BackgroundTaskStatus.md)

Defined in: [packages/agent-sdk/src/task-store/types.ts:65](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L65)

Current status

***

### subagentType

> **subagentType**: `string`

Defined in: [packages/agent-sdk/src/task-store/types.ts:59](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L59)

Type of subagent handling this task

***

### updatedAt

> **updatedAt**: `string`

Defined in: [packages/agent-sdk/src/task-store/types.ts:71](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L71)

ISO 8601 timestamp when this task was last updated
