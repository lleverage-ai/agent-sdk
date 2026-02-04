[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / defineSkill

# Function: defineSkill()

> **defineSkill**(`options`: [`SkillOptions`](../interfaces/SkillOptions.md)): [`SkillDefinition`](../interfaces/SkillDefinition.md)

Defined in: [packages/agent-sdk/src/tools.ts:68](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools.ts#L68)

Creates a skill definition for providing contextual instructions to agents.

Skills serve multiple purposes:
- **Tool guidance**: Bundle with plugin tools to explain how to use them
- **Instructions only**: Load dynamic instructions without tools
- **Progressive disclosure**: Include tools that load on-demand

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`SkillOptions`](../interfaces/SkillOptions.md) | Configuration options for the skill |

## Returns

[`SkillDefinition`](../interfaces/SkillDefinition.md)

A skill definition object

## Example

```typescript
import { defineSkill, definePlugin } from "@lleverage-ai/agent-sdk";

// Skill that provides guidance for using plugin tools
const dataSkill = defineSkill({
  name: "data-exploration",
  description: "Query and visualize data",
  prompt: `You have access to data exploration tools.
Available tables: products, users, sales.
Always use getSchema first to see column types.`,
});

// Bundle skill with tools in a plugin
const dataPlugin = definePlugin({
  name: "data-explorer",
  tools: { getSchema, queryData },
  skills: [dataSkill],
});

// Skill with no tools - just loads instructions
const guidelinesSkill = defineSkill({
  name: "guidelines",
  description: "Project coding standards",
  prompt: "Follow TypeScript strict mode and use named exports.",
});

// Skill with tools for progressive disclosure
const analyzeSkill = defineSkill({
  name: "analyze",
  description: "Deep code analysis",
  prompt: "Perform detailed code analysis.",
  tools: {
    lint: tool({
      description: "Run linter",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => runLinter(path),
    }),
  },
});
```
