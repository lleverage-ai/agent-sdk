[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CustomTokenCounterOptions

# Interface: CustomTokenCounterOptions

Defined in: [packages/agent-sdk/src/context-manager.ts:188](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L188)

Options for creating a custom token counter.

## Properties

### countFn()

> **countFn**: (`text`: `string`) => `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:193](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L193)

Custom function to count tokens in text.
Use this to integrate model-specific tokenizers like tiktoken.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `text` | `string` |

#### Returns

`number`

***

### messageOverhead?

> `optional` **messageOverhead**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:199](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L199)

Overhead tokens per message (default: 4).
Accounts for message structure tokens.
