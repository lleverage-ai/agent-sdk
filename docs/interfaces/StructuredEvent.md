[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / StructuredEvent

# Interface: StructuredEvent

Defined in: [packages/agent-sdk/src/observability/events.ts:38](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L38)

Structured event for export with standardized fields.

## Properties

### event\_type

> **event\_type**: `string`

Defined in: [packages/agent-sdk/src/observability/events.ts:43](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L43)

Event type

***

### message

> **message**: `string`

Defined in: [packages/agent-sdk/src/observability/events.ts:49](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L49)

Human-readable message

***

### metadata

> **metadata**: `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/observability/events.ts:52](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L52)

Structured metadata

***

### session\_id?

> `optional` **session\_id**: `string`

Defined in: [packages/agent-sdk/src/observability/events.ts:55](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L55)

Session ID (if available)

***

### severity

> **severity**: [`EventSeverity`](../type-aliases/EventSeverity.md)

Defined in: [packages/agent-sdk/src/observability/events.ts:46](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L46)

Severity level

***

### timestamp

> **timestamp**: `string`

Defined in: [packages/agent-sdk/src/observability/events.ts:40](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L40)

Timestamp in ISO format
