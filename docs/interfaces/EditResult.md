[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / EditResult

# Interface: EditResult

Defined in: [packages/agent-sdk/src/backend.ts:113](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L113)

Result from an edit operation.

## Properties

### error?

> `optional` **error**: `string`

Defined in: [packages/agent-sdk/src/backend.ts:118](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L118)

Error message if failed

***

### occurrences?

> `optional` **occurrences**: `number`

Defined in: [packages/agent-sdk/src/backend.ts:124](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L124)

Number of occurrences replaced (when replace_all is true)

***

### path?

> `optional` **path**: `string`

Defined in: [packages/agent-sdk/src/backend.ts:121](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L121)

Path that was edited

***

### success

> **success**: `boolean`

Defined in: [packages/agent-sdk/src/backend.ts:115](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L115)

Whether the operation succeeded
