[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createAuditHooks

# Function: createAuditHooks()

> **createAuditHooks**(`options`: [`AuditHooksOptions`](../interfaces/AuditHooksOptions.md)): [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/hooks/audit.ts:225](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L225)

Creates audit hooks for all lifecycle events.

Emits structured audit events for tool execution, generation,
and errors. Useful for compliance, security monitoring, and
debugging.

This addresses the audit events requirement from CODE_REVIEW.md
using the unified hook system.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`AuditHooksOptions`](../interfaces/AuditHooksOptions.md) | Configuration options |

## Returns

[`HookCallback`](../type-aliases/HookCallback.md)[]

Array of hooks for all audited events

## Examples

```typescript
const auditHooks = createAuditHooks({
  onEvent: (event) => {
    // Send to your logging service
    logger.info('Audit event', event);

    // Send to SIEM
    siem.send(event);

    // Store in database
    db.auditEvents.insert(event);
  },
});

const agent = createAgent({
  model,
  hooks: {
    PreToolUse: [{ hooks: [auditHooks[0]] }],
    PostToolUse: [{ hooks: [auditHooks[1]] }],
    PostToolUseFailure: [{ hooks: [auditHooks[2]] }],
    PreGenerate: [{ hooks: [auditHooks[3]] }],
    PostGenerate: [{ hooks: [auditHooks[4]] }],
    PostGenerateFailure: [{ hooks: [auditHooks[5]] }],
  },
});
```

```typescript
// Selective auditing
const auditHooks = createAuditHooks({
  categories: ['command_execution', 'file_access', 'policy_denial'],
  onEvent: (event) => {
    if (event.category === 'command_execution') {
      securityLog.command(event);
    }
  },
});
```

```typescript
// JSON lines export for log aggregation
const auditHooks = createAuditHooks({
  onEvent: (event) => {
    console.log(JSON.stringify(event));
  },
});
```
