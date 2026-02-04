[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MemoryMetadata

# Interface: MemoryMetadata

Defined in: [packages/agent-sdk/src/memory/store.ts:57](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L57)

YAML frontmatter metadata for a memory document.

Frontmatter is optional and appears at the top of markdown files between `---` markers.

## Example

```yaml
---
paths:
  - "src/api/**/*.ts"
  - "src/routes/**/*.ts"
tags:
  - api
  - backend
---
```

## Indexable

\[`key`: `string`\]: `unknown`

Any additional custom metadata fields.

## Properties

### autoLoad?

> `optional` **autoLoad**: `boolean`

Defined in: [packages/agent-sdk/src/memory/store.ts:81](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L81)

Whether this memory should be auto-loaded at start.

#### Default Value

```ts
true
```

***

### paths?

> `optional` **paths**: `string`[]

Defined in: [packages/agent-sdk/src/memory/store.ts:64](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L64)

Path patterns this memory applies to (glob patterns).

When set, the memory content will only be injected when working
with files matching these patterns.

***

### priority?

> `optional` **priority**: `number`

Defined in: [packages/agent-sdk/src/memory/store.ts:75](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L75)

Priority for ordering when multiple memories match (higher = first).

#### Default Value

```ts
0
```

***

### tags?

> `optional` **tags**: `string`[]

Defined in: [packages/agent-sdk/src/memory/store.ts:69](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/store.ts#L69)

Tags for categorizing and filtering memory.
