[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / matchesAnyPathPattern

# Function: matchesAnyPathPattern()

> **matchesAnyPathPattern**(`filePath`: `string`, `patterns`: `string`[]): `boolean`

Defined in: [packages/agent-sdk/src/memory/rules.ts:100](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L100)

Check if a file path matches any of the given patterns.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | The file path to test |
| `patterns` | `string`[] | Array of glob patterns |

## Returns

`boolean`

True if the path matches any pattern

## Example

```typescript
const patterns = ["src/**/*.ts", "tests/**/*.ts"];
matchesAnyPathPattern("src/index.ts", patterns);   // true
matchesAnyPathPattern("README.md", patterns);      // false
```
