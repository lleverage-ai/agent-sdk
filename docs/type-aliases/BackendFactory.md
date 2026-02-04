[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / BackendFactory

# Type Alias: BackendFactory()

> **BackendFactory** = (`state`: [`AgentState`](../interfaces/AgentState.md)) => [`BackendProtocol`](../interfaces/BackendProtocol.md)

Defined in: [packages/agent-sdk/src/types.ts:255](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L255)

Factory function for creating backends lazily.

Backends can be provided as an instance or as a factory function.
Factory functions receive the agent state and return a backend instance,
allowing backends to be initialized with the shared state.

## Parameters

| Parameter | Type |
| :------ | :------ |
| `state` | [`AgentState`](../interfaces/AgentState.md) |

## Returns

[`BackendProtocol`](../interfaces/BackendProtocol.md)

## Example

```typescript
// Direct instance
const agent = createAgent({
  model,
  backend: new FilesystemBackend({ rootDir: process.cwd() }),
});

// Factory function (receives shared state)
const agent = createAgent({
  model,
  backend: (state) => new StateBackend(state),
});
```
