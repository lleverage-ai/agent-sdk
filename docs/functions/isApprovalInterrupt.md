[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / isApprovalInterrupt

# Function: isApprovalInterrupt()

> **isApprovalInterrupt**(`interrupt`: [`Interrupt`](../interfaces/Interrupt.md)): `interrupt is ApprovalInterrupt`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:421](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L421)

Type guard to check if an interrupt is an ApprovalInterrupt.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `interrupt` | [`Interrupt`](../interfaces/Interrupt.md) | The interrupt to check |

## Returns

`interrupt is ApprovalInterrupt`

True if the interrupt is an ApprovalInterrupt
