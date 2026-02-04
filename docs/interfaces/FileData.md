[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FileData

# Interface: FileData

Defined in: [packages/agent-sdk/src/backend.ts:49](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L49)

File content storage format.

Used by `readRaw()` to return file content with metadata.

## Properties

### content

> **content**: `string`[]

Defined in: [packages/agent-sdk/src/backend.ts:51](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L51)

Lines of text content

***

### created\_at

> **created\_at**: `string`

Defined in: [packages/agent-sdk/src/backend.ts:54](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L54)

ISO 8601 timestamp when file was created

***

### modified\_at

> **modified\_at**: `string`

Defined in: [packages/agent-sdk/src/backend.ts:57](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L57)

ISO 8601 timestamp of last modification
