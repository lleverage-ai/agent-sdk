[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createLogger

# Function: createLogger()

> **createLogger**(`options`: [`LoggerOptions`](../interfaces/LoggerOptions.md)): [`Logger`](../interfaces/Logger.md)

Defined in: [packages/agent-sdk/src/observability/logger.ts:488](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L488)

Creates a structured logger.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`LoggerOptions`](../interfaces/LoggerOptions.md) | Logger options |

## Returns

[`Logger`](../interfaces/Logger.md)

A logger instance

## Example

```typescript
const logger = createLogger({
  name: "my-agent",
  level: "info",
  context: { version: "1.0.0" },
});

logger.info("Agent started", { model: "claude-3" });
logger.debug("Debug info"); // Not logged (level is info)

const childLogger = logger.child("tools");
childLogger.info("Tool called"); // Logs with logger="my-agent:tools"
```
