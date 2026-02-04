[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ProductionAgentOptions

# Interface: ProductionAgentOptions

Defined in: [packages/agent-sdk/src/presets/production.ts:70](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L70)

Options for creating a production agent.

## Properties

### additionalOptions?

> `optional` **additionalOptions**: `Partial`&lt;[`AgentOptions`](AgentOptions.md)&gt;

Defined in: [packages/agent-sdk/src/presets/production.ts:124](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L124)

Additional agent options to merge with preset defaults.
This can be used to add custom plugins, tools, checkpointers, etc.

***

### blockedInputPatterns?

> `optional` **blockedInputPatterns**: `RegExp`[]

Defined in: [packages/agent-sdk/src/presets/production.ts:113](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L113)

Blocked input patterns for guardrails (regex patterns).

***

### blockedOutputPatterns?

> `optional` **blockedOutputPatterns**: `RegExp`[]

Defined in: [packages/agent-sdk/src/presets/production.ts:118](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L118)

Blocked output patterns for guardrails (regex patterns).

***

### enableGuardrails?

> `optional` **enableGuardrails**: `boolean`

Defined in: [packages/agent-sdk/src/presets/production.ts:108](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L108)

Whether to enable guardrails for content filtering.

#### Default Value

```ts
false
```

***

### enableObservability?

> `optional` **enableObservability**: `boolean`

Defined in: [packages/agent-sdk/src/presets/production.ts:91](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L91)

Whether to enable observability (logging, metrics, tracing).

#### Default Value

```ts
true
```

***

### enableSecretsFilter?

> `optional` **enableSecretsFilter**: `boolean`

Defined in: [packages/agent-sdk/src/presets/production.ts:102](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L102)

Whether to enable secrets filtering to prevent credential leakage.

#### Default Value

```ts
true
```

***

### model

> **model**: [`LanguageModel`](../type-aliases/LanguageModel.md)

Defined in: [packages/agent-sdk/src/presets/production.ts:74](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L74)

The language model to use for generation.

***

### observabilityOptions?

> `optional` **observabilityOptions**: [`ObservabilityPresetOptions`](ObservabilityPresetOptions.md)

Defined in: [packages/agent-sdk/src/presets/production.ts:96](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L96)

Observability configuration options.

***

### securityOverrides?

> `optional` **securityOverrides**: `Partial`&lt;[`SecurityPolicy`](SecurityPolicy.md)&gt;

Defined in: [packages/agent-sdk/src/presets/production.ts:85](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L85)

Optional security policy overrides.

***

### securityPreset?

> `optional` **securityPreset**: [`SecurityPolicyPreset`](../type-aliases/SecurityPolicyPreset.md)

Defined in: [packages/agent-sdk/src/presets/production.ts:80](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L80)

Security policy preset to apply.

#### Default Value

```ts
"production"
```
