[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / HookOutput

# Interface: HookOutput

Defined in: [packages/agent-sdk/src/types.ts:2157](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2157)

Output from a hook callback.

Hooks return control information via `hookSpecificOutput`, which contains
event-specific fields like permission decisions, input/output transformations,
cache responses, and retry signals.

## Properties

### hookSpecificOutput?

> `optional` **hookSpecificOutput**: [`HookSpecificOutput`](HookSpecificOutput.md)

Defined in: [packages/agent-sdk/src/types.ts:2159](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2159)

Hook-specific control fields
