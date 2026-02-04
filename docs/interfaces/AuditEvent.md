[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / AuditEvent

# Interface: AuditEvent

Defined in: [packages/agent-sdk/src/hooks/audit.ts:39](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L39)

Structured audit event.

## Properties

### category

> **category**: [`AuditEventCategory`](../type-aliases/AuditEventCategory.md)

Defined in: [packages/agent-sdk/src/hooks/audit.ts:41](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L41)

Event category

***

### error?

> `optional` **error**: `string`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:65](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L65)

Error message (for failure events)

***

### event

> **event**: `string`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:44](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L44)

Event type (hook event name)

***

### metadata?

> `optional` **metadata**: `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/hooks/audit.ts:84](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L84)

Additional metadata

***

### model?

> `optional` **model**: `string`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:74](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L74)

Model used (for generation events)

***

### permissionDecision?

> `optional` **permissionDecision**: `"allow"` \| `"deny"` \| `"ask"`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:68](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L68)

Permission decision (for PreToolUse/PreGenerate with permission checks)

***

### permissionDecisionReason?

> `optional` **permissionDecisionReason**: `string`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:71](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L71)

Permission decision reason

***

### sessionId

> **sessionId**: `string`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:50](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L50)

Session ID

***

### timestamp

> **timestamp**: `number`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:47](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L47)

Timestamp (milliseconds since epoch)

***

### toolInput?

> `optional` **toolInput**: `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/hooks/audit.ts:59](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L59)

Tool input (for tool events)

***

### toolName?

> `optional` **toolName**: `string`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:56](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L56)

Tool name (for tool events)

***

### toolOutput?

> `optional` **toolOutput**: `unknown`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:62](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L62)

Tool output (for PostToolUse)

***

### toolUseId?

> `optional` **toolUseId**: `string` \| `null`

Defined in: [packages/agent-sdk/src/hooks/audit.ts:53](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L53)

Tool use ID (for tool events)

***

### usage?

> `optional` **usage**: \{ `inputTokens?`: `number`; `outputTokens?`: `number`; `totalTokens?`: `number`; \}

Defined in: [packages/agent-sdk/src/hooks/audit.ts:77](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/audit.ts#L77)

Token usage (for generation events)

#### inputTokens?

> `optional` **inputTokens**: `number`

#### outputTokens?

> `optional` **outputTokens**: `number`

#### totalTokens?

> `optional` **totalTokens**: `number`
