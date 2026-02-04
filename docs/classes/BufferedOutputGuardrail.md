[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / BufferedOutputGuardrail

# Class: BufferedOutputGuardrail

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:334](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L334)

Controller for buffered output guardrails.

Buffers output content and runs guardrail checks before releasing
content to the client.

## Constructors

### Constructor

> **new BufferedOutputGuardrail**(`config`: [`OutputGuardrailConfig`](../interfaces/OutputGuardrailConfig.md)): `BufferedOutputGuardrail`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:346](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L346)

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `config` | [`OutputGuardrailConfig`](../interfaces/OutputGuardrailConfig.md) |

#### Returns

`BufferedOutputGuardrail`

## Accessors

### currentState

#### Get Signature

> **get** **currentState**(): [`BufferedGuardrailState`](../type-aliases/BufferedGuardrailState.md)

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:360](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L360)

Get current state of the guardrail.

##### Returns

[`BufferedGuardrailState`](../type-aliases/BufferedGuardrailState.md)

***

### reason

#### Get Signature

> **get** **reason**(): `string` \| `null`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:365](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L365)

Get the block reason (if blocked).

##### Returns

`string` \| `null`

***

### signal

#### Get Signature

> **get** **signal**(): `AbortSignal`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:370](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L370)

Get the abort signal.

##### Returns

`AbortSignal`

## Methods

### abort()

> **abort**(): `void`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:511](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L511)

Abort the guardrail.

#### Returns

`void`

***

### addChunk()

> **addChunk**(`chunk`: `unknown`): `boolean`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:419](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L419)

Add a chunk to the buffer for later flushing.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `chunk` | `unknown` |

#### Returns

`boolean`

***

### addContent()

> **addContent**(`text`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:393](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L393)

Add content to the buffer.
Returns true if content should be forwarded, false if blocked.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `text` | `string` |

#### Returns

`boolean`

***

### clear()

> **clear**(): `void`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:505](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L505)

Clear the buffer and chunks.

#### Returns

`void`

***

### finalize()

> **finalize**(): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:459](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L459)

Finalize the guardrail check.
Call this when output is complete to ensure final check passes.

#### Returns

`Promise`&lt;`void`&gt;

***

### getBuffer()

> **getBuffer**(): `string`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:495](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L495)

Get the buffered content.

#### Returns

`string`

***

### getChunks()

> **getChunks**(): `unknown`[]

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:500](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L500)

Get the buffered chunks.

#### Returns

`unknown`[]

***

### hasBlocked()

> **hasBlocked**(): `boolean`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:385](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L385)

Check if guardrail has blocked content.

#### Returns

`boolean`

***

### hasPassed()

> **hasPassed**(): `boolean`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:380](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L380)

Check if guardrail has passed.

#### Returns

`boolean`

***

### isBuffering()

> **isBuffering**(): `boolean`

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:375](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L375)

Check if guardrail is still buffering.

#### Returns

`boolean`
