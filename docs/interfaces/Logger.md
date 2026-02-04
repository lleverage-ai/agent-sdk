[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / Logger

# Interface: Logger

Defined in: [packages/agent-sdk/src/observability/logger.ts:107](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L107)

A structured logger interface.

## Properties

### level

> **level**: [`LogLevel`](../type-aliases/LogLevel.md)

Defined in: [packages/agent-sdk/src/observability/logger.ts:111](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L111)

Current log level

***

### name

> `readonly` **name**: `string`

Defined in: [packages/agent-sdk/src/observability/logger.ts:109](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L109)

Logger name

## Methods

### child()

> **child**(`contextOrName`: `string` \| `Record`&lt;`string`, `unknown`&gt;): `Logger`

Defined in: [packages/agent-sdk/src/observability/logger.ts:138](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L138)

Create a child logger with additional context.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `contextOrName` | `string` \| `Record`&lt;`string`, `unknown`&gt; |

#### Returns

`Logger`

***

### close()

> **close**(): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/logger.ts:160](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L160)

Close all transports.

#### Returns

`Promise`&lt;`void`&gt;

***

### debug()

> **debug**(`message`: `string`, `context?`: `Record`&lt;`string`, `unknown`&gt;): `void`

Defined in: [packages/agent-sdk/src/observability/logger.ts:114](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L114)

Log at debug level

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `message` | `string` |
| `context?` | `Record`&lt;`string`, `unknown`&gt; |

#### Returns

`void`

***

### error()

> **error**(`message`: `string`, `errorOrContext?`: `Record`&lt;`string`, `unknown`&gt; \| `Error`, `context?`: `Record`&lt;`string`, `unknown`&gt;): `void`

Defined in: [packages/agent-sdk/src/observability/logger.ts:120](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L120)

Log at error level

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `message` | `string` |
| `errorOrContext?` | `Record`&lt;`string`, `unknown`&gt; \| `Error` |
| `context?` | `Record`&lt;`string`, `unknown`&gt; |

#### Returns

`void`

***

### flush()

> **flush**(): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/observability/logger.ts:155](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L155)

Flush all transports.

#### Returns

`Promise`&lt;`void`&gt;

***

### info()

> **info**(`message`: `string`, `context?`: `Record`&lt;`string`, `unknown`&gt;): `void`

Defined in: [packages/agent-sdk/src/observability/logger.ts:116](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L116)

Log at info level

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `message` | `string` |
| `context?` | `Record`&lt;`string`, `unknown`&gt; |

#### Returns

`void`

***

### log()

> **log**(`level`: [`LogLevel`](../type-aliases/LogLevel.md), `message`: `string`, `context?`: `Record`&lt;`string`, `unknown`&gt;): `void`

Defined in: [packages/agent-sdk/src/observability/logger.ts:129](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L129)

Log with explicit level.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `level` | [`LogLevel`](../type-aliases/LogLevel.md) |
| `message` | `string` |
| `context?` | `Record`&lt;`string`, `unknown`&gt; |

#### Returns

`void`

***

### startTimer()

> **startTimer**(`operation`: `string`, `context?`: `Record`&lt;`string`, `unknown`&gt;): [`LogTimer`](LogTimer.md)

Defined in: [packages/agent-sdk/src/observability/logger.ts:150](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L150)

Create a timed operation that logs duration.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `operation` | `string` |
| `context?` | `Record`&lt;`string`, `unknown`&gt; |

#### Returns

[`LogTimer`](LogTimer.md)

#### Example

```typescript
const timer = logger.startTimer("api-call");
await fetch(url);
timer.end(); // logs with durationMs
```

***

### warn()

> **warn**(`message`: `string`, `context?`: `Record`&lt;`string`, `unknown`&gt;): `void`

Defined in: [packages/agent-sdk/src/observability/logger.ts:118](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L118)

Log at warn level

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `message` | `string` |
| `context?` | `Record`&lt;`string`, `unknown`&gt; |

#### Returns

`void`
