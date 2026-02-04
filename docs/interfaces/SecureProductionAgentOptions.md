[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SecureProductionAgentOptions

# Interface: SecureProductionAgentOptions

Defined in: [packages/agent-sdk/src/presets/production.ts:331](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L331)

Options for creating a secure production agent.

This extends ProductionAgentOptions with secure-by-default values.

## Extends

- `Omit`&lt;[`ProductionAgentOptions`](ProductionAgentOptions.md), `"enableGuardrails"`&gt;

## Properties

### additionalOptions?

> `optional` **additionalOptions**: `Partial`&lt;[`AgentOptions`](AgentOptions.md)&gt;

Defined in: [packages/agent-sdk/src/presets/production.ts:124](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L124)

Additional agent options to merge with preset defaults.
This can be used to add custom plugins, tools, checkpointers, etc.

#### Inherited from

[`ProductionAgentOptions`](ProductionAgentOptions.md).[`additionalOptions`](ProductionAgentOptions.md#additionaloptions)

***

### blockedInputPatterns?

> `optional` **blockedInputPatterns**: `RegExp`[]

Defined in: [packages/agent-sdk/src/presets/production.ts:113](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L113)

Blocked input patterns for guardrails (regex patterns).

#### Inherited from

[`ProductionAgentOptions`](ProductionAgentOptions.md).[`blockedInputPatterns`](ProductionAgentOptions.md#blockedinputpatterns)

***

### blockedOutputPatterns?

> `optional` **blockedOutputPatterns**: `RegExp`[]

Defined in: [packages/agent-sdk/src/presets/production.ts:118](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L118)

Blocked output patterns for guardrails (regex patterns).

#### Inherited from

[`ProductionAgentOptions`](ProductionAgentOptions.md).[`blockedOutputPatterns`](ProductionAgentOptions.md#blockedoutputpatterns)

***

### enableGuardrails?

> `optional` **enableGuardrails**: `boolean`

Defined in: [packages/agent-sdk/src/presets/production.ts:340](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L340)

Whether to enable guardrails for content filtering.
Unlike ProductionAgentOptions, this defaults to true.

#### Default Value

```ts
true
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

#### Inherited from

[`ProductionAgentOptions`](ProductionAgentOptions.md).[`enableObservability`](ProductionAgentOptions.md#enableobservability)

***

### enableSecretsFilter?

> `optional` **enableSecretsFilter**: `boolean`

Defined in: [packages/agent-sdk/src/presets/production.ts:102](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L102)

Whether to enable secrets filtering to prevent credential leakage.

#### Default Value

```ts
true
```

#### Inherited from

[`ProductionAgentOptions`](ProductionAgentOptions.md).[`enableSecretsFilter`](ProductionAgentOptions.md#enablesecretsfilter)

***

### model

> **model**: [`LanguageModel`](../type-aliases/LanguageModel.md)

Defined in: [packages/agent-sdk/src/presets/production.ts:74](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L74)

The language model to use for generation.

#### Inherited from

[`ProductionAgentOptions`](ProductionAgentOptions.md).[`model`](ProductionAgentOptions.md#model)

***

### observabilityOptions?

> `optional` **observabilityOptions**: [`ObservabilityPresetOptions`](ObservabilityPresetOptions.md)

Defined in: [packages/agent-sdk/src/presets/production.ts:96](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L96)

Observability configuration options.

#### Inherited from

[`ProductionAgentOptions`](ProductionAgentOptions.md).[`observabilityOptions`](ProductionAgentOptions.md#observabilityoptions)

***

### securityOverrides?

> `optional` **securityOverrides**: `Partial`&lt;[`SecurityPolicy`](SecurityPolicy.md)&gt;

Defined in: [packages/agent-sdk/src/presets/production.ts:85](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L85)

Optional security policy overrides.

#### Inherited from

[`ProductionAgentOptions`](ProductionAgentOptions.md).[`securityOverrides`](ProductionAgentOptions.md#securityoverrides)

***

### securityPreset?

> `optional` **securityPreset**: [`SecurityPolicyPreset`](../type-aliases/SecurityPolicyPreset.md)

Defined in: [packages/agent-sdk/src/presets/production.ts:80](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L80)

Security policy preset to apply.

#### Default Value

```ts
"production"
```

#### Inherited from

[`ProductionAgentOptions`](ProductionAgentOptions.md).[`securityPreset`](ProductionAgentOptions.md#securitypreset)

***

### useDefaultInputPatterns?

> `optional` **useDefaultInputPatterns**: `boolean`

Defined in: [packages/agent-sdk/src/presets/production.ts:347](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L347)

Whether to use the default blocked input patterns.
Set to false to only use custom patterns.

#### Default Value

```ts
true
```

***

### useDefaultOutputPatterns?

> `optional` **useDefaultOutputPatterns**: `boolean`

Defined in: [packages/agent-sdk/src/presets/production.ts:354](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L354)

Whether to use the default blocked output patterns.
Set to false to only use custom patterns.

#### Default Value

```ts
true
```
