[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createLoggingMiddleware

# Function: createLoggingMiddleware()

> **createLoggingMiddleware**(`options`: [`LoggingMiddlewareOptions`](../interfaces/LoggingMiddlewareOptions.md)): [`AgentMiddleware`](../interfaces/AgentMiddleware.md)

Defined in: [packages/agent-sdk/src/middleware/logging.ts:179](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/logging.ts#L179)

Creates logging middleware that logs agent lifecycle events.

The transport determines where logs go - SDK is agnostic. If you want
streaming to a client, create a transport that writes to your stream.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`LoggingMiddlewareOptions`](../interfaces/LoggingMiddlewareOptions.md) | Logging middleware configuration |

## Returns

[`AgentMiddleware`](../interfaces/AgentMiddleware.md)

AgentMiddleware instance

## Examples

```typescript
// Console logging
import { createAgent, createLoggingMiddleware, createConsoleTransport } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  middleware: [
    createLoggingMiddleware({ transport: createConsoleTransport() }),
  ],
});
```

```typescript
// Custom transport (e.g., streaming to client)
const streamTransport: LogTransport = {
  name: "client-stream",
  write: (entry) => {
    // User decides how to get this to the client
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  },
};

const agent = createAgent({
  model,
  middleware: [
    createLoggingMiddleware({ transport: streamTransport }),
  ],
});
```

```typescript
// External service (e.g., Datadog)
const datadogTransport: LogTransport = {
  name: "datadog",
  write: (entry) => datadog.log(entry.level, entry.message, entry.context),
};

const agent = createAgent({
  model,
  middleware: [
    createLoggingMiddleware({ transport: datadogTransport }),
  ],
});
```
