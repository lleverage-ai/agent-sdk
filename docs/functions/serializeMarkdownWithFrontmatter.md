[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / serializeMarkdownWithFrontmatter

# Function: serializeMarkdownWithFrontmatter()

> **serializeMarkdownWithFrontmatter**(`document`: `Omit`&lt;[`MemoryDocument`](../interfaces/MemoryDocument.md), `"path"` \| `"modifiedAt"`&gt;): `string`

Defined in: [packages/agent-sdk/src/memory/store.ts:424](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L424)

Serialize metadata and content back to markdown with frontmatter.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `document` | `Omit`&lt;[`MemoryDocument`](../interfaces/MemoryDocument.md), `"path"` \| `"modifiedAt"`&gt; | The document to serialize |

## Returns

`string`

Markdown string with YAML frontmatter

## Example

```typescript
const markdown = serializeMarkdownWithFrontmatter({
  path: "/path/to/file.md",
  metadata: { paths: ["src/**"] },
  content: "# Title\n\nContent",
  modifiedAt: Date.now(),
});
// Returns:
// ---
// paths:
//   - "src/**"
// ---
// # Title
//
// Content
```
