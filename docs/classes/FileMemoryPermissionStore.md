[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FileMemoryPermissionStore

# Class: FileMemoryPermissionStore

Defined in: [packages/agent-sdk/src/memory/permissions.ts:219](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L219)

File-based implementation of MemoryPermissionStore.

Stores approvals in a JSON file on disk.

## Example

```typescript
const store = new FileMemoryPermissionStore({
  permissionsFilePath: "/home/user/.deepagents/.memory-permissions.json",
});

// Grant approval
await store.grantApproval("/project/.deepagents/agent.md", contentHash, "user");

// Check if approved
const approved = await store.isApproved("/project/.deepagents/agent.md", contentHash);
```

## Implements

- [`MemoryPermissionStore`](../interfaces/MemoryPermissionStore.md)

## Constructors

### Constructor

> **new FileMemoryPermissionStore**(`options`: [`FileMemoryPermissionStoreOptions`](../interfaces/FileMemoryPermissionStoreOptions.md)): `FileMemoryPermissionStore`

Defined in: [packages/agent-sdk/src/memory/permissions.ts:230](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L230)

Create a new FileMemoryPermissionStore.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`FileMemoryPermissionStoreOptions`](../interfaces/FileMemoryPermissionStoreOptions.md) | Configuration options |

#### Returns

`FileMemoryPermissionStore`

## Methods

### clearAll()

> **clearAll**(): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:342](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L342)

Clear all approvals.

#### Returns

`Promise`&lt;`void`&gt;

#### Implementation of

[`MemoryPermissionStore`](../interfaces/MemoryPermissionStore.md).[`clearAll`](../interfaces/MemoryPermissionStore.md#clearall)

***

### grantApproval()

> **grantApproval**(`path`: `string`, `contentHash`: `string`, `approvedBy?`: `string`): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:298](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L298)

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

Defined in: [packages/agent-sdk/src/memory/permissions.ts:285](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L285)

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

Defined in: [packages/agent-sdk/src/memory/permissions.ts:334](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L334)

List all approved paths.

#### Returns

`Promise`&lt;[`MemoryApproval`](../interfaces/MemoryApproval.md)[]&gt;

#### Implementation of

[`MemoryPermissionStore`](../interfaces/MemoryPermissionStore.md).[`listApprovals`](../interfaces/MemoryPermissionStore.md#listapprovals)

***

### revokeApproval()

> **revokeApproval**(`path`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:318](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L318)

Revoke approval for a path.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `path` | `string` |

#### Returns

`Promise`&lt;`boolean`&gt;

#### Implementation of

[`MemoryPermissionStore`](../interfaces/MemoryPermissionStore.md).[`revokeApproval`](../interfaces/MemoryPermissionStore.md#revokeapproval)
