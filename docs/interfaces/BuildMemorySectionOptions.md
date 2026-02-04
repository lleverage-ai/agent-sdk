[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / BuildMemorySectionOptions

# Interface: BuildMemorySectionOptions

Defined in: [packages/agent-sdk/src/memory/loader.ts:300](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L300)

Options for building the memory section.

## Properties

### additionalHeader?

> `optional` **additionalHeader**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:317](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L317)

Header for additional files section.

#### Default Value

```ts
"# Additional Context"
```

***

### includeFilenames?

> `optional` **includeFilenames**: `boolean`

Defined in: [packages/agent-sdk/src/memory/loader.ts:323](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L323)

Include file names as subheaders for additional files.

#### Default Value

```ts
true
```

***

### projectHeader?

> `optional` **projectHeader**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:311](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L311)

Header for the project memory section.

#### Default Value

```ts
"# Project Memory"
```

***

### userHeader?

> `optional` **userHeader**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:305](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L305)

Header for the user memory section.

#### Default Value

```ts
"# User Memory"
```
