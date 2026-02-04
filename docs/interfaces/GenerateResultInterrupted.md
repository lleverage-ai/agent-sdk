[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / GenerateResultInterrupted

# Interface: GenerateResultInterrupted

Defined in: [packages/agent-sdk/src/types.ts:1381](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1381)

Result from an interrupted generation request.

This is returned when the agent pauses for user input (e.g., tool approval,
custom questions during tool execution).

## Example

```typescript
const result = await agent.generate({ prompt, threadId });

if (result.status === "interrupted") {
  const { interrupt } = result;

  if (isApprovalInterrupt(interrupt)) {
    const approved = await askUser(`Run ${interrupt.request.toolName}?`);
    return agent.resume(threadId, interrupt.id, { approved });
  }
}
```

## Properties

### interrupt

> **interrupt**: [`Interrupt`](Interrupt.md)

Defined in: [packages/agent-sdk/src/types.ts:1386](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1386)

The interrupt that caused the pause

***

### partial?

> `optional` **partial**: [`PartialGenerateResult`](PartialGenerateResult.md)

Defined in: [packages/agent-sdk/src/types.ts:1389](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1389)

Partial results available at the time of interruption

***

### status

> **status**: `"interrupted"`

Defined in: [packages/agent-sdk/src/types.ts:1383](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1383)

Status indicating the generation was interrupted
