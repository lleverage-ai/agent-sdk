[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PostGenerateInput

# Interface: PostGenerateInput

Defined in: [packages/agent-sdk/src/types.ts:1888](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1888)

Input for PostGenerate hooks.

## Extends

- `BaseHookInput`

## Properties

### cwd

> **cwd**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1831](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1831)

Current working directory

#### Inherited from

`BaseHookInput.cwd`

***

### hook\_event\_name

> **hook\_event\_name**: `"PostGenerate"`

Defined in: [packages/agent-sdk/src/types.ts:1889](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1889)

The event type that triggered this hook

#### Overrides

`BaseHookInput.hook_event_name`

***

### options

> **options**: [`GenerateOptions`](GenerateOptions.md)

Defined in: [packages/agent-sdk/src/types.ts:1891](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1891)

Generation options

***

### result

> **result**: [`GenerateResultComplete`](GenerateResultComplete.md)

Defined in: [packages/agent-sdk/src/types.ts:1897](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1897)

Generated result.
Note: PostGenerate is only called for complete results - interrupts
are returned immediately without calling PostGenerate hooks.

***

### session\_id

> **session\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1829](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1829)

Session identifier

#### Inherited from

`BaseHookInput.session_id`
