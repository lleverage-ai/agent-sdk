[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / mergeHooks

# Function: mergeHooks()

> **mergeHooks**(...`registrations`: ([`HookRegistration`](../interfaces/HookRegistration.md) \| `undefined`)[]): [`HookRegistration`](../interfaces/HookRegistration.md)

Defined in: [packages/agent-sdk/src/middleware/apply.ts:121](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/apply.ts#L121)

Merges multiple HookRegistration objects into one.

Hooks are concatenated in order for each event type. This allows
combining hooks from middleware with explicitly provided hooks.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| ...`registrations` | ([`HookRegistration`](../interfaces/HookRegistration.md) \| `undefined`)[] | HookRegistration objects to merge |

## Returns

[`HookRegistration`](../interfaces/HookRegistration.md)

Merged HookRegistration

## Example

```typescript
const middlewareHooks = applyMiddleware(middleware);
const explicitHooks = { PreToolUse: [{ matcher: "bash", hooks: [requireApproval] }] };

const merged = mergeHooks(middlewareHooks, explicitHooks);
// merged contains hooks from both, with middleware hooks first
```
