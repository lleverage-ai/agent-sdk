[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / TodosChangedData

# Interface: TodosChangedData

Defined in: [packages/agent-sdk/src/tools/todos.ts:30](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/todos.ts#L30)

Data for todo change events.

## Properties

### affectedIds

> **affectedIds**: `string`[]

Defined in: [packages/agent-sdk/src/tools/todos.ts:36](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/todos.ts#L36)

IDs of affected todos

***

### changeType

> **changeType**: [`TodoChangeType`](../type-aliases/TodoChangeType.md)

Defined in: [packages/agent-sdk/src/tools/todos.ts:34](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/todos.ts#L34)

Type of change

***

### summary

> **summary**: \{ `completed`: `number`; `inProgress`: `number`; `pending`: `number`; \}

Defined in: [packages/agent-sdk/src/tools/todos.ts:40](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/todos.ts#L40)

Summary of current todos

#### completed

> **completed**: `number`

#### inProgress

> **inProgress**: `number`

#### pending

> **pending**: `number`

***

### totalCount

> **totalCount**: `number`

Defined in: [packages/agent-sdk/src/tools/todos.ts:38](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/todos.ts#L38)

Total count of todos

***

### type

> **type**: `"todosChanged"`

Defined in: [packages/agent-sdk/src/tools/todos.ts:32](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/todos.ts#L32)

Discriminator type
