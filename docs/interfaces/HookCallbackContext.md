[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / HookCallbackContext

# Interface: HookCallbackContext

Defined in: [packages/agent-sdk/src/types.ts:2166](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2166)

Context passed to hook callbacks.

## Properties

### agent

> **agent**: [`Agent`](Agent.md)

Defined in: [packages/agent-sdk/src/types.ts:2171](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2171)

Agent instance

***

### retryAttempt?

> `optional` **retryAttempt**: `number`

Defined in: [packages/agent-sdk/src/types.ts:2174](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2174)

Current retry attempt (0 = first attempt)

***

### signal

> **signal**: `AbortSignal`

Defined in: [packages/agent-sdk/src/types.ts:2168](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2168)

AbortSignal for cancellation (pass to fetch, etc.)
