[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / GuardrailCheckResult

# Interface: GuardrailCheckResult

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:22](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L22)

Result from a guardrail check.

## Properties

### blocked

> **blocked**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:24](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L24)

Whether the content should be blocked

***

### blockedMessageIds?

> `optional` **blockedMessageIds**: `string`[]

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:28](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L28)

IDs of messages that caused the block

***

### reason?

> `optional` **reason**: `string`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:26](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L26)

Reason for blocking (if blocked)
