[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / AuditHooksOptions

# Interface: AuditHooksOptions

Defined in: [packages/agent-sdk/src/hooks/audit.ts:99](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L99)

Options for creating audit hooks.

## Properties

### auditErrors?

> `optional` **auditErrors**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:128](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L128)

Whether to audit errors.

#### Default Value

```ts
true
```

***

### auditGeneration?

> `optional` **auditGeneration**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:122](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L122)

Whether to audit generation.

#### Default Value

```ts
true
```

***

### auditTools?

> `optional` **auditTools**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:116](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L116)

Whether to audit tool execution.

#### Default Value

```ts
true
```

***

### categories?

> `optional` **categories**: [`AuditEventCategory`](../type-aliases/AuditEventCategory.md)[]

Defined in: [packages/agent-sdk/src/hooks/audit.ts:110](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L110)

Categories to audit.

#### Default Value

```ts
All categories
```

***

### metadata?

> `optional` **metadata**: `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/hooks/audit.ts:133](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L133)

Additional metadata to include in all events.

***

### onEvent

> **onEvent**: [`AuditEventHandler`](../type-aliases/AuditEventHandler.md)

Defined in: [packages/agent-sdk/src/hooks/audit.ts:104](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L104)

Event handler function.
Called for each audit event.
