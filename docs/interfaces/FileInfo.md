[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FileInfo

# Interface: FileInfo

Defined in: [packages/agent-sdk/src/backend.ts:28](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L28)

Metadata for a file or directory entry.

## Example

```typescript
const files: FileInfo[] = await backend.lsInfo("/src");
files.forEach(f => {
  console.log(`${f.path} - ${f.is_dir ? "dir" : f.size + " bytes"}`);
});
```

## Properties

### is\_dir?

> `optional` **is\_dir**: `boolean`

Defined in: [packages/agent-sdk/src/backend.ts:33](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L33)

True if this entry is a directory

***

### modified\_at?

> `optional` **modified\_at**: `string`

Defined in: [packages/agent-sdk/src/backend.ts:39](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L39)

ISO 8601 timestamp of last modification

***

### path

> **path**: `string`

Defined in: [packages/agent-sdk/src/backend.ts:30](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L30)

Path to the file or directory

***

### size?

> `optional` **size**: `number`

Defined in: [packages/agent-sdk/src/backend.ts:36](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L36)

Size in bytes (files only)
