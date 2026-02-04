[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createSkillRegistry

# Function: createSkillRegistry()

> **createSkillRegistry**(`skills`: [`LoadableSkillDefinition`](../interfaces/LoadableSkillDefinition.md)[], `options?`: `Omit`&lt;[`SkillRegistryOptions`](../interfaces/SkillRegistryOptions.md), `"skills"`&gt;): [`SkillRegistry`](../classes/SkillRegistry.md)

Defined in: [packages/agent-sdk/src/tools/skills.ts:603](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L603)

Creates a new skill registry with the given skills.

This is a convenience function for creating a SkillRegistry instance.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `skills` | [`LoadableSkillDefinition`](../interfaces/LoadableSkillDefinition.md)[] | Initial skills to register |
| `options?` | `Omit`&lt;[`SkillRegistryOptions`](../interfaces/SkillRegistryOptions.md), `"skills"`&gt; | Additional options |

## Returns

[`SkillRegistry`](../classes/SkillRegistry.md)

A new SkillRegistry instance

## Example

```typescript
const registry = createSkillRegistry([gitSkill, dockerSkill]);
```
