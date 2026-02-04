[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createObservabilityEventHooks

# Function: createObservabilityEventHooks()

> **createObservabilityEventHooks**(`store`: [`ObservabilityEventStore`](../interfaces/ObservabilityEventStore.md)): \{ `MCPConnectionFailed`: (`input`: [`MCPConnectionFailedInput`](../interfaces/MCPConnectionFailedInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]; `MCPConnectionRestored`: (`input`: [`MCPConnectionRestoredInput`](../interfaces/MCPConnectionRestoredInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]; `PostCompact`: (`input`: [`PostCompactInput`](../interfaces/PostCompactInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]; `PreCompact`: (`input`: [`PreCompactInput`](../interfaces/PreCompactInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]; `ToolLoadError`: (`input`: [`ToolLoadErrorInput`](../interfaces/ToolLoadErrorInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]; `ToolRegistered`: (`input`: [`ToolRegisteredInput`](../interfaces/ToolRegisteredInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]; \}

Defined in: [packages/agent-sdk/src/observability/events.ts:421](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/events.ts#L421)

Create hooks for collecting observability events.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `store` | [`ObservabilityEventStore`](../interfaces/ObservabilityEventStore.md) | Event store to collect events in |

## Returns

\{ `MCPConnectionFailed`: (`input`: [`MCPConnectionFailedInput`](../interfaces/MCPConnectionFailedInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]; `MCPConnectionRestored`: (`input`: [`MCPConnectionRestoredInput`](../interfaces/MCPConnectionRestoredInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]; `PostCompact`: (`input`: [`PostCompactInput`](../interfaces/PostCompactInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]; `PreCompact`: (`input`: [`PreCompactInput`](../interfaces/PreCompactInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]; `ToolLoadError`: (`input`: [`ToolLoadErrorInput`](../interfaces/ToolLoadErrorInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]; `ToolRegistered`: (`input`: [`ToolRegisteredInput`](../interfaces/ToolRegisteredInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]; \}

Hook callbacks for all observability event types

### MCPConnectionFailed

> **MCPConnectionFailed**: (`input`: [`MCPConnectionFailedInput`](../interfaces/MCPConnectionFailedInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | [`MCPConnectionFailedInput`](../interfaces/MCPConnectionFailedInput.md) |

#### Returns

`Promise`&lt;\{ `continue`: `boolean`; \}&gt;

### MCPConnectionRestored

> **MCPConnectionRestored**: (`input`: [`MCPConnectionRestoredInput`](../interfaces/MCPConnectionRestoredInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | [`MCPConnectionRestoredInput`](../interfaces/MCPConnectionRestoredInput.md) |

#### Returns

`Promise`&lt;\{ `continue`: `boolean`; \}&gt;

### PostCompact

> **PostCompact**: (`input`: [`PostCompactInput`](../interfaces/PostCompactInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | [`PostCompactInput`](../interfaces/PostCompactInput.md) |

#### Returns

`Promise`&lt;\{ `continue`: `boolean`; \}&gt;

### PreCompact

> **PreCompact**: (`input`: [`PreCompactInput`](../interfaces/PreCompactInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | [`PreCompactInput`](../interfaces/PreCompactInput.md) |

#### Returns

`Promise`&lt;\{ `continue`: `boolean`; \}&gt;

### ToolLoadError

> **ToolLoadError**: (`input`: [`ToolLoadErrorInput`](../interfaces/ToolLoadErrorInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | [`ToolLoadErrorInput`](../interfaces/ToolLoadErrorInput.md) |

#### Returns

`Promise`&lt;\{ `continue`: `boolean`; \}&gt;

### ToolRegistered

> **ToolRegistered**: (`input`: [`ToolRegisteredInput`](../interfaces/ToolRegisteredInput.md)) => `Promise`&lt;\{ `continue`: `boolean`; \}&gt;[]

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `input` | [`ToolRegisteredInput`](../interfaces/ToolRegisteredInput.md) |

#### Returns

`Promise`&lt;\{ `continue`: `boolean`; \}&gt;

## Example

```typescript
const store = createObservabilityEventStore();
const hooks = createObservabilityEventHooks(store);

const agent = createAgent({
  model,
  hooks: {
    MCPConnectionFailed: hooks.MCPConnectionFailed,
    MCPConnectionRestored: hooks.MCPConnectionRestored,
    ToolRegistered: hooks.ToolRegistered,
    ToolLoadError: hooks.ToolLoadError,
    PreCompact: hooks.PreCompact,
    PostCompact: hooks.PostCompact,
  },
});
```
