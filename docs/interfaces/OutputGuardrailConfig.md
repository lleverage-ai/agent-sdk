[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / OutputGuardrailConfig

# Interface: OutputGuardrailConfig

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:289](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L289)

Configuration for buffered output guardrails.

## Properties

### blockedMessage?

> `optional` **blockedMessage**: `string`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:320](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L320)

Message to show when content is blocked.

#### Default

```ts
"Output blocked by guardrail"
```

***

### checkIntervalMs?

> `optional` **checkIntervalMs**: `number`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:308](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L308)

Check interval in milliseconds.
If set, runs periodic checks on accumulated buffer.

#### Default

```ts
undefined (only check at end)
```

***

### guardrails

> **guardrails**: [`Guardrail`](../type-aliases/Guardrail.md) \| [`Guardrail`](../type-aliases/Guardrail.md)[]

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:294](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L294)

Guardrail to run on accumulated output.
Can be a single guardrail or multiple that will be raced.

***

### minBufferSize?

> `optional` **minBufferSize**: `number`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:301](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L301)

Minimum buffer size (in characters) before running checks.
Helps avoid excessive API calls for small outputs.

#### Default

```ts
100
```

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:314](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L314)

Timeout for guardrail checks in milliseconds.

#### Default

```ts
30000 (30 seconds)
```
