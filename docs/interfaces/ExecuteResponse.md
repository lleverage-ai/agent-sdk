[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ExecuteResponse

# Interface: ExecuteResponse

Defined in: [packages/agent-sdk/src/backend.ts:317](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L317)

Response from command execution.

## Properties

### exitCode

> **exitCode**: `number` \| `null`

Defined in: [packages/agent-sdk/src/backend.ts:322](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L322)

Exit code from the command (null if terminated)

***

### output

> **output**: `string`

Defined in: [packages/agent-sdk/src/backend.ts:319](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L319)

Combined stdout and stderr output

***

### truncated

> **truncated**: `boolean`

Defined in: [packages/agent-sdk/src/backend.ts:325](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backend.ts#L325)

Whether output was truncated due to size limits
