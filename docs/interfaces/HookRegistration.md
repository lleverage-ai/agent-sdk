[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / HookRegistration

# Interface: HookRegistration

Defined in: [packages/agent-sdk/src/types.ts:2216](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2216)

Configuration for registering hooks with matchers.

## Properties

### InterruptRequested?

> `optional` **InterruptRequested**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2272](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2272)

Interrupt lifecycle hooks.
Called when interrupts are requested (approval, custom) and resolved.

***

### InterruptResolved?

> `optional` **InterruptResolved**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2273](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2273)

***

### MCPConnectionFailed?

> `optional` **MCPConnectionFailed**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2251](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2251)

MCP connection lifecycle hooks.
Array of hook callbacks.

***

### MCPConnectionRestored?

> `optional` **MCPConnectionRestored**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2252](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2252)

***

### PostCompact?

> `optional` **PostCompact**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2266](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2266)

***

### PostGenerate?

> `optional` **PostGenerate**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2230](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2230)

***

### PostGenerateFailure?

> `optional` **PostGenerateFailure**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2231](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2231)

***

### PostToolUse?

> `optional` **PostToolUse**: [`HookMatcher`](HookMatcher.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2222](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2222)

***

### PostToolUseFailure?

> `optional` **PostToolUseFailure**: [`HookMatcher`](HookMatcher.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2223](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2223)

***

### PreCompact?

> `optional` **PreCompact**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2265](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2265)

Context compaction lifecycle hooks.
Array of hook callbacks.

***

### PreGenerate?

> `optional` **PreGenerate**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2229](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2229)

Generation lifecycle hooks (no matchers - not tool-specific).
Array of hook callbacks.

***

### PreToolUse?

> `optional` **PreToolUse**: [`HookMatcher`](HookMatcher.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2221](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2221)

Tool lifecycle hooks with matchers.
Array of matchers, each with optional regex pattern and hook callbacks.

***

### SessionEnd?

> `optional` **SessionEnd**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2238](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2238)

***

### SessionStart?

> `optional` **SessionStart**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2237](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2237)

Session lifecycle hooks.
Array of hook callbacks.

***

### SubagentStart?

> `optional` **SubagentStart**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2244](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2244)

Subagent lifecycle hooks.
Array of hook callbacks.

***

### SubagentStop?

> `optional` **SubagentStop**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2245](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2245)

***

### ToolLoadError?

> `optional` **ToolLoadError**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2259](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2259)

***

### ToolRegistered?

> `optional` **ToolRegistered**: [`HookCallback`](../type-aliases/HookCallback.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2258](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2258)

Tool registry lifecycle hooks.
Array of hook callbacks.
