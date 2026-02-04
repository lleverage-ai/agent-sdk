[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / HookSpecificOutput

# Interface: HookSpecificOutput

Defined in: [packages/agent-sdk/src/types.ts:2113](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2113)

Hook-specific output that controls operation behavior.

## Properties

### blockedMessageIds?

> `optional` **blockedMessageIds**: `string`[]

Defined in: [packages/agent-sdk/src/types.ts:2126](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2126)

Message IDs that caused the block (for client-side cleanup)

***

### hookEventName

> **hookEventName**: [`HookEvent`](../type-aliases/HookEvent.md)

Defined in: [packages/agent-sdk/src/types.ts:2115](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2115)

Required: identifies which hook type this output is for

***

### permissionDecision?

> `optional` **permissionDecision**: [`PermissionDecision`](../type-aliases/PermissionDecision.md)

Defined in: [packages/agent-sdk/src/types.ts:2120](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2120)

Permission decision for the operation

***

### permissionDecisionReason?

> `optional` **permissionDecisionReason**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2123](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2123)

Explanation for the decision (shown to model and logs)

***

### respondWith?

> `optional` **respondWith**: `unknown`

Defined in: [packages/agent-sdk/src/types.ts:2132](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2132)

Short-circuit with cached/mock result (skips actual execution)

***

### retry?

> `optional` **retry**: `boolean`

Defined in: [packages/agent-sdk/src/types.ts:2142](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2142)

Signal to retry the failed operation

***

### retryDelayMs?

> `optional` **retryDelayMs**: `number`

Defined in: [packages/agent-sdk/src/types.ts:2145](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2145)

Delay before retry in milliseconds

***

### updatedInput?

> `optional` **updatedInput**: `unknown`

Defined in: [packages/agent-sdk/src/types.ts:2129](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2129)

Modified input (PreToolUse: tool input, PreGenerate: options)

***

### updatedResult?

> `optional` **updatedResult**: `unknown`

Defined in: [packages/agent-sdk/src/types.ts:2137](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2137)

Modified output (transform result before returning)
