[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ApprovalInterrupt

# Interface: ApprovalInterrupt

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:110](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L110)

Approval interrupt - a specialized interrupt for tool approval requests.

When a tool requires user confirmation (via `canUseTool` returning "ask"),
the agent creates an approval interrupt and pauses execution.

## Example

```typescript
const approval: ApprovalInterrupt = {
  id: "int_abc123",
  threadId: "session-456",
  type: "approval",
  toolCallId: "call_abc123",
  toolName: "deleteFile",
  request: { toolName: "deleteFile", args: { path: "/important/file.txt" } },
  step: 5,
  createdAt: "2026-01-30T10:00:00Z",
};
```

## Extends

- [`Interrupt`](Interrupt.md)&lt;[`ApprovalRequest`](ApprovalRequest.md), [`ApprovalResponse`](ApprovalResponse.md)&gt;

## Properties

### createdAt

> **createdAt**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:59](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L59)

ISO 8601 timestamp when this interrupt was created

#### Inherited from

[`Interrupt`](Interrupt.md).[`createdAt`](Interrupt.md#createdat)

***

### id

> **id**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:45](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L45)

Unique identifier for this interrupt

#### Inherited from

[`Interrupt`](Interrupt.md).[`id`](Interrupt.md#id)

***

### request

> **request**: [`ApprovalRequest`](ApprovalRequest.md)

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:55](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L55)

The request data for this interrupt (type varies by interrupt type)

#### Inherited from

[`Interrupt`](Interrupt.md).[`request`](Interrupt.md#request)

***

### response?

> `optional` **response**: [`ApprovalResponse`](ApprovalResponse.md)

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:61](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L61)

The response to this interrupt (undefined = pending)

#### Inherited from

[`Interrupt`](Interrupt.md).[`response`](Interrupt.md#response)

***

### step

> **step**: `number`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:57](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L57)

The step number when the interrupt occurred

#### Inherited from

[`Interrupt`](Interrupt.md).[`step`](Interrupt.md#step)

***

### threadId

> **threadId**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:47](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L47)

The thread this interrupt belongs to

#### Inherited from

[`Interrupt`](Interrupt.md).[`threadId`](Interrupt.md#threadid)

***

### toolCallId

> **toolCallId**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:113](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L113)

Tool call ID is required for approval interrupts

#### Overrides

[`Interrupt`](Interrupt.md).[`toolCallId`](Interrupt.md#toolcallid)

***

### toolName

> **toolName**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:115](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L115)

Tool name is required for approval interrupts

#### Overrides

[`Interrupt`](Interrupt.md).[`toolName`](Interrupt.md#toolname)

***

### type

> **type**: `"approval"`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:111](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L111)

Type of interrupt (e.g., "approval", "question", custom types)

#### Overrides

[`Interrupt`](Interrupt.md).[`type`](Interrupt.md#type)
