[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / parseMarkdownWithFrontmatter

# Function: parseMarkdownWithFrontmatter()

> **parseMarkdownWithFrontmatter**(`markdown`: `string`): [`ParsedMarkdown`](../interfaces/ParsedMarkdown.md)

Defined in: [packages/agent-sdk/src/memory/store.ts:262](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L262)

Parse YAML frontmatter from a markdown string.

Frontmatter must be at the very beginning of the file,
surrounded by `---` delimiters.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `markdown` | `string` | The full markdown string including frontmatter |

## Returns

[`ParsedMarkdown`](../interfaces/ParsedMarkdown.md)

Parsed metadata and content

## Example

```typescript
const markdown = `---
paths:
  - "src/**/*.ts"
tags:
  - typescript
---

# My Rules

Content here...`;

const { metadata, content } = parseMarkdownWithFrontmatter(markdown);
// metadata = { paths: ["src/**/*.ts"], tags: ["typescript"] }
// content = "# My Rules\n\nContent here..."
```
