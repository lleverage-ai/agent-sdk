[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MemoryAuditEvent

# Interface: MemoryAuditEvent

Defined in: [packages/agent-sdk/src/memory/loader.ts:399](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L399)

Audit event emitted when memory is loaded.

## Properties

### agentId

> **agentId**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:428](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L428)

Agent ID that loaded the memory.

***

### approved

> **approved**: `boolean`

Defined in: [packages/agent-sdk/src/memory/loader.ts:418](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L418)

Whether the load was approved.

***

### contentHash

> **contentHash**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:413](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L413)

Content hash of the memory file.

***

### path

> **path**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:408](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L408)

Path to the memory file.

***

### previousHash?

> `optional` **previousHash**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:433](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L433)

Previous content hash (for change detection).

***

### timestamp

> **timestamp**: `number`

Defined in: [packages/agent-sdk/src/memory/loader.ts:423](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L423)

Timestamp (Unix ms).

***

### type

> **type**: `"memory_loaded"` \| `"memory_approval_requested"` \| `"memory_approval_denied"` \| `"memory_content_changed"`

Defined in: [packages/agent-sdk/src/memory/loader.ts:403](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L403)

Event type.
