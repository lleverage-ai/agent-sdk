[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FilesystemTools

# Interface: FilesystemTools

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:389](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L389)

Result from createFilesystemTools containing all filesystem tools.

## Properties

### edit?

> `optional` **edit**: [`Tool`](../type-aliases/Tool.md)&lt;\{ `file_path`: `string`; `new_string`: `string`; `old_string`: `string`; `replace_all?`: `boolean`; \}, `string`&gt;

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:395](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L395)

Edit files via replacement (optional)

***

### glob

> **glob**: [`Tool`](../type-aliases/Tool.md)&lt;\{ `path?`: `string`; `pattern`: `string`; \}&gt;

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:397](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L397)

Find files by glob pattern

***

### grep

> **grep**: [`Tool`](../type-aliases/Tool.md)&lt;\{ `glob?`: `string`; `path?`: `string`; `pattern`: `string`; \}&gt;

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:399](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L399)

Search file contents

***

### read

> **read**: [`Tool`](../type-aliases/Tool.md)&lt;\{ `file_path`: `string`; `limit?`: `number`; `offset?`: `number`; \}&gt;

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:391](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L391)

Read file contents

***

### write?

> `optional` **write**: [`Tool`](../type-aliases/Tool.md)&lt;\{ `content`: `string`; `file_path`: `string`; \}, `string`&gt;

Defined in: [packages/agent-sdk/src/tools/filesystem.ts:393](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/filesystem.ts#L393)

Write/create files (optional)
