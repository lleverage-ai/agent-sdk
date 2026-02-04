[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CoreToolsOptions

# Interface: CoreToolsOptions

Defined in: [packages/agent-sdk/src/tools/factory.ts:94](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L94)

Options for creating core tools.

This is the main configuration interface for the tool factory.
Only `backend` and `state` are required - all other options enable
additional functionality.

## Example

```typescript
const tools = createCoreTools({
  backend: new FilesystemBackend({ rootDir: process.cwd() }),
  state: createAgentState(),

  // Enable shell execution
  sandbox: new LocalSandbox({ cwd: process.cwd() }),

  // Enable skill loading
  skillRegistry: createSkillRegistry([gitSkill, dockerSkill]),

  // Enable subagent delegation
  subagents: [researcherAgent, coderAgent],
  parentAgent: mainAgent,
  defaultModel: anthropic("claude-sonnet-4-20250514"),
});
```

## Properties

### backend

> **backend**: [`BackendProtocol`](BackendProtocol.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:98](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L98)

Storage backend for file operations

***

### bashOptions?

> `optional` **bashOptions**: `Omit`&lt;[`BashToolOptions`](BashToolOptions.md), `"sandbox"`&gt;

Defined in: [packages/agent-sdk/src/tools/factory.ts:156](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L156)

Options for the bash tool

***

### defaultModel?

> `optional` **defaultModel**: [`LanguageModel`](../type-aliases/LanguageModel.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:198](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L198)

Default model for subagents (required with subagents)

***

### disabled?

> `optional` **disabled**: [`CoreToolName`](../type-aliases/CoreToolName.md)[]

Defined in: [packages/agent-sdk/src/tools/factory.ts:118](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L118)

Array of core tool names to disable.
Takes precedence over individual include options.

#### Example

```typescript
const tools = createCoreTools({
  backend,
  state,
  disabled: ["bash", "write"], // Disable bash and write tools
});
```

***

### includeEdit?

> `optional` **includeEdit**: `boolean`

Defined in: [packages/agent-sdk/src/tools/factory.ts:132](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L132)

Include edit tool.

#### Default Value

```ts
true
```

***

### includeGeneralPurpose?

> `optional` **includeGeneralPurpose**: `boolean`

Defined in: [packages/agent-sdk/src/tools/factory.ts:204](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L204)

Include general-purpose subagent automatically.

#### Default Value

```ts
false
```

***

### includeTodoWrite?

> `optional` **includeTodoWrite**: `boolean`

Defined in: [packages/agent-sdk/src/tools/factory.ts:140](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L140)

Include todo_write tool.

#### Default Value

```ts
true
```

***

### includeWrite?

> `optional` **includeWrite**: `boolean`

Defined in: [packages/agent-sdk/src/tools/factory.ts:126](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L126)

Include write tool.

#### Default Value

```ts
true
```

***

### mcpManager?

> `optional` **mcpManager**: [`MCPManager`](../classes/MCPManager.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:215](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L215)

MCP manager for search_tools meta-tool.
If provided, search_tools tool is included.

***

### onTodosChanged?

> `optional` **onTodosChanged**: [`OnTodosChanged`](../type-aliases/OnTodosChanged.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:145](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L145)

Callback invoked when todos change.

***

### parentAgent?

> `optional` **parentAgent**: [`Agent`](Agent.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:195](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L195)

Parent agent for creating subagents (required with subagents)

***

### sandbox?

> `optional` **sandbox**: [`SandboxBackendProtocol`](SandboxBackendProtocol.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:153](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L153)

Sandbox backend for command execution.
If provided, bash tool is included.

***

### searchToolsOptions?

> `optional` **searchToolsOptions**: `Omit`&lt;[`SearchToolsOptions`](SearchToolsOptions.md), `"manager"`&gt;

Defined in: [packages/agent-sdk/src/tools/factory.ts:218](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L218)

Options for the search_tools tool

***

### skillRegistry?

> `optional` **skillRegistry**: [`SkillRegistry`](../classes/SkillRegistry.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:165](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L165)

Skill registry for progressive disclosure.
If provided, the skill tool is included.
Takes precedence over `skills` if both are provided.

***

### skills?

> `optional` **skills**: [`SkillDefinition`](SkillDefinition.md)[]

Defined in: [packages/agent-sdk/src/tools/factory.ts:181](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L181)

Array of skill definitions to auto-create a registry from.
Alternative to providing a skillRegistry directly.
Only skills with tools will be included.

#### Example

```typescript
const tools = createCoreTools({
  backend,
  state,
  skills: [gitSkill, dockerSkill],
});
```

***

### skillToolOptions?

> `optional` **skillToolOptions**: `Partial`&lt;[`SkillToolOptions`](SkillToolOptions.md)&gt;

Defined in: [packages/agent-sdk/src/tools/factory.ts:184](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L184)

Options for the skill tool

***

### state

> **state**: [`AgentState`](AgentState.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:101](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L101)

Agent state containing todos and virtual filesystem

***

### subagents?

> `optional` **subagents**: [`SubagentDefinition`](SubagentDefinition.md)[]

Defined in: [packages/agent-sdk/src/tools/factory.ts:192](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L192)

Subagent definitions for task delegation.
If provided along with parentAgent and defaultModel, task tool is included.

***

### taskOptions?

> `optional` **taskOptions**: `Partial`&lt;[`TaskToolOptions_Tool`](TaskToolOptions_Tool.md)&gt;

Defined in: [packages/agent-sdk/src/tools/factory.ts:207](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L207)

Options for the task tool
