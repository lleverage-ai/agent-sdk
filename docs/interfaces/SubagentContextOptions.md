[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentContextOptions

# Interface: SubagentContextOptions

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:61](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L61)

Options for creating an isolated subagent context.

## Properties

### initialTodos?

> `optional` **initialTodos**: [`TodoItem`](TodoItem.md)[]

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:80](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L80)

Initial todos for the subagent (only used if isolateTodos is true).

***

### isolateTodos?

> `optional` **isolateTodos**: `boolean`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:75](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L75)

Whether to isolate todos (give subagent empty todos).

#### Default Value

```ts
true
```

***

### parentState

> **parentState**: [`AgentState`](AgentState.md)

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:63](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L63)

Parent agent state to derive from

***

### shareFiles?

> `optional` **shareFiles**: `boolean`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:69](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L69)

Whether to share files with parent.

#### Default Value

```ts
true
```
