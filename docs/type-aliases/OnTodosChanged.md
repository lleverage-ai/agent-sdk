[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / OnTodosChanged

# Type Alias: OnTodosChanged()

> **OnTodosChanged** = (`data`: [`TodosChangedData`](../interfaces/TodosChangedData.md)) => `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/tools/todos.ts:57](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/todos.ts#L57)

Callback type for todo change events.

When provided to the todo tool, this callback is invoked whenever the todo list changes.
This enables integration with the hook system for emitting `todos:changed` events.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `data` | [`TodosChangedData`](../interfaces/TodosChangedData.md) | The change event data |

## Returns

`void` \| `Promise`&lt;`void`&gt;
