[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / findGitRoot

# Function: findGitRoot()

> **findGitRoot**(`fromPath`: `string`): `Promise`&lt;`string` \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/memory/loader.ts:219](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L219)

Find the git root directory from a given path.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `fromPath` | `string` | Starting path to search from |

## Returns

`Promise`&lt;`string` \| `undefined`&gt;

The git root path, or undefined if not in a git repo

## Example

```typescript
const gitRoot = await findGitRoot("/path/to/project/src/file.ts");
// Returns "/path/to/project" if that's the git root
```
