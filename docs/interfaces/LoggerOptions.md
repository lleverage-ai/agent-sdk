[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LoggerOptions

# Interface: LoggerOptions

Defined in: [packages/agent-sdk/src/observability/logger.ts:89](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L89)

Options for creating a logger.

## Properties

### context?

> `optional` **context**: `Record`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/observability/logger.ts:97](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L97)

Base context to include in all log entries

***

### formatter?

> `optional` **formatter**: [`LogFormatter`](LogFormatter.md)

Defined in: [packages/agent-sdk/src/observability/logger.ts:99](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L99)

Custom formatter

***

### level?

> `optional` **level**: [`LogLevel`](../type-aliases/LogLevel.md)

Defined in: [packages/agent-sdk/src/observability/logger.ts:93](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L93)

Minimum log level to emit

***

### name?

> `optional` **name**: `string`

Defined in: [packages/agent-sdk/src/observability/logger.ts:91](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L91)

Logger name/namespace

***

### transports?

> `optional` **transports**: [`LogTransport`](LogTransport.md)[]

Defined in: [packages/agent-sdk/src/observability/logger.ts:95](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L95)

Transports to write to
