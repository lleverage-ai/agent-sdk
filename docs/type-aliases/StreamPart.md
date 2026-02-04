[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / StreamPart

# Type Alias: StreamPart

> **StreamPart** = \{ `text`: `string`; `type`: `"text-delta"`; \} \| \{ `input`: `unknown`; `toolCallId`: `string`; `toolName`: `string`; `type`: `"tool-call"`; \} \| \{ `output`: `unknown`; `toolCallId`: `string`; `toolName`: `string`; `type`: `"tool-result"`; \} \| \{ `finishReason`: [`FinishReason`](FinishReason.md); `type`: `"finish"`; `usage?`: [`LanguageModelUsage`](LanguageModelUsage.md); \} \| \{ `error`: `Error`; `type`: `"error"`; \} \| \{ `data`: [`AgentDataTypes`](../interfaces/AgentDataTypes.md)\[`"subagent-spawn"`\]; `type`: `"subagent-spawn"`; \} \| \{ `data`: [`AgentDataTypes`](../interfaces/AgentDataTypes.md)\[`"subagent-complete"`\]; `type`: `"subagent-complete"`; \} \| \{ `data`: [`AgentDataTypes`](../interfaces/AgentDataTypes.md)\[`"agent-progress"`\]; `type`: `"agent-progress"`; \}

Defined in: [packages/agent-sdk/src/types.ts:1555](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1555)

A part from streaming generation.
Aligns with AI SDK stream parts plus agent-specific events.
