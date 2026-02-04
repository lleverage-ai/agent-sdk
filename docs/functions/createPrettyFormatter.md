[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createPrettyFormatter

# Function: createPrettyFormatter()

> **createPrettyFormatter**(`options?`: \{ `colors?`: `boolean`; `timestamp?`: `boolean`; \}): [`LogFormatter`](../interfaces/LogFormatter.md)

Defined in: [packages/agent-sdk/src/observability/logger.ts:242](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L242)

Creates a human-readable formatter with colors.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options?` | \{ `colors?`: `boolean`; `timestamp?`: `boolean`; \} | Formatter options |
| `options.colors?` | `boolean` | Enable ANSI colors |
| `options.timestamp?` | `boolean` | Include timestamp |

## Returns

[`LogFormatter`](../interfaces/LogFormatter.md)

A pretty formatter

## Example

```typescript
const logger = createLogger({
  formatter: createPrettyFormatter({ colors: true }),
});
```
