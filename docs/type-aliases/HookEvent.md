[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / HookEvent

# Type Alias: HookEvent

> **HookEvent** = `"SessionStart"` \| `"SessionEnd"` \| `"UserPromptSubmit"` \| `"PreGenerate"` \| `"PostGenerate"` \| `"PostGenerateFailure"` \| `"PreToolUse"` \| `"PostToolUse"` \| `"PostToolUseFailure"` \| `"SubagentStart"` \| `"SubagentStop"` \| `"Stop"` \| `"PreCompact"` \| `"PostCompact"` \| `"PreCheckpointSave"` \| `"PostCheckpointSave"` \| `"PreCheckpointLoad"` \| `"PostCheckpointLoad"` \| `"InterruptRequested"` \| `"InterruptResolved"` \| `"MCPConnectionFailed"` \| `"MCPConnectionRestored"` \| `"ToolRegistered"` \| `"ToolLoadError"`

Defined in: [packages/agent-sdk/src/types.ts:1770](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1770)

Types of events that can trigger hooks.

Hook names follow Claude Code conventions for consistency.

## See

https://code.claude.com/docs/en/hooks
