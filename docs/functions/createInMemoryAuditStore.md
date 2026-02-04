[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createInMemoryAuditStore

# Function: createInMemoryAuditStore()

> **createInMemoryAuditStore**(`maxEvents`: `number`): \{ `clear`: () => `void`; `getEvents`: () => [`AuditEvent`](../interfaces/AuditEvent.md)[]; `onEvent`: [`AuditEventHandler`](../type-aliases/AuditEventHandler.md); \}

Defined in: [packages/agent-sdk/src/hooks/audit.ts:453](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L453)

Creates an in-memory audit event store.

Useful for testing and development. Events are kept in memory
with a configurable size limit.

## Parameters

| Parameter | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `maxEvents` | `number` | `1000` | Maximum events to keep |

## Returns

\{ `clear`: () => `void`; `getEvents`: () => [`AuditEvent`](../interfaces/AuditEvent.md)[]; `onEvent`: [`AuditEventHandler`](../type-aliases/AuditEventHandler.md); \}

Object with event handler and getter

### clear()

> **clear**: () => `void`

#### Returns

`void`

### getEvents()

> **getEvents**: () => [`AuditEvent`](../interfaces/AuditEvent.md)[]

#### Returns

[`AuditEvent`](../interfaces/AuditEvent.md)[]

### onEvent

> **onEvent**: [`AuditEventHandler`](../type-aliases/AuditEventHandler.md)

## Example

```typescript
const { onEvent, getEvents, clear } = createInMemoryAuditStore(1000);

const auditHooks = createAuditHooks({ onEvent });

// Later, retrieve events
const events = getEvents();
console.log(`Captured ${events.length} audit events`);
```
