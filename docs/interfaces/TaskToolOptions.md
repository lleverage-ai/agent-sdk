[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / TaskToolOptions

# Interface: TaskToolOptions

Defined in: [packages/agent-sdk/src/types.ts:2355](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2355)

Configuration for creating a task delegation tool.

## Properties

### description?

> `optional` **description**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2363](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2363)

Description of what the task tool does

***

### name?

> `optional` **name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2360](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2360)

Name for the task tool.

#### Default Value

```ts
"task"
```

***

### subagents

> **subagents**: [`SubagentDefinition`](SubagentDefinition.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2366](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2366)

Available subagent types that can be delegated to
