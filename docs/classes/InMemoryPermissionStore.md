[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / InMemoryPermissionStore

# Class: InMemoryPermissionStore

Defined in: [packages/agent-sdk/src/memory/permissions.ts:369](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L369)

In-memory implementation of MemoryPermissionStore for testing.

Approvals are stored in memory and not persisted.

## Example

```typescript
const store = new InMemoryPermissionStore();

await store.grantApproval("/test.md", hash);
const approved = await store.isApproved("/test.md", hash);
```

## Implements

- [`MemoryPermissionStore`](../interfaces/MemoryPermissionStore.md)

## Constructors

### Constructor

> **new InMemoryPermissionStore**(): `InMemoryPermissionStore`

#### Returns

`InMemoryPermissionStore`

## Methods

### clearAll()

> **clearAll**(): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:414](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L414)

Clear all approvals.

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`MemoryPermissionStore`](../interfaces/MemoryPermissionStore.md).[`clearAll`](../interfaces/MemoryPermissionStore.md#clearall)

***

### grantApproval()

> **grantApproval**(`path`: `string`, `contentHash`: `string`, `approvedBy?`: `string`): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:384](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L384)

Grant approval for a path with a specific content hash.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `path` | `string` |
| `contentHash` | `string` |
| `approvedBy?` | `string` |

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`MemoryPermissionStore`](../interfaces/MemoryPermissionStore.md).[`grantApproval`](../interfaces/MemoryPermissionStore.md#grantapproval)

***

### isApproved()

> **isApproved**(`path`: `string`, `contentHash`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:375](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L375)

Check if a path is approved with a specific content hash.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `path` | `string` |
| `contentHash` | `string` |

#### Returns

`Promise`&lt;`boolean`&gt;

#### Implementation of

[`MemoryPermissionStore`](../interfaces/MemoryPermissionStore.md).[`isApproved`](../interfaces/MemoryPermissionStore.md#isapproved)

***

### listApprovals()

> **listApprovals**(): `Promise`&lt;[`MemoryApproval`](../interfaces/MemoryApproval.md)[]&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:407](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L407)

List all approved paths.

#### Returns

`Promise`&lt;[`MemoryApproval`](../interfaces/MemoryApproval.md)[]&gt;

#### Implementation of

[`MemoryPermissionStore`](../interfaces/MemoryPermissionStore.md).[`listApprovals`](../interfaces/MemoryPermissionStore.md#listapprovals)

***

### revokeApproval()

> **revokeApproval**(`path`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:400](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L400)

Revoke approval for a path.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `path` | `string` |

#### Returns

`Promise`&lt;`boolean`&gt;

#### Implementation of

[`MemoryPermissionStore`](../interfaces/MemoryPermissionStore.md).[`revokeApproval`](../interfaces/MemoryPermissionStore.md#revokeapproval)
