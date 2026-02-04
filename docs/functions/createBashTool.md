[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createBashTool

# Function: createBashTool()

> **createBashTool**(`options`: [`BashToolOptions`](../interfaces/BashToolOptions.md)): [`Tool`](../type-aliases/Tool.md)&lt;\{ `command`: `string`; `timeout?`: `number`; \}, [`BashResult`](../interfaces/BashResult.md)&gt;

Defined in: [packages/agent-sdk/src/tools/execute.ts:133](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L133)

Creates a tool for executing shell commands in a sandbox.

This tool provides secure command execution with:
- Timeout enforcement
- Output size limits
- Command blocking/allowlisting at tool level
- Optional approval for dangerous commands

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`BashToolOptions`](../interfaces/BashToolOptions.md) | Configuration options |

## Returns

[`Tool`](../type-aliases/Tool.md)&lt;\{ `command`: `string`; `timeout?`: `number`; \}, [`BashResult`](../interfaces/BashResult.md)&gt;

An AI SDK compatible tool for shell execution

## Example

```typescript
import { createBashTool, LocalSandbox } from "@lleverage-ai/agent-sdk";

const sandbox = new LocalSandbox({ cwd: process.cwd() });
const bash = createBashTool({
  sandbox,
  timeout: 30000,
  blockedCommands: ["rm -rf /"],
});

const agent = createAgent({
  model,
  tools: { bash },
});
```
