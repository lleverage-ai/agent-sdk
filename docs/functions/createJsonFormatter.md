[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createJsonFormatter

# Function: createJsonFormatter()

> **createJsonFormatter**(): [`LogFormatter`](../interfaces/LogFormatter.md)

Defined in: [packages/agent-sdk/src/observability/logger.ts:193](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L193)

Creates a JSON formatter for structured logging.

## Returns

[`LogFormatter`](../interfaces/LogFormatter.md)

A JSON formatter

## Example

```typescript
const logger = createLogger({
  formatter: createJsonFormatter(),
});
```
