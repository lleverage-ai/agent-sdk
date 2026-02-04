[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / getProjectMemoryPath

# Function: getProjectMemoryPath()

> **getProjectMemoryPath**(`workingDirectory`: `string`): `Promise`&lt;`string` \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/memory/loader.ts:246](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L246)

Get the project memory path based on git root.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `workingDirectory` | `string` | Current working directory |

## Returns

`Promise`&lt;`string` \| `undefined`&gt;

Path to project memory file, or undefined if not in git repo

## Example

```typescript
const projectMemoryPath = await getProjectMemoryPath("/path/to/project");
// Returns "/path/to/project/.deepagents/agent.md"
```
