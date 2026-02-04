[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / setupMiddleware

# Function: setupMiddleware()

> **setupMiddleware**(`middleware`: [`AgentMiddleware`](../interfaces/AgentMiddleware.md)[]): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/middleware/apply.ts:65](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/apply.ts#L65)

Calls setup on all middleware that have a setup method.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `middleware` | [`AgentMiddleware`](../interfaces/AgentMiddleware.md)[] | Array of middleware to setup |

## Returns

`Promise`&lt;`void`&gt;

Promise that resolves when all setup is complete
