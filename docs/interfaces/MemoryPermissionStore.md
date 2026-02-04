[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MemoryPermissionStore

# Interface: MemoryPermissionStore

Defined in: [packages/agent-sdk/src/memory/permissions.ts:72](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L72)

Store interface for memory permissions.

Implement this to provide custom storage backends.

## Methods

### clearAll()

> **clearAll**(): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:122](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L122)

Clear all approvals.

Useful for resetting permissions or testing.

#### Returns

`Promise`&lt;`void`&gt;

***

### grantApproval()

> **grantApproval**(`path`: `string`, `contentHash`: `string`, `approvedBy?`: `string`): `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:96](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L96)

Grant approval for a path with a specific content hash.

If the path was previously approved with a different hash,
this updates the approval to the new hash.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `path` | `string` | Path to approve |
| `contentHash` | `string` | Content hash at approval time |
| `approvedBy?` | `string` | Optional user identifier |

#### Returns

`Promise`&lt;`void`&gt;

***

### isApproved()

> **isApproved**(`path`: `string`, `contentHash`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:84](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L84)

Check if a path is approved with a specific content hash.

Returns true only if:
1. The path has been approved
2. The content hash matches the approved hash

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `path` | `string` | Path to check |
| `contentHash` | `string` | Current content hash |

#### Returns

`Promise`&lt;`boolean`&gt;

True if approved and hash matches

***

### listApprovals()

> **listApprovals**(): `Promise`&lt;[`MemoryApproval`](MemoryApproval.md)[]&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:115](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L115)

List all approved paths.

#### Returns

`Promise`&lt;[`MemoryApproval`](MemoryApproval.md)[]&gt;

Array of approval records

***

### revokeApproval()

> **revokeApproval**(`path`: `string`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/memory/permissions.ts:108](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/permissions.ts#L108)

Revoke approval for a path.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `path` | `string` | Path to revoke |

#### Returns

`Promise`&lt;`boolean`&gt;

True if approval was revoked, false if it wasn't approved
