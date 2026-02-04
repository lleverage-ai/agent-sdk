[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / applySecurityPolicy

# Function: applySecurityPolicy()

> **applySecurityPolicy**(`preset`: [`SecurityPolicyPreset`](../type-aliases/SecurityPolicyPreset.md), `overrides?`: `Partial`&lt;[`SecurityPolicy`](../interfaces/SecurityPolicy.md)&gt;): \{ `allowedTools?`: `string`[]; `backend`: [`LocalSandbox`](../classes/LocalSandbox.md); `disallowedTools?`: `string`[]; `hooks?`: [`HookRegistration`](../interfaces/HookRegistration.md); `permissionMode?`: [`PermissionMode`](../type-aliases/PermissionMode.md); \}

Defined in: [packages/agent-sdk/src/security/index.ts:185](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/security/index.ts#L185)

Apply a security policy preset to agent options.

This function returns a partial AgentOptions object that can be spread into
createAgent(). It configures the sandbox, permission mode, tool restrictions,
and hooks according to the selected preset.

When permissionMode is "acceptEdits" and blockShellFileOps is true (default),
the sandbox will be automatically configured to block shell-based file operations
like `echo > file`, `rm`, `mv`, etc. This prevents bash commands from bypassing
the acceptEdits permission checks.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `preset` | [`SecurityPolicyPreset`](../type-aliases/SecurityPolicyPreset.md) | The security preset to apply |
| `overrides?` | `Partial`&lt;[`SecurityPolicy`](../interfaces/SecurityPolicy.md)&gt; | Optional policy overrides to customize the preset |

## Returns

\{ `allowedTools?`: `string`[]; `backend`: [`LocalSandbox`](../classes/LocalSandbox.md); `disallowedTools?`: `string`[]; `hooks?`: [`HookRegistration`](../interfaces/HookRegistration.md); `permissionMode?`: [`PermissionMode`](../type-aliases/PermissionMode.md); \}

Partial agent options with security settings applied

### allowedTools?

> `optional` **allowedTools**: `string`[]

### backend

> **backend**: [`LocalSandbox`](../classes/LocalSandbox.md)

### disallowedTools?

> `optional` **disallowedTools**: `string`[]

### hooks?

> `optional` **hooks**: [`HookRegistration`](../interfaces/HookRegistration.md)

### permissionMode?

> `optional` **permissionMode**: [`PermissionMode`](../type-aliases/PermissionMode.md)

## Example

```typescript
// Apply production preset
const agent = createAgent({
  model,
  ...applySecurityPolicy("production"),
});

// Apply CI preset with custom timeout
const ciAgent = createAgent({
  model,
  ...applySecurityPolicy("ci", {
    sandbox: { timeout: 120000 },
  }),
});

// Apply readonly preset for audit-only agent
const auditAgent = createAgent({
  model,
  ...applySecurityPolicy("readonly"),
});

// Use acceptEdits mode with shell file operation blocking
const editAgent = createAgent({
  model,
  ...applySecurityPolicy("development", {
    permissionMode: "acceptEdits",
    blockShellFileOps: true, // default, blocks bash file ops
  }),
});
```
