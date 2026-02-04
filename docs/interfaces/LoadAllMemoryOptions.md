[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LoadAllMemoryOptions

# Interface: LoadAllMemoryOptions

Defined in: [packages/agent-sdk/src/memory/loader.ts:441](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L441)

Options for loading all agent memory.

## Properties

### agentId

> **agentId**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:445](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L445)

Unique identifier for the agent.

***

### homeDir?

> `optional` **homeDir**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:456](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L456)

Custom home directory override.

***

### onAuditEvent()?

> `optional` **onAuditEvent**: (`event`: [`MemoryAuditEvent`](MemoryAuditEvent.md)) => `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/memory/loader.ts:493](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L493)

Callback for audit events.

Called when memory is loaded, approval is requested, or content changes are detected.
Use this to integrate with audit logging systems or hooks.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `event` | [`MemoryAuditEvent`](MemoryAuditEvent.md) |

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### permissionStore?

> `optional` **permissionStore**: [`MemoryPermissionStore`](MemoryPermissionStore.md)

Defined in: [packages/agent-sdk/src/memory/loader.ts:469](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L469)

Memory permission store for approval persistence.

When provided, approval decisions are persisted and checked on each load.
If the file content has changed since approval, re-approval is required.

***

### requestProjectApproval()?

> `optional` **requestProjectApproval**: (`projectPath`: `string`, `contentHash`: `string`, `previousHash?`: `string`) => `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/memory/loader.ts:481](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L481)

Callback to request project memory approval.

Project-level memory may contain sensitive instructions.
Use this callback to implement approval workflows.

When permissionStore is provided:
- This callback is only invoked if the file is not approved or has changed
- Approval is automatically persisted when granted

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `projectPath` | `string` |
| `contentHash` | `string` |
| `previousHash?` | `string` |

#### Returns

`Promise`&lt;`boolean`&gt;

***

### store?

> `optional` **store**: [`MemoryStore`](MemoryStore.md)

Defined in: [packages/agent-sdk/src/memory/loader.ts:461](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L461)

Custom memory store.

***

### workingDirectory?

> `optional` **workingDirectory**: `string`

Defined in: [packages/agent-sdk/src/memory/loader.ts:451](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L451)

Working directory for project memory detection.

#### Default Value

```ts
process.cwd()
```
