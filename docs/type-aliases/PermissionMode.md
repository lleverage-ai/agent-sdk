[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PermissionMode

# Type Alias: PermissionMode

> **PermissionMode** = `"default"` \| `"acceptEdits"` \| `"bypassPermissions"` \| `"plan"`

Defined in: [packages/agent-sdk/src/types.ts:2107](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2107)

Permission mode controlling default tool approval behavior.

Aligned with Claude Agent SDK permission modes:
- `default`: Unmatched tools trigger canUseTool callback or hooks
- `acceptEdits`: Auto-approve file edit operations (Write, Edit, filesystem commands)
- `bypassPermissions`: Auto-approve all tools (dangerous - use only for testing/demos)
- `plan`: Block all tool execution (planning/analysis only)
