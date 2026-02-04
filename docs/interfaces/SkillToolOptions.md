[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SkillToolOptions

# Interface: SkillToolOptions

Defined in: [packages/agent-sdk/src/tools/skills.ts:466](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L466)

Options for creating the skill loading tool.

## Properties

### descriptionPrefix?

> `optional` **descriptionPrefix**: `string`

Defined in: [packages/agent-sdk/src/tools/skills.ts:480](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L480)

Custom description prefix for the tool.
The list of available skills is appended automatically.

***

### name?

> `optional` **name**: `string`

Defined in: [packages/agent-sdk/src/tools/skills.ts:474](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L474)

Custom name for the tool.

#### Default Value

```ts
"load_skill"
```

***

### registry

> **registry**: [`SkillRegistry`](../classes/SkillRegistry.md)

Defined in: [packages/agent-sdk/src/tools/skills.ts:468](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L468)

The skill registry to use
