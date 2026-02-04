[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ErrorSeverity

# Type Alias: ErrorSeverity

> **ErrorSeverity** = `"fatal"` \| `"error"` \| `"warning"`

Defined in: [packages/agent-sdk/src/errors/index.ts:47](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L47)

Severity levels for errors.

- `fatal`: The operation cannot continue and the agent should stop
- `error`: The operation failed but the agent can continue with other tasks
- `warning`: Something unexpected happened but the operation completed
