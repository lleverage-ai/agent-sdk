[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LoggingMiddlewareOptions

# Interface: LoggingMiddlewareOptions

Defined in: [packages/agent-sdk/src/middleware/logging.ts:34](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/logging.ts#L34)

Options for configuring logging middleware.

## Properties

### events?

> `optional` **events**: \{ `compaction?`: `boolean`; `failures?`: `boolean`; `generation?`: `boolean`; `interrupts?`: `boolean`; `subagents?`: `boolean`; `tools?`: `boolean`; \}

Defined in: [packages/agent-sdk/src/middleware/logging.ts:66](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/logging.ts#L66)

Which events to log.

#### compaction?

> `optional` **compaction**: `boolean`

Log context compaction events

#### failures?

> `optional` **failures**: `boolean`

Log failure/error events

#### generation?

> `optional` **generation**: `boolean`

Log generation start/end events

#### interrupts?

> `optional` **interrupts**: `boolean`

Log interrupt events (approval requests, custom interrupts)

#### subagents?

> `optional` **subagents**: `boolean`

Log subagent events

#### tools?

> `optional` **tools**: `boolean`

Log tool use events

#### Default

```ts
all enabled
```

***

### includeTiming?

> `optional` **includeTiming**: `boolean`

Defined in: [packages/agent-sdk/src/middleware/logging.ts:91](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/logging.ts#L91)

Include timing information in logs.

#### Default

```ts
true
```

***

### level?

> `optional` **level**: [`LogLevel`](../type-aliases/LogLevel.md)

Defined in: [packages/agent-sdk/src/middleware/logging.ts:60](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/logging.ts#L60)

Log level for filtering events.

#### Default

```ts
"info"
```

***

### maxContentLength?

> `optional` **maxContentLength**: `number`

Defined in: [packages/agent-sdk/src/middleware/logging.ts:85](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/logging.ts#L85)

Maximum content length for truncation.

#### Default

```ts
500
```

***

### name?

> `optional` **name**: `string`

Defined in: [packages/agent-sdk/src/middleware/logging.ts:97](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/logging.ts#L97)

Logger name for identification.

#### Default

```ts
"agent"
```

***

### transport

> **transport**: [`LogTransport`](LogTransport.md)

Defined in: [packages/agent-sdk/src/middleware/logging.ts:54](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/logging.ts#L54)

Transport to write logs to.

The transport determines where logs go - could be console, file,
or streaming to a client. SDK is agnostic to the destination.

#### Example

```typescript
// Console logging
import { createConsoleTransport } from "@lleverage-ai/agent-sdk";
const transport = createConsoleTransport();

// Custom transport (e.g., streaming to client)
const streamTransport: LogTransport = {
  name: "stream",
  write: (entry) => res.write(JSON.stringify(entry) + "\n"),
};
```
