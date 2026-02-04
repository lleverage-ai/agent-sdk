[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createAgentState

# Function: createAgentState()

> **createAgentState**(): [`AgentState`](../interfaces/AgentState.md)

Defined in: [packages/agent-sdk/src/backends/state.ts:528](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L528)

Create a new empty AgentState.

Convenience function to create a fresh state for testing or initialization.

## Returns

[`AgentState`](../interfaces/AgentState.md)

A new AgentState with empty todos and files

## Example

```typescript
const state = createAgentState();
const backend = new StateBackend(state);
```
