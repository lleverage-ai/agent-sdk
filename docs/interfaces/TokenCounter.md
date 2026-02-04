[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / TokenCounter

# Interface: TokenCounter

Defined in: [packages/agent-sdk/src/context-manager.ts:28](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L28)

Interface for counting tokens in text and messages.

Implementations can use different tokenization strategies:
- Approximate counting (4 chars ≈ 1 token)
- Model-specific tokenizers (tiktoken, etc.)

## Methods

### count()

> **count**(`text`: `string`): `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:34](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L34)

Count tokens in a text string.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `text` | `string` | The text to count tokens in |

#### Returns

`number`

The estimated token count

***

### countMessages()

> **countMessages**(`messages`: [`ModelMessage`](../type-aliases/ModelMessage.md)[]): `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:41](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L41)

Count tokens in an array of messages.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `messages` | [`ModelMessage`](../type-aliases/ModelMessage.md)[] | The messages to count tokens in |

#### Returns

`number`

The estimated token count

***

### invalidateCache()?

> `optional` **invalidateCache**(): `void`

Defined in: [packages/agent-sdk/src/context-manager.ts:47](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L47)

Invalidate cached token counts.
Call this when messages have been modified.

#### Returns

`void`
