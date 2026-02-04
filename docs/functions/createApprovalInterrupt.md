[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createApprovalInterrupt

# Function: createApprovalInterrupt()

> **createApprovalInterrupt**(`data`: \{ `args`: `unknown`; `id`: `string`; `step?`: `number`; `threadId`: `string`; `toolCallId`: `string`; `toolName`: `string`; \}): [`ApprovalInterrupt`](../interfaces/ApprovalInterrupt.md)

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:456](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L456)

Create an approval interrupt for a tool call.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `data` | \{ `args`: `unknown`; `id`: `string`; `step?`: `number`; `threadId`: `string`; `toolCallId`: `string`; `toolName`: `string`; \} | The approval interrupt data |
| `data.args` | `unknown` | - |
| `data.id` | `string` | - |
| `data.step?` | `number` | - |
| `data.threadId` | `string` | - |
| `data.toolCallId` | `string` | - |
| `data.toolName` | `string` | - |

## Returns

[`ApprovalInterrupt`](../interfaces/ApprovalInterrupt.md)

A complete ApprovalInterrupt object
