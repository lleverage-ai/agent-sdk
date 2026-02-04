[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LoadAllMemoryResult

# Interface: LoadAllMemoryResult

Defined in: [packages/agent-sdk/src/memory/loader.ts:501](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L501)

Result from loading all agent memory.

## Properties

### additionalFiles

> **additionalFiles**: [`AdditionalMemoryFile`](AdditionalMemoryFile.md)[]

Defined in: [packages/agent-sdk/src/memory/loader.ts:515](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L515)

Additional memory files.

***

### memorySection

> **memorySection**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:525](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L525)

Built memory section for prompt injection.

***

### projectApproved

> **projectApproved**: `boolean`

Defined in: [packages/agent-sdk/src/memory/loader.ts:520](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L520)

Whether project memory was approved.

***

### projectMemory

> **projectMemory**: [`MemoryDocument`](MemoryDocument.md) \| `undefined`

Defined in: [packages/agent-sdk/src/memory/loader.ts:510](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L510)

Project-level memory document.

***

### userMemory

> **userMemory**: [`MemoryDocument`](MemoryDocument.md) \| `undefined`

Defined in: [packages/agent-sdk/src/memory/loader.ts:505](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L505)

User-level memory document.
