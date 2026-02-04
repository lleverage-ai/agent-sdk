[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / setDefaultLogger

# Function: setDefaultLogger()

> **setDefaultLogger**(`logger`: [`Logger`](../interfaces/Logger.md)): `void`

Defined in: [packages/agent-sdk/src/observability/logger.ts:694](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L694)

Sets the default global logger.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `logger` | [`Logger`](../interfaces/Logger.md) | The logger to use as default |

## Returns

`void`

## Example

```typescript
const customLogger = createLogger({
  name: "my-app",
  level: "debug",
});

setDefaultLogger(customLogger);
```
