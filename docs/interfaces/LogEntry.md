[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LogEntry

# Interface: LogEntry

Defined in: [packages/agent-sdk/src/observability/logger.ts:41](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L41)

A structured log entry.

## Properties

### context?

> `optional` **context**: `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/observability/logger.ts:49](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L49)

Optional context/metadata

***

### durationMs?

> `optional` **durationMs**: `number`

Defined in: [packages/agent-sdk/src/observability/logger.ts:53](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L53)

Optional duration in milliseconds

***

### error?

> `optional` **error**: `Error`

Defined in: [packages/agent-sdk/src/observability/logger.ts:51](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L51)

Optional error object

***

### level

> **level**: [`LogLevel`](../type-aliases/LogLevel.md)

Defined in: [packages/agent-sdk/src/observability/logger.ts:43](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L43)

Log level

***

### logger?

> `optional` **logger**: `string`

Defined in: [packages/agent-sdk/src/observability/logger.ts:55](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L55)

Logger name/namespace

***

### message

> **message**: `string`

Defined in: [packages/agent-sdk/src/observability/logger.ts:45](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L45)

Log message

***

### timestamp

> **timestamp**: `string`

Defined in: [packages/agent-sdk/src/observability/logger.ts:47](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L47)

ISO timestamp
