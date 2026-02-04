[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / shouldExpireTask

# Function: shouldExpireTask()

> **shouldExpireTask**(`task`: [`BackgroundTask`](../interfaces/BackgroundTask.md), `expirationMs`: `number`): `boolean`

Defined in: [packages/agent-sdk/src/task-store/types.ts:312](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/task-store/types.ts#L312)

Check if a task should be expired based on age and status.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `task` | [`BackgroundTask`](../interfaces/BackgroundTask.md) | The task to check |
| `expirationMs` | `number` | Expiration time in milliseconds |

## Returns

`boolean`

True if the task should be expired
