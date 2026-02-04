[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / toStructuredEvent

# Function: toStructuredEvent()

> **toStructuredEvent**(`event`: [`ObservabilityEvent`](../type-aliases/ObservabilityEvent.md)): [`StructuredEvent`](../interfaces/StructuredEvent.md)

Defined in: [packages/agent-sdk/src/observability/events.ts:78](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L78)

Convert an observability event to a structured event.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `event` | [`ObservabilityEvent`](../type-aliases/ObservabilityEvent.md) | The hook input event |

## Returns

[`StructuredEvent`](../interfaces/StructuredEvent.md)

Structured event ready for export
