[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createCompositeBackend

# Function: createCompositeBackend()

> **createCompositeBackend**(`options`: [`CompositeBackendOptions`](../interfaces/CompositeBackendOptions.md)): [`CompositeBackend`](../classes/CompositeBackend.md)

Defined in: [packages/agent-sdk/src/backends/composite.ts:586](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L586)

Create a CompositeBackend from options.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`CompositeBackendOptions`](../interfaces/CompositeBackendOptions.md) | Configuration options |

## Returns

[`CompositeBackend`](../classes/CompositeBackend.md)

A new CompositeBackend

## Example

```typescript
const backend = createCompositeBackend({
  defaultBackend: new StateBackend(state),
  routes: {
    '/memories/': persistentBackend,
    '/workspace/': filesystemBackend,
  },
});
```
