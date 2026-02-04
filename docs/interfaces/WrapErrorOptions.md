[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / WrapErrorOptions

# Interface: WrapErrorOptions

Defined in: [packages/agent-sdk/src/errors/index.ts:884](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L884)

Options for wrapping errors.

## Properties

### code?

> `optional` **code**: [`AgentErrorCode`](../type-aliases/AgentErrorCode.md)

Defined in: [packages/agent-sdk/src/errors/index.ts:886](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L886)

Error code to use

***

### metadata?

> `optional` **metadata**: `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/errors/index.ts:894](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L894)

Additional metadata

***

### retryable?

> `optional` **retryable**: `boolean`

Defined in: [packages/agent-sdk/src/errors/index.ts:892](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L892)

Whether the error is retryable

***

### severity?

> `optional` **severity**: [`ErrorSeverity`](../type-aliases/ErrorSeverity.md)

Defined in: [packages/agent-sdk/src/errors/index.ts:890](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L890)

Severity level

***

### userMessage?

> `optional` **userMessage**: `string`

Defined in: [packages/agent-sdk/src/errors/index.ts:888](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L888)

User-friendly message
