[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / GuardrailsHooksOptions

# Interface: GuardrailsHooksOptions

Defined in: [packages/agent-sdk/src/hooks/guardrails.ts:20](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/guardrails.ts#L20)

Options for creating guardrails hooks.

## Properties

### blockedInputMessage?

> `optional` **blockedInputMessage**: `string`

Defined in: [packages/agent-sdk/src/hooks/guardrails.ts:37](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/guardrails.ts#L37)

Message to show when input is blocked.

#### Default Value

```ts
"Request blocked by content policy"
```

***

### blockedInputPatterns?

> `optional` **blockedInputPatterns**: `RegExp`[]

Defined in: [packages/agent-sdk/src/hooks/guardrails.ts:25](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/guardrails.ts#L25)

Regex patterns to block in input (user messages).
If matched, generation is denied.

***

### blockedOutputPatterns?

> `optional` **blockedOutputPatterns**: `RegExp`[]

Defined in: [packages/agent-sdk/src/hooks/guardrails.ts:31](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/guardrails.ts#L31)

Regex patterns to filter in output (model responses).
If matched, output is replaced with filterMessage.

***

### checkInput()?

> `optional` **checkInput**: (`input`: [`PreGenerateInput`](PreGenerateInput.md)) => [`PreGenerateInput`](PreGenerateInput.md) \| `undefined`

Defined in: [packages/agent-sdk/src/hooks/guardrails.ts:49](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/guardrails.ts#L49)

Custom input validation function.
Throw error to block, or return options to allow/transform.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | [`PreGenerateInput`](PreGenerateInput.md) |

#### Returns

[`PreGenerateInput`](PreGenerateInput.md) \| `undefined`

***

### checkOutput()?

> `optional` **checkOutput**: (`input`: [`PostGenerateInput`](PostGenerateInput.md)) => [`GenerateResultComplete`](GenerateResultComplete.md) \| `undefined`

Defined in: [packages/agent-sdk/src/hooks/guardrails.ts:55](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/guardrails.ts#L55)

Custom output validation function.
Return modified result to filter/transform output.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | [`PostGenerateInput`](PostGenerateInput.md) |

#### Returns

[`GenerateResultComplete`](GenerateResultComplete.md) \| `undefined`

***

### filteredOutputMessage?

> `optional` **filteredOutputMessage**: `string`

Defined in: [packages/agent-sdk/src/hooks/guardrails.ts:43](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/guardrails.ts#L43)

Message to replace filtered output with.

#### Default Value

```ts
"[Content filtered]"
```
