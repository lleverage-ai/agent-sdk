[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SkillDefinition

# Interface: SkillDefinition

Defined in: [packages/agent-sdk/src/types.ts:1722](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1722)

Definition of a skill providing contextual instructions for agents.

Skills serve multiple purposes:
- **Tool guidance**: Bundle with plugin tools to explain how to use them
- **Instructions only**: Load dynamic instructions without tools
- **Progressive disclosure**: Include tools that load on-demand

## Example

```typescript
// Skill bundled with plugin tools
const dataSkill: SkillDefinition = {
  name: "data-exploration",
  description: "Query and visualize data",
  prompt: "Use getSchema first to see available columns.",
};

// Skill with tools for progressive disclosure
const analyzeSkill: SkillDefinition = {
  name: "analyze",
  description: "Deep code analysis",
  prompt: "Perform detailed analysis.",
  tools: { lint, typeCheck },
};
```

## Properties

### description

> **description**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1727](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1727)

Description of what this skill does

***

### name

> **name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1724](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1724)

Unique name identifying this skill

***

### prompt

> **prompt**: `string` \| (`args?`: `string`) => `string`

Defined in: [packages/agent-sdk/src/types.ts:1733](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1733)

The prompt to use when this skill is invoked.
Can be a string or a function that receives arguments and returns a prompt.

***

### tools?

> `optional` **tools**: [`ToolSet`](../type-aliases/ToolSet.md)

Defined in: [packages/agent-sdk/src/types.ts:1736](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1736)

Optional tools that are only available when this skill is active
