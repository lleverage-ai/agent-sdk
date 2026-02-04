[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / wrapError

# Function: wrapError()

> **wrapError**(`error`: `unknown`, `message`: `string`, `options`: [`WrapErrorOptions`](../interfaces/WrapErrorOptions.md)): [`AgentError`](../classes/AgentError.md)

Defined in: [packages/agent-sdk/src/errors/index.ts:921](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L921)

Wrap any error as an AgentError.

Preserves existing AgentErrors while wrapping other errors with additional context.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `error` | `unknown` | The error to wrap |
| `message` | `string` | Additional context message |
| `options` | [`WrapErrorOptions`](../interfaces/WrapErrorOptions.md) | Options for the wrapped error |

## Returns

[`AgentError`](../classes/AgentError.md)

An AgentError instance

## Example

```typescript
try {
  await riskyOperation();
} catch (error) {
  throw wrapError(error, "Failed to perform risky operation", {
    code: "BACKEND_ERROR",
    metadata: { operation: "risky" },
  });
}
```
