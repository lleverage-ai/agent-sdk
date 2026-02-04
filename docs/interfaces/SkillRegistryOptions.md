[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SkillRegistryOptions

# Interface: SkillRegistryOptions

Defined in: [packages/agent-sdk/src/tools/skills.ts:120](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L120)

Options for creating a skill registry.

## Properties

### mcpManager?

> `optional` **mcpManager**: [`MCPManager`](../classes/MCPManager.md)

Defined in: [packages/agent-sdk/src/tools/skills.ts:132](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L132)

MCP manager for loading MCP tools referenced by skills.

When provided, skills can specify `mcpTools` to load MCP tools
when the skill is activated.

***

### onSkillLoaded()?

> `optional` **onSkillLoaded**: (`skillName`: `string`, `result`: [`SkillLoadResult`](SkillLoadResult.md)) => `void`

Defined in: [packages/agent-sdk/src/tools/skills.ts:137](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L137)

Callback when a skill is loaded.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `skillName` | `string` |
| `result` | [`SkillLoadResult`](SkillLoadResult.md) |

#### Returns

`void`

***

### skills?

> `optional` **skills**: [`LoadableSkillDefinition`](LoadableSkillDefinition.md)[]

Defined in: [packages/agent-sdk/src/tools/skills.ts:124](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L124)

Initial skills to register.
