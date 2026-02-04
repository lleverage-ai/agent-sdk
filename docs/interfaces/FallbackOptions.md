[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FallbackOptions

# Interface: FallbackOptions&lt;T&gt;

Defined in: [packages/agent-sdk/src/errors/index.ts:1182](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L1182)

Options for graceful degradation.

## Type Parameters

| Type Parameter |
| :------ |
| `T` |

## Properties

### fallback

> **fallback**: `T`

Defined in: [packages/agent-sdk/src/errors/index.ts:1184](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L1184)

Fallback value to use on error

***

### logError?

> `optional` **logError**: `boolean`

Defined in: [packages/agent-sdk/src/errors/index.ts:1186](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L1186)

Whether to log the error

***

### onError()?

> `optional` **onError**: (`error`: [`AgentError`](../classes/AgentError.md)) => `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/errors/index.ts:1188](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L1188)

Error callback

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `error` | [`AgentError`](../classes/AgentError.md) |

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### rethrowFatal?

> `optional` **rethrowFatal**: `boolean`

Defined in: [packages/agent-sdk/src/errors/index.ts:1190](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L1190)

Whether to rethrow fatal errors
