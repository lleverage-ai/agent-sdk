[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / WriteResult

# Interface: WriteResult

Defined in: [packages/agent-sdk/src/backend.ts:97](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L97)

Result from a write operation.

## Properties

### error?

> `optional` **error**: `string`

Defined in: [packages/agent-sdk/src/backend.ts:102](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L102)

Error message if failed

***

### path?

> `optional` **path**: `string`

Defined in: [packages/agent-sdk/src/backend.ts:105](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L105)

Path that was written to

***

### success

> **success**: `boolean`

Defined in: [packages/agent-sdk/src/backend.ts:99](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L99)

Whether the operation succeeded
