[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / computeContentHash

# Function: computeContentHash()

> **computeContentHash**(`content`: `string`): `string`

Defined in: [packages/agent-sdk/src/memory/permissions.ts:143](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L143)

Compute SHA-256 hash of a string.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `content` | `string` | Content to hash |

## Returns

`string`

Hex-encoded hash

## Example

```typescript
const hash = computeContentHash("# My Memory\n\nContent here");
// Returns: "a1b2c3d4..."
```
