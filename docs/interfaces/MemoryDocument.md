[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MemoryDocument

# Interface: MemoryDocument

Defined in: [packages/agent-sdk/src/memory/store.ts:111](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L111)

A memory document with metadata and content.

Memory documents are markdown files with optional YAML frontmatter.
They store persistent instructions, conventions, and preferences
that agents can use across conversations.

## Example

```typescript
const doc: MemoryDocument = {
  path: "/home/user/.deepagents/coding-agent/agent.md",
  metadata: {
    paths: ["**/*.ts"],
    tags: ["typescript", "coding"],
  },
  content: "# Coding Preferences\n\nAlways use strict TypeScript.",
  modifiedAt: Date.now(),
};
```

## Properties

### content

> **content**: `string`

Defined in: [packages/agent-sdk/src/memory/store.ts:127](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L127)

The markdown content (without frontmatter).

***

### metadata

> **metadata**: [`MemoryMetadata`](MemoryMetadata.md)

Defined in: [packages/agent-sdk/src/memory/store.ts:122](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L122)

Parsed YAML frontmatter metadata.

Empty object if no frontmatter is present.

***

### modifiedAt

> **modifiedAt**: `number`

Defined in: [packages/agent-sdk/src/memory/store.ts:132](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L132)

Timestamp when the document was last modified (Unix ms).

***

### path

> **path**: `string`

Defined in: [packages/agent-sdk/src/memory/store.ts:115](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L115)

Full path to the memory document.
