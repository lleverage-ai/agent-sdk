[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ObservabilityEventStore

# Interface: ObservabilityEventStore

Defined in: [packages/agent-sdk/src/observability/events.ts:331](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L331)

In-memory store for collecting observability events.

## Example

```typescript
const store = createObservabilityEventStore({ maxSize: 1000 });

// Add events
store.add(mcpFailedEvent);
store.add(toolRegisteredEvent);

// Export periodically
setInterval(() => {
  const jsonl = exportEventsJSONLines(store.getAll());
  await sendToLogAggregator(jsonl);
  store.clear();
}, 60000);
```

## Properties

### add()

> **add**: (`event`: [`ObservabilityEvent`](../type-aliases/ObservabilityEvent.md)) => `void`

Defined in: [packages/agent-sdk/src/observability/events.ts:333](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L333)

Add an event to the store

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `event` | [`ObservabilityEvent`](../type-aliases/ObservabilityEvent.md) |

#### Returns

`void`

***

### clear()

> **clear**: () => `void`

Defined in: [packages/agent-sdk/src/observability/events.ts:344](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L344)

Clear all events

#### Returns

`void`

***

### getAll()

> **getAll**: () => [`ObservabilityEvent`](../type-aliases/ObservabilityEvent.md)[]

Defined in: [packages/agent-sdk/src/observability/events.ts:336](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L336)

Get all events

#### Returns

[`ObservabilityEvent`](../type-aliases/ObservabilityEvent.md)[]

***

### getByType()

> **getByType**: (`type`: `"PreCompact"` \| `"PostCompact"` \| `"MCPConnectionFailed"` \| `"MCPConnectionRestored"` \| `"ToolRegistered"` \| `"ToolLoadError"`) => [`ObservabilityEvent`](../type-aliases/ObservabilityEvent.md)[]

Defined in: [packages/agent-sdk/src/observability/events.ts:339](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L339)

Get events by type

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `type` | `"PreCompact"` \| `"PostCompact"` \| `"MCPConnectionFailed"` \| `"MCPConnectionRestored"` \| `"ToolRegistered"` \| `"ToolLoadError"` |

#### Returns

[`ObservabilityEvent`](../type-aliases/ObservabilityEvent.md)[]

***

### size()

> **size**: () => `number`

Defined in: [packages/agent-sdk/src/observability/events.ts:347](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L347)

Get current event count

#### Returns

`number`
