[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FinishReason

# Type Alias: FinishReason

> **FinishReason** = `"stop"` \| `"length"` \| `"tool-calls"` \| `"error"` \| `"other"`

Defined in: [packages/agent-sdk/src/types.ts:1530](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1530)

Reason why the model finished generating.

- `stop` - Model generated a stop sequence or natural end
- `length` - Maximum tokens reached
- `tool-calls` - Model requested tool calls
- `error` - An error occurred
- `other` - Other/unknown reason
