[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / AgentContext

# Interface: AgentContext

Defined in: [packages/agent-sdk/src/types.ts:2627](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2627)

Context for managing state during agent execution.

## Example

```typescript
const ctx = createContext();
ctx.set("user", { id: 123, name: "Alice" });

const user = ctx.get<{ id: number; name: string }>("user");
```

## Properties

### data

> **data**: `Map`&lt;`string`, `unknown`&gt;

Defined in: [packages/agent-sdk/src/types.ts:2629](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2629)

The underlying data store

## Methods

### clear()

> **clear**(): `void`

Defined in: [packages/agent-sdk/src/types.ts:2661](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2661)

Clear all values from context.

#### Returns

`void`

***

### delete()

> **delete**(`key`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/types.ts:2658](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2658)

Delete a key from context.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `key` | `string` | The key to delete |

#### Returns

`boolean`

True if the key existed and was deleted

***

### get()

> **get**&lt;`T`&gt;(`key`: `string`): `T` \| `undefined`

Defined in: [packages/agent-sdk/src/types.ts:2637](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2637)

Get a value from context.

#### Type Parameters

| Type Parameter | Description |
| :------ | :------ |
| `T` | The expected type of the value |

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `key` | `string` | The key to look up |

#### Returns

`T` \| `undefined`

The value, or undefined if not found

***

### has()

> **has**(`key`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/types.ts:2651](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2651)

Check if a key exists in context.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `key` | `string` | The key to check |

#### Returns

`boolean`

***

### set()

> **set**&lt;`T`&gt;(`key`: `string`, `value`: `T`): `void`

Defined in: [packages/agent-sdk/src/types.ts:2645](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2645)

Set a value in context.

#### Type Parameters

| Type Parameter | Description |
| :------ | :------ |
| `T` | The type of the value |

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `key` | `string` | The key to set |
| `value` | `T` | The value to store |

#### Returns

`void`
