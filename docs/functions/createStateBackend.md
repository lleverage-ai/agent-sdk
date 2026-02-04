[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createStateBackend

# Function: createStateBackend()

> **createStateBackend**(): (`state`: [`AgentState`](../interfaces/AgentState.md)) => [`StateBackend`](../classes/StateBackend.md)

Defined in: [packages/agent-sdk/src/backends/state.ts:509](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L509)

Create a StateBackend factory function.

This is useful when you need to defer backend creation until state is available,
such as when integrating with the agent system.

## Returns

A factory function that creates a StateBackend from AgentState

> (`state`: [`AgentState`](../interfaces/AgentState.md)): [`StateBackend`](../classes/StateBackend.md)

### Parameters

| Parameter | Type |
| :------ | :------ |
| `state` | [`AgentState`](../interfaces/AgentState.md) |

### Returns

[`StateBackend`](../classes/StateBackend.md)

## Example

```typescript
const backendFactory = createStateBackend();

// Later, when state is available:
const state: AgentState = { todos: [], files: {} };
const backend = backendFactory(state);
```
