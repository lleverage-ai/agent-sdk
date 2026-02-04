[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / defineLoadableSkill

# Function: defineLoadableSkill()

> **defineLoadableSkill**(`options`: [`LoadableSkillDefinition`](../interfaces/LoadableSkillDefinition.md)): [`LoadableSkillDefinition`](../interfaces/LoadableSkillDefinition.md)

Defined in: [packages/agent-sdk/src/tools/skills.ts:637](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L637)

Creates a skill definition.

This is a helper function for creating LoadableSkillDefinition objects
with proper typing.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`LoadableSkillDefinition`](../interfaces/LoadableSkillDefinition.md) | Skill configuration |

## Returns

[`LoadableSkillDefinition`](../interfaces/LoadableSkillDefinition.md)

A LoadableSkillDefinition object

## Example

```typescript
const gitSkill = defineLoadableSkill({
  name: "git",
  description: "Git version control operations",
  tools: {
    git_status: tool({ ... }),
    git_commit: tool({ ... }),
  },
  prompt: "You now have access to Git tools.",
});
```
