[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / BashResult

# Interface: BashResult

Defined in: [packages/agent-sdk/src/tools/execute.ts:85](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L85)

Result of command execution.

## Properties

### error?

> `optional` **error**: `string`

Defined in: [packages/agent-sdk/src/tools/execute.ts:95](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L95)

Error message if command was blocked or failed to start

***

### exitCode

> **exitCode**: `number` \| `null`

Defined in: [packages/agent-sdk/src/tools/execute.ts:91](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L91)

Exit code (null if timed out or not available)

***

### output

> **output**: `string`

Defined in: [packages/agent-sdk/src/tools/execute.ts:89](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L89)

Command output (stdout + stderr combined)

***

### success

> **success**: `boolean`

Defined in: [packages/agent-sdk/src/tools/execute.ts:87](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L87)

Whether the command executed successfully (exit code 0)

***

### truncated

> **truncated**: `boolean`

Defined in: [packages/agent-sdk/src/tools/execute.ts:93](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L93)

Whether the output was truncated
