[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / GenerationLoggingHooksOptions

# Interface: GenerationLoggingHooksOptions

Defined in: [packages/agent-sdk/src/hooks/logging.ts:27](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L27)

Options for creating logging hooks.

## Properties

### log()?

> `optional` **log**: (`message`: `string`) => `void`

Defined in: [packages/agent-sdk/src/hooks/logging.ts:32](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L32)

Custom logging function.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `message` | `string` |

#### Returns

`void`

#### Default Value

```ts
console.log
```

***

### logCompaction?

> `optional` **logCompaction**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/logging.ts:62](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L62)

Whether to log compaction events.

#### Default Value

```ts
true
```

***

### logErrors?

> `optional` **logErrors**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/logging.ts:56](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L56)

Whether to log errors.

#### Default Value

```ts
true
```

***

### logFullMessages?

> `optional` **logFullMessages**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/logging.ts:80](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L80)

Whether to log full message arrays.

#### Default Value

```ts
false (just count)
```

***

### logGeneration?

> `optional` **logGeneration**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/logging.ts:38](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L38)

Whether to log generation requests.

#### Default Value

```ts
true
```

***

### logTiming?

> `optional` **logTiming**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/logging.ts:50](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L50)

Whether to log timing information.

#### Default Value

```ts
true
```

***

### logTools?

> `optional` **logTools**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/logging.ts:44](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L44)

Whether to log tool usage.

#### Default Value

```ts
true
```

***

### maxTextLength?

> `optional` **maxTextLength**: `number`

Defined in: [packages/agent-sdk/src/hooks/logging.ts:68](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L68)

Maximum length for logged text content.

#### Default Value

```ts
200
```

***

### prefix?

> `optional` **prefix**: `string`

Defined in: [packages/agent-sdk/src/hooks/logging.ts:74](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/logging.ts#L74)

Prefix for all log messages.

#### Default Value

```ts
"[Agent]"
```
