[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createCoreTools

# Function: createCoreTools()

> **createCoreTools**(`options`: [`CoreToolsOptions`](../interfaces/CoreToolsOptions.md)): [`CoreTools`](../interfaces/CoreTools.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:325](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L325)

Creates all core tools from configuration.

This is the recommended way to create agent tools. The minimal tool set is:
- `read`, `write`, `edit`, `glob`, `grep` - filesystem operations
- `bash` - shell command execution (optional, requires sandbox)
- `todo_write` - task tracking (optional)
- `task` - subagent delegation (optional, requires subagents)
- `skill` - progressive capability loading (optional, requires registry)

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`CoreToolsOptions`](../interfaces/CoreToolsOptions.md) | Configuration options |

## Returns

[`CoreTools`](../interfaces/CoreTools.md)

Object containing all created tools and registries

## Examples

```typescript
import { createAgent, createCoreTools, createAgentState } from "@lleverage-ai/agent-sdk";
import { FilesystemBackend, LocalSandbox } from "@lleverage-ai/agent-sdk";

const state = createAgentState();
const backend = new FilesystemBackend({ rootDir: process.cwd() });
const sandbox = new LocalSandbox({ cwd: process.cwd() });

const tools = createCoreTools({
  backend,
  state,
  sandbox,
});

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools,
});
```

```typescript
// Minimal: just filesystem tools
const tools = createCoreTools({
  backend: new StateBackend(state),
  state,
  includeTodoWrite: false,
});
```
