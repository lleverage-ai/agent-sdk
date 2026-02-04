[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MemoryApproval

# Interface: MemoryApproval

Defined in: [packages/agent-sdk/src/memory/permissions.ts:43](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L43)

Approval record for a memory file.

Tracks when a file was approved and its content hash at approval time.

## Properties

### approvedAt

> **approvedAt**: `number`

Defined in: [packages/agent-sdk/src/memory/permissions.ts:57](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L57)

Timestamp when approval was granted (Unix ms).

***

### approvedBy?

> `optional` **approvedBy**: `string`

Defined in: [packages/agent-sdk/src/memory/permissions.ts:62](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L62)

Optional user identifier who granted approval.

***

### contentHash

> **contentHash**: `string`

Defined in: [packages/agent-sdk/src/memory/permissions.ts:52](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L52)

SHA-256 hash of the file content at approval time.

***

### path

> **path**: `string`

Defined in: [packages/agent-sdk/src/memory/permissions.ts:47](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L47)

Full path to the approved memory file.
