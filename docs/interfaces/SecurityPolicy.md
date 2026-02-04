[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SecurityPolicy

# Interface: SecurityPolicy

Defined in: [packages/agent-sdk/src/security/index.ts:87](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/security/index.ts#L87)

Security policy configuration that bundles sandbox, permission, and hook settings.

This type combines multiple security controls into a single policy that can be
applied to an agent. Policies can be created from presets or customized.

## Example

```typescript
const policy: SecurityPolicy = {
  sandbox: { allowDangerous: false, timeout: 30000 },
  permissionMode: "default",
  disallowedTools: ["bash"],
  hooks: { PreToolUse: [auditHook] },
};
```

## Properties

### allowedTools?

> `optional` **allowedTools**: `string`[]

Defined in: [packages/agent-sdk/src/security/index.ts:106](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/security/index.ts#L106)

Tools that are explicitly allowed (all others blocked).

***

### blockShellFileOps?

> `optional` **blockShellFileOps**: `boolean`

Defined in: [packages/agent-sdk/src/security/index.ts:120](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/security/index.ts#L120)

When true and permissionMode is "acceptEdits", automatically configures the
sandbox to block shell-based file operations (e.g., echo \> file, rm, mv).
This prevents bash commands from bypassing the acceptEdits permission checks.

#### Default Value

```ts
true
```

***

### disallowedTools?

> `optional` **disallowedTools**: `string`[]

Defined in: [packages/agent-sdk/src/security/index.ts:101](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/security/index.ts#L101)

Tools that are explicitly disallowed.

***

### hooks?

> `optional` **hooks**: [`HookRegistration`](HookRegistration.md)

Defined in: [packages/agent-sdk/src/security/index.ts:111](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/security/index.ts#L111)

Hook registrations for lifecycle events.

***

### permissionMode?

> `optional` **permissionMode**: [`PermissionMode`](../type-aliases/PermissionMode.md)

Defined in: [packages/agent-sdk/src/security/index.ts:96](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/security/index.ts#L96)

Permission mode for tool execution control.

***

### sandbox?

> `optional` **sandbox**: [`LocalSandboxOptions`](LocalSandboxOptions.md)

Defined in: [packages/agent-sdk/src/security/index.ts:91](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/security/index.ts#L91)

Sandbox configuration for command execution security.
