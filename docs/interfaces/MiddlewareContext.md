[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MiddlewareContext

# Interface: MiddlewareContext

Defined in: [packages/agent-sdk/src/middleware/types.ts:22](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L22)

Context provided to middleware for registering hooks.

Middleware uses this context to register event handlers during agent
creation. Hooks are registered in middleware order, preserving the
order in which middleware was added.

## Methods

### onInterruptRequested()

> **onInterruptRequested**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:120](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L120)

Register an InterruptRequested hook.
Called when an interrupt is requested (approval request, custom interrupt, etc.).

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`

***

### onInterruptResolved()

> **onInterruptResolved**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:126](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L126)

Register an InterruptResolved hook.
Called when an interrupt is resolved (approved, denied, or custom response).

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`

***

### onMCPConnectionFailed()

> **onMCPConnectionFailed**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:108](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L108)

Register an MCPConnectionFailed hook.
Called when an MCP connection fails.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`

***

### onMCPConnectionRestored()

> **onMCPConnectionRestored**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:114](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L114)

Register an MCPConnectionRestored hook.
Called when an MCP connection is restored.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`

***

### onPostCompact()

> **onPostCompact**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:78](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L78)

Register a PostCompact hook.
Called after context compaction.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`

***

### onPostGenerate()

> **onPostGenerate**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:33](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L33)

Register a PostGenerate hook.
Called after each successful generation.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`

***

### onPostGenerateFailure()

> **onPostGenerateFailure**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:39](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L39)

Register a PostGenerateFailure hook.
Called when generation fails.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`

***

### onPostToolUse()

> **onPostToolUse**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md), `matcher?`: `string`): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:57](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L57)

Register a PostToolUse hook.
Called after each successful tool execution.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) | The hook callback to invoke |
| `matcher?` | `string` | Optional regex pattern to match tool names |

#### Returns

`void`

***

### onPostToolUseFailure()

> **onPostToolUseFailure**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md), `matcher?`: `string`): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:66](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L66)

Register a PostToolUseFailure hook.
Called when tool execution fails.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) | The hook callback to invoke |
| `matcher?` | `string` | Optional regex pattern to match tool names |

#### Returns

`void`

***

### onPreCompact()

> **onPreCompact**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:72](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L72)

Register a PreCompact hook.
Called before context compaction.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`

***

### onPreGenerate()

> **onPreGenerate**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:27](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L27)

Register a PreGenerate hook.
Called before each generation request.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`

***

### onPreToolUse()

> **onPreToolUse**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md), `matcher?`: `string`): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:48](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L48)

Register a PreToolUse hook.
Called before each tool execution.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) | The hook callback to invoke |
| `matcher?` | `string` | Optional regex pattern to match tool names (e.g., "Write|Edit") |

#### Returns

`void`

***

### onSessionEnd()

> **onSessionEnd**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:90](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L90)

Register a SessionEnd hook.
Called when a session ends.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`

***

### onSessionStart()

> **onSessionStart**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:84](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L84)

Register a SessionStart hook.
Called when a session starts.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`

***

### onSubagentStart()

> **onSubagentStart**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:96](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L96)

Register a SubagentStart hook.
Called when a subagent starts.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`

***

### onSubagentStop()

> **onSubagentStop**(`callback`: [`HookCallback`](../type-aliases/HookCallback.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:102](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L102)

Register a SubagentStop hook.
Called when a subagent stops.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `callback` | [`HookCallback`](../type-aliases/HookCallback.md) |

#### Returns

`void`
