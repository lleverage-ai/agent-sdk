[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / StreamingMetadata

# Interface: StreamingMetadata

Defined in: [packages/agent-sdk/src/types.ts:145](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L145)

Metadata identifying the source of streamed data.

Used to identify which agent or subagent produced data in multi-agent
streaming scenarios, similar to LangGraph's namespace pattern.

## Properties

### agentId

> **agentId**: `string`

Defined in: [packages/agent-sdk/src/types.ts:149](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L149)

Unique identifier for this agent instance

***

### agentType

> **agentType**: `string`

Defined in: [packages/agent-sdk/src/types.ts:147](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L147)

The type of agent (e.g., "ui-builder", "researcher")

***

### parentAgentId?

> `optional` **parentAgentId**: `string`

Defined in: [packages/agent-sdk/src/types.ts:151](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L151)

Parent agent ID if this is a subagent
