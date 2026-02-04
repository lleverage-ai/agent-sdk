[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / computeFileHash

# Function: computeFileHash()

> **computeFileHash**(`filePath`: `string`): `Promise`&lt;`string` \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:160](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L160)

Compute content hash from a file path.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | Path to the file |

## Returns

`Promise`&lt;`string` \| `undefined`&gt;

Hex-encoded hash, or undefined if file doesn't exist

## Example

```typescript
const hash = await computeFileHash("/path/to/memory.md");
```
