[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / applyMiddleware

# Function: applyMiddleware()

> **applyMiddleware**(`middleware`: [`AgentMiddleware`](../interfaces/AgentMiddleware.md)[]): [`HookRegistration`](../interfaces/HookRegistration.md)

Defined in: [packages/agent-sdk/src/middleware/apply.ts:36](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/apply.ts#L36)

Applies an array of middleware and returns the combined HookRegistration.

Processes middleware in order, preserving hook registration order.
Each middleware's hooks are added to the combined registration in the
order the middleware appears in the array.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `middleware` | [`AgentMiddleware`](../interfaces/AgentMiddleware.md)[] | Array of middleware to apply |

## Returns

[`HookRegistration`](../interfaces/HookRegistration.md)

Combined HookRegistration from all middleware

## Example

```typescript
const middleware = [
  createLoggingMiddleware({ transport: consoleTransport }),
  createMetricsMiddleware({ registry }),
];

const hooks = applyMiddleware(middleware);
// hooks contains all hooks from both middleware
```
