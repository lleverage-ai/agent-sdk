[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createConsoleTransport

# Function: createConsoleTransport()

> **createConsoleTransport**(`options?`: \{ `formatter?`: [`LogFormatter`](../interfaces/LogFormatter.md); `streams?`: `Partial`&lt;`Record`&lt;[`LogLevel`](../type-aliases/LogLevel.md), (`message`: `string`) => `void`&gt;&gt;; \}): [`LogTransport`](../interfaces/LogTransport.md)

Defined in: [packages/agent-sdk/src/observability/logger.ts:338](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L338)

Creates a console transport.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options?` | \{ `formatter?`: [`LogFormatter`](../interfaces/LogFormatter.md); `streams?`: `Partial`&lt;`Record`&lt;[`LogLevel`](../type-aliases/LogLevel.md), (`message`: `string`) => `void`&gt;&gt;; \} | Transport options |
| `options.formatter?` | [`LogFormatter`](../interfaces/LogFormatter.md) | Custom formatter |
| `options.streams?` | `Partial`&lt;`Record`&lt;[`LogLevel`](../type-aliases/LogLevel.md), (`message`: `string`) => `void`&gt;&gt; | Output stream for each level |

## Returns

[`LogTransport`](../interfaces/LogTransport.md)

A console transport

## Example

```typescript
const logger = createLogger({
  transports: [createConsoleTransport()],
});
```
