[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / BuildPathMemoryContextOptions

# Interface: BuildPathMemoryContextOptions

Defined in: [packages/agent-sdk/src/memory/rules.ts:220](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L220)

Options for building path-specific memory context.

## Properties

### additionalFiles?

> `optional` **additionalFiles**: [`AdditionalMemoryFile`](AdditionalMemoryFile.md)[]

Defined in: [packages/agent-sdk/src/memory/rules.ts:234](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L234)

Additional memory files.

***

### currentPath?

> `optional` **currentPath**: `string`

Defined in: [packages/agent-sdk/src/memory/rules.ts:239](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L239)

Current file path for filtering.

***

### includeFilenames?

> `optional` **includeFilenames**: `boolean`

Defined in: [packages/agent-sdk/src/memory/rules.ts:251](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L251)

Include file names as subheaders for additional files.

#### Default Value

```ts
true
```

***

### includeGeneral?

> `optional` **includeGeneral**: `boolean`

Defined in: [packages/agent-sdk/src/memory/rules.ts:245](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L245)

Include memories without path restrictions.

#### Default Value

```ts
true
```

***

### projectMemory?

> `optional` **projectMemory**: [`MemoryDocument`](MemoryDocument.md)

Defined in: [packages/agent-sdk/src/memory/rules.ts:229](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L229)

Project memory document.

***

### userMemory?

> `optional` **userMemory**: [`MemoryDocument`](MemoryDocument.md)

Defined in: [packages/agent-sdk/src/memory/rules.ts:224](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L224)

User memory document.
