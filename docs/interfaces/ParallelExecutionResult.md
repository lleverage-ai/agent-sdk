[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ParallelExecutionResult

# Interface: ParallelExecutionResult

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:194](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L194)

Result from parallel subagent execution.

## Properties

### allSucceeded

> **allSucceeded**: `boolean`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:208](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L208)

Whether all executions succeeded

***

### failureCount

> **failureCount**: `number`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:202](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L202)

Number of failed executions

***

### results

> **results**: [`SubagentExecutionResult`](SubagentExecutionResult.md)[]

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:196](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L196)

Individual results for each subagent

***

### successCount

> **successCount**: `number`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:199](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L199)

Number of successful executions

***

### totalDuration

> **totalDuration**: `number`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:205](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L205)

Total duration (max of individual durations)
