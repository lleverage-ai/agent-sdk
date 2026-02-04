[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / RaceGuardrailsOptions

# Interface: RaceGuardrailsOptions

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:63](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L63)

Options for raceGuardrails.

## Properties

### blockedMessage?

> `optional` **blockedMessage**: `string`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:65](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L65)

Message to show when content is blocked

***

### blockedMessageIds?

> `optional` **blockedMessageIds**: `string`[]

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:67](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L67)

IDs of messages to remove from client history if blocked
