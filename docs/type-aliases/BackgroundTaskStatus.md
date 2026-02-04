[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / BackgroundTaskStatus

# Type Alias: BackgroundTaskStatus

> **BackgroundTaskStatus** = `"pending"` \| `"running"` \| `"completed"` \| `"failed"`

Defined in: [packages/agent-sdk/src/task-store/types.ts:24](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L24)

Status of a background task.

- `pending`: Task created but not yet started
- `running`: Task is currently executing
- `completed`: Task finished successfully
- `failed`: Task encountered an error
