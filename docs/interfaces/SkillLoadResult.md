[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SkillLoadResult

# Interface: SkillLoadResult

Defined in: [packages/agent-sdk/src/tools/skills.ts:92](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L92)

Result from attempting to load a skill.

## Properties

### error?

> `optional` **error**: `string`

Defined in: [packages/agent-sdk/src/tools/skills.ts:103](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L103)

Error message if loading failed

***

### loadedDependencies?

> `optional` **loadedDependencies**: `string`[]

Defined in: [packages/agent-sdk/src/tools/skills.ts:106](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L106)

Skills that were loaded as dependencies

***

### loadedMcpTools?

> `optional` **loadedMcpTools**: `string`[]

Defined in: [packages/agent-sdk/src/tools/skills.ts:109](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L109)

MCP tools that were loaded (via MCPManager)

***

### notFoundMcpTools?

> `optional` **notFoundMcpTools**: `string`[]

Defined in: [packages/agent-sdk/src/tools/skills.ts:112](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L112)

MCP tools that were requested but not found

***

### prompt

> **prompt**: `string`

Defined in: [packages/agent-sdk/src/tools/skills.ts:100](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L100)

Prompt from the loaded skill (empty if failed)

***

### success

> **success**: `boolean`

Defined in: [packages/agent-sdk/src/tools/skills.ts:94](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L94)

Whether the skill was loaded successfully

***

### tools

> **tools**: [`ToolSet`](../type-aliases/ToolSet.md)

Defined in: [packages/agent-sdk/src/tools/skills.ts:97](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L97)

Tools provided by the loaded skill (empty if failed)
