[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / loadAllMemory

# Function: loadAllMemory()

> **loadAllMemory**(`options`: [`LoadAllMemoryOptions`](../interfaces/LoadAllMemoryOptions.md)): `Promise`&lt;[`LoadAllMemoryResult`](../interfaces/LoadAllMemoryResult.md)&gt;

Defined in: [packages/agent-sdk/src/memory/loader.ts:575](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/memory/loader.ts#L575)

Load all agent memory (user, project, and additional files).

This is the main entry point for loading agent memory.
It handles the two-tier architecture, approval workflow, and change detection.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`LoadAllMemoryOptions`](../interfaces/LoadAllMemoryOptions.md) | Loading options |

## Returns

`Promise`&lt;[`LoadAllMemoryResult`](../interfaces/LoadAllMemoryResult.md)&gt;

Complete memory loading result

## Examples

```typescript
const memory = await loadAllMemory({
  agentId: "my-agent",
  workingDirectory: "/path/to/project",
  requestProjectApproval: async (path, hash, previousHash) => {
    if (previousHash) {
      console.log(`Memory file ${path} has changed!`);
    }
    return confirm(`Load project memory from ${path}?`);
  },
});

// Use in system prompt
const systemPrompt = `You are a helpful assistant.\n\n${memory.memorySection}`;
```

```typescript
import { createMemoryPermissionStore } from "@lleverage-ai/agent-sdk";

const permStore = createMemoryPermissionStore();

const memory = await loadAllMemory({
  agentId: "my-agent",
  permissionStore: permStore,
  requestProjectApproval: async (path, hash, previousHash) => {
    // Only called if not approved or content changed
    return confirm(`Approve ${path}?`);
  },
  onAuditEvent: (event) => {
    console.log("Memory audit:", event);
  },
});
```
