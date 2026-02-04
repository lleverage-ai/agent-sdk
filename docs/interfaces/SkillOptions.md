[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SkillOptions

# Interface: SkillOptions

Defined in: [packages/agent-sdk/src/types.ts:1744](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1744)

Options for the [defineSkill](../functions/defineSkill.md) helper function.

## Properties

### description

> **description**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1749](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1749)

Description of what this skill does

***

### name

> **name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1746](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1746)

Name of the skill

***

### prompt

> **prompt**: `string` \| (`args?`: `string`) => `string`

Defined in: [packages/agent-sdk/src/types.ts:1752](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1752)

The prompt template

***

### tools?

> `optional` **tools**: [`ToolSet`](../type-aliases/ToolSet.md)

Defined in: [packages/agent-sdk/src/types.ts:1755](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1755)

Optional tools specific to this skill (AI SDK ToolSet)
