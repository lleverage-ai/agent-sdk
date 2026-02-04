[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / extractRespondWith

# Function: extractRespondWith()

> **extractRespondWith**&lt;`T`&gt;(`hookOutputs`: [`HookOutput`](../interfaces/HookOutput.md)[]): `T` \| `undefined`

Defined in: [packages/agent-sdk/src/hooks.ts:277](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks.ts#L277)

Extracts a cached/mock result from hook outputs for short-circuit execution.

Returns the first non-undefined `respondWith` value found in the hook outputs.
This enables cache hooks to return cached results without executing the actual operation.

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `T` | `unknown` |

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `hookOutputs` | [`HookOutput`](../interfaces/HookOutput.md)[] | Array of hook outputs to scan |

## Returns

`T` \| `undefined`

The cached result if found, undefined otherwise

## Example

```typescript
const outputs: HookOutput[] = [
  { hookSpecificOutput: { hookEventName: 'PreGenerate' } },
  { hookSpecificOutput: { hookEventName: 'PreGenerate', respondWith: cachedResult } },
];

const result = extractRespondWith(outputs);
// Returns cachedResult
```
