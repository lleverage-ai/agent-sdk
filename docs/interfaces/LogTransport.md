[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LogTransport

# Interface: LogTransport

Defined in: [packages/agent-sdk/src/observability/logger.ts:63](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L63)

A transport writes log entries to a destination.

## Properties

### name

> **name**: `string`

Defined in: [packages/agent-sdk/src/observability/logger.ts:65](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L65)

Transport name for identification

## Methods

### close()?

> `optional` **close**(): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/logger.ts:71](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L71)

Optional close for cleanup

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### flush()?

> `optional` **flush**(): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/logger.ts:69](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L69)

Optional flush for async transports

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### write()

> **write**(`entry`: [`LogEntry`](LogEntry.md)): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/logger.ts:67](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L67)

Write a log entry

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `entry` | [`LogEntry`](LogEntry.md) |

#### Returns

`void` \| `Promise`&lt;`void`&gt;
