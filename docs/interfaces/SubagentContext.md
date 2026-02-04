[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentContext

# Interface: SubagentContext

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:88](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L88)

Isolated context for a subagent execution.

## Properties

### filesShared

> **filesShared**: `boolean`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:96](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L96)

Whether files are shared with parent

***

### parentState

> **parentState**: [`AgentState`](AgentState.md)

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:93](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L93)

Reference to the parent state (for merging back)

***

### state

> **state**: [`AgentState`](AgentState.md)

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:90](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L90)

The subagent's isolated state

***

### todosIsolated

> **todosIsolated**: `boolean`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:99](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L99)

Whether todos are isolated
