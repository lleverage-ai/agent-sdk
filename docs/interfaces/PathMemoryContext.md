[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PathMemoryContext

# Interface: PathMemoryContext

Defined in: [packages/agent-sdk/src/memory/rules.ts:259](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L259)

Result from building path-specific memory context.

## Properties

### appliedPatterns

> **appliedPatterns**: `string`[]

Defined in: [packages/agent-sdk/src/memory/rules.ts:283](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L283)

Paths from all applicable memories (for debugging).

***

### combinedContent

> **combinedContent**: `string`

Defined in: [packages/agent-sdk/src/memory/rules.ts:278](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L278)

Combined memory content formatted for prompt injection.

***

### projectMemoryApplies

> **projectMemoryApplies**: `boolean`

Defined in: [packages/agent-sdk/src/memory/rules.ts:268](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L268)

Whether project memory applies to current path.

***

### relevantAdditionalFiles

> **relevantAdditionalFiles**: [`AdditionalMemoryFile`](AdditionalMemoryFile.md)[]

Defined in: [packages/agent-sdk/src/memory/rules.ts:273](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L273)

Filtered additional files that apply to current path.

***

### userMemoryApplies

> **userMemoryApplies**: `boolean`

Defined in: [packages/agent-sdk/src/memory/rules.ts:263](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/rules.ts#L263)

Whether user memory applies to current path.
