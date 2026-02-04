[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / InterruptFunction

# Type Alias: InterruptFunction()

> **InterruptFunction** = &lt;`TRequest`, `TResponse`&gt;(`request`: `TRequest`, `options?`: \{ `type?`: `string`; \}) => `Promise`&lt;`TResponse`&gt;

Defined in: [packages/agent-sdk/src/types.ts:89](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L89)

Request an interrupt and wait for a response.

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `TRequest` | `unknown` |
| `TResponse` | `unknown` |

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `request` | `TRequest` | Data to include in the interrupt (sent to the client) |
| `options?` | \{ `type?`: `string`; \} | Optional configuration for the interrupt |
| `options.type?` | `string` | Custom interrupt type (default: "custom") |

## Returns

`Promise`&lt;`TResponse`&gt;

Promise that resolves with the response when resumed
