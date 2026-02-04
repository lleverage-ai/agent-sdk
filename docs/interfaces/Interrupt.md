[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / Interrupt

# Interface: Interrupt&lt;TRequest, TResponse&gt;

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:43](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L43)

Base interrupt type - the shared mechanism for pausing agent execution.

Interrupts allow the agent to pause execution and wait for external input.
This is a generalized pattern that supports:
- Tool approval requests (ApprovalInterrupt)
- User questions during tool execution
- Custom application-specific interrupts

## Example

```typescript
const interrupt: Interrupt = {
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

## Extended by

- [`ApprovalInterrupt`](ApprovalInterrupt.md)

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `TRequest` | `unknown` |
| `TResponse` | `unknown` |

## Properties

### createdAt

> **createdAt**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:59](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L59)

ISO 8601 timestamp when this interrupt was created

***

### id

> **id**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:45](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L45)

Unique identifier for this interrupt

***

### request

> **request**: `TRequest`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:55](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L55)

The request data for this interrupt (type varies by interrupt type)

***

### response?

> `optional` **response**: `TResponse`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:61](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L61)

The response to this interrupt (undefined = pending)

***

### step

> **step**: `number`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:57](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L57)

The step number when the interrupt occurred

***

### threadId

> **threadId**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:47](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L47)

The thread this interrupt belongs to

***

### toolCallId?

> `optional` **toolCallId**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:51](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L51)

The tool call ID if this interrupt is related to a tool call

***

### toolName?

> `optional` **toolName**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:53](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L53)

The tool name if this interrupt is related to a tool call

***

### type

> **type**: `string`

Defined in: [packages/agent-sdk/src/checkpointer/types.ts:49](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/checkpointer/types.ts#L49)

Type of interrupt (e.g., "approval", "question", custom types)
