[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / aggregatePermissionDecisions

# Function: aggregatePermissionDecisions()

> **aggregatePermissionDecisions**(`hookOutputs`: [`HookOutput`](../interfaces/HookOutput.md)[], `defaultDecision`: `"allow"` \| `"deny"` \| `"ask"`): `"allow"` \| `"deny"` \| `"ask"`

Defined in: [packages/agent-sdk/src/hooks.ts:228](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks.ts#L228)

Aggregates permission decisions from multiple hook outputs.

Follows the hierarchy: deny \> ask \> allow \> default

## Parameters

| Parameter | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `hookOutputs` | [`HookOutput`](../interfaces/HookOutput.md)[] | `undefined` | Array of hook outputs to aggregate |
| `defaultDecision` | `"allow"` \| `"deny"` \| `"ask"` | `"allow"` | Default decision if no hooks provide one (default: 'allow') |

## Returns

`"allow"` \| `"deny"` \| `"ask"`

The aggregated permission decision

## Example

```typescript
const outputs: HookOutput[] = [
  { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } },
  { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } },
];

const decision = aggregatePermissionDecisions(outputs);
// Returns 'deny' because deny wins over allow
```
