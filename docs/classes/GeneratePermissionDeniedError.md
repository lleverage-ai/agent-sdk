[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / GeneratePermissionDeniedError

# Class: GeneratePermissionDeniedError

Defined in: [packages/agent-sdk/src/errors/index.ts:365](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L365)

Error thrown when a generation request is denied by a PreGenerate hook.

## Extends

- [`AgentError`](AgentError.md)

## Constructors

### Constructor

> **new GeneratePermissionDeniedError**(`message`: `string`, `options`: \{ `blockedMessageIds?`: `string`[]; `cause?`: `Error`; `metadata?`: `Record`&lt;`string`, `unknown`&gt;; `reason?`: `string`; \}): `GeneratePermissionDeniedError`

Defined in: [packages/agent-sdk/src/errors/index.ts:376](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L376)

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `message` | `string` |
| `options` | \{ `blockedMessageIds?`: `string`[]; `cause?`: `Error`; `metadata?`: `Record`&lt;`string`, `unknown`&gt;; `reason?`: `string`; \} |
| `options.blockedMessageIds?` | `string`[] |
| `options.cause?` | `Error` |
| `options.metadata?` | `Record`&lt;`string`, `unknown`&gt; |
| `options.reason?` | `string` |

#### Returns

`GeneratePermissionDeniedError`

#### Overrides

[`AgentError`](AgentError.md).[`constructor`](AgentError.md#constructor)

## Properties

### blockedMessageIds?

> `readonly` `optional` **blockedMessageIds**: `string`[]

Defined in: [packages/agent-sdk/src/errors/index.ts:374](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L374)

IDs of messages that caused the block (for client-side cleanup).

***

### cause?

> `readonly` `optional` **cause**: `Error`

Defined in: [packages/agent-sdk/src/errors/index.ts:101](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L101)

The original error that caused this error.

#### Inherited from

[`AgentError`](AgentError.md).[`cause`](AgentError.md#cause)

***

### code

> `readonly` **code**: [`AgentErrorCode`](../type-aliases/AgentErrorCode.md)

Defined in: [packages/agent-sdk/src/errors/index.ts:71](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L71)

Error code for categorization.

#### Inherited from

[`AgentError`](AgentError.md).[`code`](AgentError.md#code)

***

### message

> **message**: `string`

Defined in: node\_modules/.bun/typescript@5.9.2/node\_modules/typescript/lib/lib.es5.d.ts:1077

#### Inherited from

[`AgentError`](AgentError.md).[`message`](AgentError.md#message)

***

### metadata

> `readonly` **metadata**: `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/errors/index.ts:96](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L96)

Additional metadata about the error.

#### Inherited from

[`AgentError`](AgentError.md).[`metadata`](AgentError.md#metadata)

***

### name

> **name**: `string`

Defined in: node\_modules/.bun/typescript@5.9.2/node\_modules/typescript/lib/lib.es5.d.ts:1076

#### Inherited from

[`AgentError`](AgentError.md).[`name`](AgentError.md#name)

***

### reason?

> `readonly` `optional` **reason**: `string`

Defined in: [packages/agent-sdk/src/errors/index.ts:369](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L369)

Reason provided by the hook (if any).

***

### retryable

> `readonly` **retryable**: `boolean`

Defined in: [packages/agent-sdk/src/errors/index.ts:86](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L86)

Whether this error can be retried.

#### Inherited from

[`AgentError`](AgentError.md).[`retryable`](AgentError.md#retryable)

***

### retryAfterMs?

> `readonly` `optional` **retryAfterMs**: `number`

Defined in: [packages/agent-sdk/src/errors/index.ts:91](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L91)

Suggested delay before retry in milliseconds.

#### Inherited from

[`AgentError`](AgentError.md).[`retryAfterMs`](AgentError.md#retryafterms)

***

### severity

> `readonly` **severity**: [`ErrorSeverity`](../type-aliases/ErrorSeverity.md)

Defined in: [packages/agent-sdk/src/errors/index.ts:81](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L81)

Severity level of the error.

#### Inherited from

[`AgentError`](AgentError.md).[`severity`](AgentError.md#severity)

***

### stack?

> `optional` **stack**: `string`

Defined in: node\_modules/.bun/typescript@5.9.2/node\_modules/typescript/lib/lib.es5.d.ts:1078

#### Inherited from

[`AgentError`](AgentError.md).[`stack`](AgentError.md#stack)

***

### stackTraceLimit

> `static` **stackTraceLimit**: `number`

Defined in: node\_modules/.bun/@types+node@25.1.0/node\_modules/@types/node/globals.d.ts:67

The `Error.stackTraceLimit` property specifies the number of stack frames
collected by a stack trace (whether generated by `new Error().stack` or
`Error.captureStackTrace(obj)`).

The default value is `10` but may be set to any valid JavaScript number. Changes
will affect any stack trace captured _after_ the value has been changed.

If set to a non-number value, or set to a negative number, stack traces will
not capture any frames.

#### Inherited from

[`AgentError`](AgentError.md).[`stackTraceLimit`](AgentError.md#stacktracelimit)

***

### timestamp

> `readonly` **timestamp**: `number`

Defined in: [packages/agent-sdk/src/errors/index.ts:106](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L106)

Timestamp when the error occurred.

#### Inherited from

[`AgentError`](AgentError.md).[`timestamp`](AgentError.md#timestamp)

***

### userMessage

> `readonly` **userMessage**: `string`

Defined in: [packages/agent-sdk/src/errors/index.ts:76](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L76)

User-friendly error message suitable for display.

#### Inherited from

[`AgentError`](AgentError.md).[`userMessage`](AgentError.md#usermessage)

## Methods

### captureStackTrace()

> `static` **captureStackTrace**(`targetObject`: `object`, `constructorOpt?`: `Function`): `void`

Defined in: node\_modules/.bun/@types+node@25.1.0/node\_modules/@types/node/globals.d.ts:51

Creates a `.stack` property on `targetObject`, which when accessed returns
a string representing the location in the code at which
`Error.captureStackTrace()` was called.

```js
const myObject = {};
Error.captureStackTrace(myObject);
myObject.stack;  // Similar to `new Error().stack`
```

The first line of the trace will be prefixed with
`${myObject.name}: ${myObject.message}`.

The optional `constructorOpt` argument accepts a function. If given, all frames
above `constructorOpt`, including `constructorOpt`, will be omitted from the
generated stack trace.

The `constructorOpt` argument is useful for hiding implementation
details of error generation from the user. For instance:

```js
function a() {
  b();
}

function b() {
  c();
}

function c() {
  // Create an error without stack trace to avoid calculating the stack trace twice.
  const { stackTraceLimit } = Error;
  Error.stackTraceLimit = 0;
  const error = new Error();
  Error.stackTraceLimit = stackTraceLimit;

  // Capture the stack trace above function b
  Error.captureStackTrace(error, b); // Neither function c, nor b is included in the stack trace
  throw error;
}

a();
```

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `targetObject` | `object` |
| `constructorOpt?` | `Function` |

#### Returns

`void`

#### Inherited from

[`AgentError`](AgentError.md).[`captureStackTrace`](AgentError.md#capturestacktrace)

***

### hasCode()

> `static` **hasCode**(`error`: `unknown`, `code`: [`AgentErrorCode`](../type-aliases/AgentErrorCode.md)): `boolean`

Defined in: [packages/agent-sdk/src/errors/index.ts:178](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L178)

Check if an error has a specific code.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `error` | `unknown` |
| `code` | [`AgentErrorCode`](../type-aliases/AgentErrorCode.md) |

#### Returns

`boolean`

#### Inherited from

[`AgentError`](AgentError.md).[`hasCode`](AgentError.md#hascode)

***

### is()

> `static` **is**(`error`: `unknown`): `error is AgentError`

Defined in: [packages/agent-sdk/src/errors/index.ts:171](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L171)

Check if an error is a specific type of AgentError.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `error` | `unknown` |

#### Returns

`error is AgentError`

#### Inherited from

[`AgentError`](AgentError.md).[`is`](AgentError.md#is)

***

### prepareStackTrace()

> `static` **prepareStackTrace**(`err`: `Error`, `stackTraces`: `CallSite`[]): `any`

Defined in: node\_modules/.bun/@types+node@25.1.0/node\_modules/@types/node/globals.d.ts:55

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `err` | `Error` |
| `stackTraces` | `CallSite`[] |

#### Returns

`any`

#### See

https://v8.dev/docs/stack-trace-api#customizing-stack-traces

#### Inherited from

[`AgentError`](AgentError.md).[`prepareStackTrace`](AgentError.md#preparestacktrace)

***

### toJSON()

> **toJSON**(): `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/errors/index.ts:152](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L152)

Get a structured representation of the error for logging.

#### Returns

`Record`&lt;`string`, `unknown`&gt;

#### Inherited from

[`AgentError`](AgentError.md).[`toJSON`](AgentError.md#tojson)
