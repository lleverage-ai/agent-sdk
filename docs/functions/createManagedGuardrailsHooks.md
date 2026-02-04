[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createManagedGuardrailsHooks

# Function: createManagedGuardrailsHooks()

> **createManagedGuardrailsHooks**(`options`: [`GuardrailsHooksOptions`](../interfaces/GuardrailsHooksOptions.md)): \{ `getStats`: () => \{ `blockedInputs`: `number`; `filteredOutputs`: `number`; `totalInputs`: `number`; `totalOutputs`: `number`; \}; `hooks`: \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]; \}

Defined in: [packages/agent-sdk/src/hooks/guardrails.ts:328](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/guardrails.ts#L328)

Creates guardrails hooks with statistics tracking.

Returns hooks along with functions to get filtering statistics.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`GuardrailsHooksOptions`](../interfaces/GuardrailsHooksOptions.md) | Configuration options |

## Returns

\{ `getStats`: () => \{ `blockedInputs`: `number`; `filteredOutputs`: `number`; `totalInputs`: `number`; `totalOutputs`: `number`; \}; `hooks`: \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]; \}

Object with hooks and statistics getter

### getStats()

> **getStats**: () => \{ `blockedInputs`: `number`; `filteredOutputs`: `number`; `totalInputs`: `number`; `totalOutputs`: `number`; \}

#### Returns

\{ `blockedInputs`: `number`; `filteredOutputs`: `number`; `totalInputs`: `number`; `totalOutputs`: `number`; \}

##### blockedInputs

> **blockedInputs**: `number`

##### filteredOutputs

> **filteredOutputs**: `number`

##### totalInputs

> **totalInputs**: `number`

##### totalOutputs

> **totalOutputs**: `number`

### hooks

> **hooks**: \[[`HookCallback`](../type-aliases/HookCallback.md), [`HookCallback`](../type-aliases/HookCallback.md)\]

## Example

```typescript
const { hooks, getStats } = createManagedGuardrailsHooks({
  blockedInputPatterns: [/password/i, /secret/i],
  blockedOutputPatterns: [/\b\d{16}\b/],
});

const agent = createAgent({
  model,
  hooks: {
    PreGenerate: [{ hooks: [hooks[0]] }],
    PostGenerate: [{ hooks: [hooks[1]] }],
  },
});

// Check statistics
const stats = getStats();
console.log(`Blocked inputs: ${stats.blockedInputs}`);
console.log(`Filtered outputs: ${stats.filteredOutputs}`);
```
