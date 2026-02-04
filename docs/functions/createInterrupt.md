[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createInterrupt

# Function: createInterrupt()

> **createInterrupt**&lt;`TRequest`, `TResponse`&gt;(`data`: `Pick`&lt;[`Interrupt`](../interfaces/Interrupt.md)&lt;`TRequest`, `TResponse`&gt;, `"id"` \| `"threadId"` \| `"type"` \| `"request"`&gt; & `Partial`&lt;`Omit`&lt;[`Interrupt`](../interfaces/Interrupt.md)&lt;`TRequest`, `TResponse`&gt;, `"id"` \| `"threadId"` \| `"type"` \| `"request"`&gt;&gt;): [`Interrupt`](../interfaces/Interrupt.md)&lt;`TRequest`, `TResponse`&gt;

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:437](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L437)

Create a new interrupt with the given data.

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `TRequest` | `unknown` |
| `TResponse` | `unknown` |

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `data` | `Pick`&lt;[`Interrupt`](../interfaces/Interrupt.md)&lt;`TRequest`, `TResponse`&gt;, `"id"` \| `"threadId"` \| `"type"` \| `"request"`&gt; & `Partial`&lt;`Omit`&lt;[`Interrupt`](../interfaces/Interrupt.md)&lt;`TRequest`, `TResponse`&gt;, `"id"` \| `"threadId"` \| `"type"` \| `"request"`&gt;&gt; | Partial interrupt data (id, threadId, type, and request required) |

## Returns

[`Interrupt`](../interfaces/Interrupt.md)&lt;`TRequest`, `TResponse`&gt;

A complete interrupt object
