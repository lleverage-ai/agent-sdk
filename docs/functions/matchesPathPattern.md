[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / matchesPathPattern

# Function: matchesPathPattern()

> **matchesPathPattern**(`filePath`: `string`, `pattern`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/memory/rules.ts:55](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L55)

Check if a file path matches a glob pattern.

Supports standard glob patterns:
- `*` - matches any characters except /
- `**` - matches any characters including /
- `?` - matches exactly one character except /
- `[abc]` - matches any character in the brackets
- `[!abc]` - matches any character not in the brackets

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `filePath` | `string` | The file path to test |
| `pattern` | `string` | The glob pattern to match against |

## Returns

`boolean`

True if the path matches the pattern

## Example

```typescript
matchesPathPattern("src/api/users.ts", "src/**/*.ts");     // true
matchesPathPattern("src/api/users.ts", "src/api/*.ts");     // true
matchesPathPattern("src/api/users.ts", "tests/**/*.ts");   // false
matchesPathPattern("src/api/users.ts", "**/*.ts");         // true
matchesPathPattern("README.md", "*.md");                    // true
```
