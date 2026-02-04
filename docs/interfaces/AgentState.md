[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / AgentState

# Interface: AgentState

Defined in: [packages/agent-sdk/src/backends/state.ts:99](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L99)

Complete agent state including todos and virtual filesystem.

This interface represents the full state that can be persisted,
shared between agents, or used with checkpointing.

## Example

```typescript
const state: AgentState = {
  todos: [],
  files: {
    "/notes.md": {
      content: ["# Notes", "", "Initial notes here."],
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    },
  },
};
```

## Properties

### files

> **files**: `Record`&lt;`string`, [`FileData`](FileData.md)&gt;

Defined in: [packages/agent-sdk/src/backends/state.ts:104](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L104)

Virtual filesystem (path -\> content)

***

### todos

> **todos**: [`TodoItem`](TodoItem.md)[]

Defined in: [packages/agent-sdk/src/backends/state.ts:101](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/state.ts#L101)

Current todo list
