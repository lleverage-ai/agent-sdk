[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LoadableSkillDefinition

# Interface: LoadableSkillDefinition

Defined in: [packages/agent-sdk/src/tools/skills.ts:42](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L42)

Definition of a loadable skill for progressive disclosure.

Skills bundle tools and prompts that are loaded dynamically by the agent.
This extends the basic `SkillDefinition` with support for MCP tools and
dependencies, enabling on-demand capability expansion.

## Example

```typescript
const gitSkill: LoadableSkillDefinition = {
  name: "git",
  description: "Git version control operations",
  tools: {
    git_status: tool({ ... }),
    git_commit: tool({ ... }),
  },
  prompt: "You now have access to Git tools. Use them to manage version control.",
};
```

## Properties

### dependencies?

> `optional` **dependencies**: `string`[]

Defined in: [packages/agent-sdk/src/tools/skills.ts:84](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L84)

Optional skills this skill depends on.
Dependencies are loaded first when this skill is loaded.

***

### description

> **description**: `string`

Defined in: [packages/agent-sdk/src/tools/skills.ts:47](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L47)

Description for the agent to decide when to invoke this skill

***

### mcpTools?

> `optional` **mcpTools**: `string`[]

Defined in: [packages/agent-sdk/src/tools/skills.ts:72](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L72)

MCP tool names to load when this skill is activated.

These are tool names from the MCPManager (e.g., "mcp__github__list_issues").
They will be loaded via MCPManager.loadTools() when the skill is activated.

#### Example

```typescript
const githubSkill: LoadableSkillDefinition = {
  name: "github",
  description: "GitHub operations",
  tools: {},  // No inline tools
  mcpTools: [
    "mcp__github__list_issues",
    "mcp__github__create_pr",
  ],
  prompt: "You can now work with GitHub issues and PRs.",
};
```

***

### name

> **name**: `string`

Defined in: [packages/agent-sdk/src/tools/skills.ts:44](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L44)

Unique identifier for the skill

***

### prompt

> **prompt**: `string` \| (`args?`: `string`) => `string`

Defined in: [packages/agent-sdk/src/tools/skills.ts:78](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L78)

Prompt to inject when the skill is loaded.
Can be a string or a function that receives optional arguments.

***

### tools

> **tools**: [`ToolSet`](../type-aliases/ToolSet.md)

Defined in: [packages/agent-sdk/src/tools/skills.ts:50](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L50)

Tools this skill provides (inline tools)
