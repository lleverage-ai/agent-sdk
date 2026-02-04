[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SecretsFilterHooksOptions

# Interface: SecretsFilterHooksOptions

Defined in: [packages/agent-sdk/src/hooks/secrets.ts:64](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/secrets.ts#L64)

Options for creating secrets filter hooks.

## Properties

### customPatterns?

> `optional` **customPatterns**: `RegExp`[]

Defined in: [packages/agent-sdk/src/hooks/secrets.ts:68](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/secrets.ts#L68)

Custom secret patterns to detect (in addition to built-in patterns).

***

### filterInput?

> `optional` **filterInput**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/secrets.ts:86](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/secrets.ts#L86)

Whether to filter input (user messages).

#### Default Value

```ts
true
```

***

### filterOutput?

> `optional` **filterOutput**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/secrets.ts:92](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/secrets.ts#L92)

Whether to filter output (model responses).

#### Default Value

```ts
true
```

***

### onSecretDetected()?

> `optional` **onSecretDetected**: (`type`: `"output"` \| `"input"`, `pattern`: `RegExp`, `match`: `string`) => `void`

Defined in: [packages/agent-sdk/src/hooks/secrets.ts:98](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/secrets.ts#L98)

Callback when secrets are detected.
Useful for logging/alerting.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `type` | `"output"` \| `"input"` |
| `pattern` | `RegExp` |
| `match` | `string` |

#### Returns

`void`

***

### patterns?

> `optional` **patterns**: `RegExp`[]

Defined in: [packages/agent-sdk/src/hooks/secrets.ts:74](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/secrets.ts#L74)

Built-in patterns to use.

#### Default Value

```ts
All patterns from COMMON_SECRET_PATTERNS
```

***

### redactionText?

> `optional` **redactionText**: `string`

Defined in: [packages/agent-sdk/src/hooks/secrets.ts:80](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/secrets.ts#L80)

Replacement text for redacted secrets.

#### Default Value

```ts
"[REDACTED]"
```
