[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LogTimer

# Interface: LogTimer

Defined in: [packages/agent-sdk/src/observability/logger.ts:168](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L168)

A timer for measuring operation duration.

## Methods

### end()

> **end**(`context?`: `Record`&lt;`string`, `unknown`&gt;): `void`

Defined in: [packages/agent-sdk/src/observability/logger.ts:170](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L170)

End the timer and log the duration

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `context?` | `Record`&lt;`string`, `unknown`&gt; |

#### Returns

`void`

***

### error()

> **error**(`error`: `Error`, `context?`: `Record`&lt;`string`, `unknown`&gt;): `void`

Defined in: [packages/agent-sdk/src/observability/logger.ts:172](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L172)

End with error

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `error` | `Error` |
| `context?` | `Record`&lt;`string`, `unknown`&gt; |

#### Returns

`void`
