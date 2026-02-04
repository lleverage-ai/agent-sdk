[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createManagedSecretsFilterHooks

# Function: createManagedSecretsFilterHooks()

> **createManagedSecretsFilterHooks**(`options`: [`SecretsFilterHooksOptions`](../interfaces/SecretsFilterHooksOptions.md)): \{ `getDetections`: () => \{ `pattern`: `string`; `timestamp`: `number`; `type`: `"output"` \| `"input"`; \}[]; `getStats`: () => \{ `inputDetections`: `number`; `outputDetections`: `number`; `totalDetections`: `number`; \}; `hooks`: \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]; \}

Defined in: [packages/agent-sdk/src/hooks/secrets.ts:353](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/secrets.ts#L353)

Creates managed secrets filter hooks with detection statistics.

Returns hooks along with functions to get detection statistics.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`SecretsFilterHooksOptions`](../interfaces/SecretsFilterHooksOptions.md) | Configuration options |

## Returns

\{ `getDetections`: () => \{ `pattern`: `string`; `timestamp`: `number`; `type`: `"output"` \| `"input"`; \}[]; `getStats`: () => \{ `inputDetections`: `number`; `outputDetections`: `number`; `totalDetections`: `number`; \}; `hooks`: \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]; \}

Object with hooks and statistics getter

### getDetections()

> **getDetections**: () => \{ `pattern`: `string`; `timestamp`: `number`; `type`: `"output"` \| `"input"`; \}[]

#### Returns

\{ `pattern`: `string`; `timestamp`: `number`; `type`: `"output"` \| `"input"`; \}[]

### getStats()

> **getStats**: () => \{ `inputDetections`: `number`; `outputDetections`: `number`; `totalDetections`: `number`; \}

#### Returns

\{ `inputDetections`: `number`; `outputDetections`: `number`; `totalDetections`: `number`; \}

##### inputDetections

> **inputDetections**: `number`

##### outputDetections

> **outputDetections**: `number`

##### totalDetections

> **totalDetections**: `number`

### hooks

> **hooks**: \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]

## Example

```typescript
const { hooks, getStats, getDetections } = createManagedSecretsFilterHooks();

const agent = createAgent({
  model,
  hooks: {
    PreGenerate: [{ hooks: [hooks[0]] }],
    PostGenerate: [{ hooks: [hooks[1]] }],
  },
});

// Check statistics
const stats = getStats();
console.log(`Secrets detected: ${stats.totalDetections} (${stats.inputDetections} input, ${stats.outputDetections} output)`);

// Get detailed detections
const detections = getDetections();
console.log('Recent detections:', detections.slice(0, 10));
```
