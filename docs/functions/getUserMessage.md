[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / getUserMessage

# Function: getUserMessage()

> **getUserMessage**(`error`: `unknown`, `fallback`: `string`): `string`

Defined in: [packages/agent-sdk/src/errors/index.ts:1052](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/errors/index.ts#L1052)

Get a user-friendly error message from any error.

## Parameters

| Parameter | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `error` | `unknown` | `undefined` | The error to get a message from |
| `fallback` | `string` | `"An unexpected error occurred. Please try again."` | Fallback message if extraction fails |

## Returns

`string`

A user-friendly error message
