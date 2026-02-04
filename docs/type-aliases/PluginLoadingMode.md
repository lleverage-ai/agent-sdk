[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / PluginLoadingMode

# Type Alias: PluginLoadingMode

> **PluginLoadingMode** = `"eager"` \| `"lazy"` \| `"explicit"`

Defined in: [packages/agent-sdk/src/types.ts:886](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L886)

Plugin loading mode.

- `"eager"` - Load all plugin tools immediately into context
- `"lazy"` - Register tools with metadata only, load on-demand
- `"explicit"` - Don't auto-register, require manual registration
