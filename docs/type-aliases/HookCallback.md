[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / HookCallback

# Type Alias: HookCallback()

> **HookCallback** = (`input`: [`HookInput`](HookInput.md), `toolUseId`: `string` \| `null`, `context`: [`HookCallbackContext`](../interfaces/HookCallbackContext.md)) => `Promise`&lt;[`HookOutput`](../interfaces/HookOutput.md)&gt; \| [`HookOutput`](../interfaces/HookOutput.md)

Defined in: [packages/agent-sdk/src/types.ts:2181](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2181)

Hook callback function signature.

## Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | [`HookInput`](HookInput.md) |
| `toolUseId` | `string` \| `null` |
| `context` | [`HookCallbackContext`](../interfaces/HookCallbackContext.md) |

## Returns

`Promise`&lt;[`HookOutput`](../interfaces/HookOutput.md)&gt; \| [`HookOutput`](../interfaces/HookOutput.md)
