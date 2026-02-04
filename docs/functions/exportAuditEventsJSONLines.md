[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / exportAuditEventsJSONLines

# Function: exportAuditEventsJSONLines()

> **exportAuditEventsJSONLines**(): [`AuditEventHandler`](../type-aliases/AuditEventHandler.md)

Defined in: [packages/agent-sdk/src/hooks/audit.ts:425](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L425)

Export audit events to JSON Lines format.

Returns a function that writes audit events to console.log
in JSON Lines format (one JSON object per line), suitable for
log aggregation tools.

## Returns

[`AuditEventHandler`](../type-aliases/AuditEventHandler.md)

Audit event handler for JSON Lines export

## Example

```typescript
const auditHooks = createAuditHooks({
  onEvent: exportAuditEventsJSONLines(),
});
```
