[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / AgentError

# Class: AgentError

Defined in: [packages/agent-sdk/src/errors/index.ts:67](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L67)

Base error class for all agent SDK errors.

Provides consistent structure with error codes, user-friendly messages,
and metadata support.

## Example

```typescript
throw new AgentError("Something went wrong", {
  code: "TOOL_ERROR",
  userMessage: "The operation failed. Please try again.",
  cause: originalError,
  metadata: { toolName: "read_file", path: "/path/to/file" },
});
```

## Extends

- `Error`

## Extended by

- [`AbortError`](AbortError.md)
- [`AuthenticationError`](AuthenticationError.md)
- [`AuthorizationError`](AuthorizationError.md)
- [`BackendError`](BackendError.md)
- [`CheckpointError`](CheckpointError.md)
- [`ConfigurationError`](ConfigurationError.md)
- [`ContextError`](ContextError.md)
- [`GeneratePermissionDeniedError`](GeneratePermissionDeniedError.md)
- [`MemoryError`](MemoryError.md)
- [`ModelError`](ModelError.md)
- [`NetworkError`](NetworkError.md)
- [`RateLimitError`](RateLimitError.md)
- [`SubagentError`](SubagentError.md)
- [`TimeoutError`](TimeoutError.md)
- [`ToolExecutionError`](ToolExecutionError.md)
- [`ToolPermissionDeniedError`](ToolPermissionDeniedError.md)
- [`ValidationError`](ValidationError.md)

## Constructors

### Constructor

> **new AgentError**(`message`: `string`, `options`: \{ `cause?`: `Error`; `code?`: [`AgentErrorCode`](../type-aliases/AgentErrorCode.md); `metadata?`: `Record`&lt;`string`, `unknown`&gt;; `retryable?`: `boolean`; `retryAfterMs?`: `number`; `severity?`: [`ErrorSeverity`](../type-aliases/ErrorSeverity.md); `userMessage?`: `string`; \}): `AgentError`

Defined in: [packages/agent-sdk/src/errors/index.ts:108](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L108)

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `message` | `string` |
| `options` | \{ `cause?`: `Error`; `code?`: [`AgentErrorCode`](../type-aliases/AgentErrorCode.md); `metadata?`: `Record`&lt;`string`, `unknown`&gt;; `retryable?`: `boolean`; `retryAfterMs?`: `number`; `severity?`: [`ErrorSeverity`](../type-aliases/ErrorSeverity.md); `userMessage?`: `string`; \} |
| `options.cause?` | `Error` |
| `options.code?` | [`AgentErrorCode`](../type-aliases/AgentErrorCode.md) |
| `options.metadata?` | `Record`&lt;`string`, `unknown`&gt; |
| `options.retryable?` | `boolean` |
| `options.retryAfterMs?` | `number` |
| `options.severity?` | [`ErrorSeverity`](../type-aliases/ErrorSeverity.md) |
| `options.userMessage?` | `string` |

#### Returns

`AgentError`

#### Overrides

`Error.constructor`

## Properties

### cause?

> `readonly` `optional` **cause**: `Error`

Defined in: [packages/agent-sdk/src/errors/index.ts:101](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L101)

The original error that caused this error.

#### Overrides

`Error.cause`

***

### code

> `readonly` **code**: [`AgentErrorCode`](../type-aliases/AgentErrorCode.md)

Defined in: [packages/agent-sdk/src/errors/index.ts:71](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L71)

Error code for categorization.

***

### message

> **message**: `string`

Defined in: node\_modules/.bun/typescript@5.9.2/node\_modules/typescript/lib/lib.es5.d.ts:1077

#### Inherited from

`Error.message`

***

### metadata

> `readonly` **metadata**: `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/errors/index.ts:96](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L96)

Additional metadata about the error.

***

### name

> **name**: `string`

Defined in: node\_modules/.bun/typescript@5.9.2/node\_modules/typescript/lib/lib.es5.d.ts:1076

#### Inherited from

`Error.name`

***

### retryable

> `readonly` **retryable**: `boolean`

Defined in: [packages/agent-sdk/src/errors/index.ts:86](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L86)

Whether this error can be retried.

***

### retryAfterMs?

> `readonly` `optional` **retryAfterMs**: `number`

Defined in: [packages/agent-sdk/src/errors/index.ts:91](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L91)

Suggested delay before retry in milliseconds.

***

### severity

> `readonly` **severity**: [`ErrorSeverity`](../type-aliases/ErrorSeverity.md)

Defined in: [packages/agent-sdk/src/errors/index.ts:81](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L81)

Severity level of the error.

***

### stack?

> `optional` **stack**: `string`

Defined in: node\_modules/.bun/typescript@5.9.2/node\_modules/typescript/lib/lib.es5.d.ts:1078

#### Inherited from

`Error.stack`

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

`Error.stackTraceLimit`

***

### timestamp

> `readonly` **timestamp**: `number`

Defined in: [packages/agent-sdk/src/errors/index.ts:106](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L106)

Timestamp when the error occurred.

***

### userMessage

> `readonly` **userMessage**: `string`

Defined in: [packages/agent-sdk/src/errors/index.ts:76](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L76)

User-friendly error message suitable for display.

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

`Error.captureStackTrace`

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

`Error.prepareStackTrace`

***

### toJSON()

> **toJSON**(): `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/errors/index.ts:152](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L152)

Get a structured representation of the error for logging.

#### Returns

`Record`&lt;`string`, `unknown`&gt;
