[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / GrepMatch

# Interface: GrepMatch

Defined in: [packages/agent-sdk/src/backend.ts:77](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L77)

A match from a grep search operation.

## Example

```typescript
const matches = await backend.grepRaw("TODO:", "/src");
for (const match of matches) {
  console.log(`${match.path}:${match.line}: ${match.text}`);
}
```

## Properties

### line

> **line**: `number`

Defined in: [packages/agent-sdk/src/backend.ts:82](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L82)

Line number (1-indexed)

***

### path

> **path**: `string`

Defined in: [packages/agent-sdk/src/backend.ts:79](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L79)

Path to the file containing the match

***

### text

> **text**: `string`

Defined in: [packages/agent-sdk/src/backend.ts:85](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L85)

The matching line text
