[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / getUserMemoryPath

# Function: getUserMemoryPath()

> **getUserMemoryPath**(`agentId`: `string`, `homeDir?`: `string`): `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:272](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L272)

Get the user memory path for an agent.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `agentId` | `string` | The agent identifier |
| `homeDir?` | `string` | Optional home directory override |

## Returns

`string`

Path to user memory file

## Example

```typescript
const userMemoryPath = getUserMemoryPath("my-agent");
// Returns "/home/user/.deepagents/my-agent/agent.md"
```
