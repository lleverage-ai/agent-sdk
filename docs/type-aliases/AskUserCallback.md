[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / AskUserCallback

# Type Alias: AskUserCallback()

> **AskUserCallback** = (`question`: `string`, `options`: [`QuestionOption`](../interfaces/QuestionOption.md)[], `multiSelect`: `boolean`) => `Promise`&lt;`string` \| `string`[]&gt;

Defined in: [packages/agent-sdk/src/tools/user-interaction.ts:38](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/user-interaction.ts#L38)

Callback function to prompt the user for input.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `question` | `string` | The question to ask the user |
| `options` | [`QuestionOption`](../interfaces/QuestionOption.md)[] | Available answer options |
| `multiSelect` | `boolean` | Whether the user can select multiple options |

## Returns

`Promise`&lt;`string` \| `string`[]&gt;

The selected option value(s) as string or string array
