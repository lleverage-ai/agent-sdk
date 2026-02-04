[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createSkillTool

# Function: createSkillTool()

> **createSkillTool**(`options`: [`SkillToolOptions`](../interfaces/SkillToolOptions.md)): [`Tool`](../type-aliases/Tool.md)&lt;\{ `args?`: `string`; `skill_name`: `string`; \}, `Record`&lt;`string`, `unknown`&gt;&gt;

Defined in: [packages/agent-sdk/src/tools/skills.ts:512](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L512)

Creates a tool that allows agents to load skills on-demand.

The tool's description dynamically lists available (not yet loaded) skills,
so the agent can decide which skill to load based on the conversation.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`SkillToolOptions`](../interfaces/SkillToolOptions.md) | Configuration options |

## Returns

[`Tool`](../type-aliases/Tool.md)&lt;\{ `args?`: `string`; `skill_name`: `string`; \}, `Record`&lt;`string`, `unknown`&gt;&gt;

An AI SDK compatible tool for loading skills

## Example

```typescript
import { createSkillTool, SkillRegistry } from "@lleverage-ai/agent-sdk";

const registry = new SkillRegistry({
  skills: [gitSkill, dockerSkill],
});

const skillTool = createSkillTool({ registry });

const agent = createAgent({
  model,
  tools: { load_skill: skillTool },
});

// Agent can now invoke load_skill to gain new capabilities
```
