# Tool Loading Strategies

The SDK supports three practical loading patterns for plugin and MCP tools:

- **Eager loading** (default): plugin tools are added to the active tool set up front
- **Deferred discovery** (`search_tools`): agent discovers tools first, then loads them
- **Proxy loading** (`call_tool`): tools stay out of the active schema and are invoked through a stable proxy

## Eager Loading (Default)

Use this when you have a small, always-needed tool set.

```typescript
const agent = createAgent({
  model,
  plugins: [githubPlugin, jiraPlugin],
  // pluginLoading defaults to "eager"
});
```

Characteristics:

- Lowest invocation overhead (tool is already active)
- Larger active tool schema in prompt context
- Best for focused agents with limited tool count

## Deferred Discovery with `search_tools`

Use this when tool count is moderate/large and agents should discover relevant tools first.

```typescript
const agent = createAgent({
  model,
  plugins: [pluginA, pluginB, pluginC],
  toolSearch: {
    enabled: "auto", // "auto" | "always" | "never"
    threshold: 20,
    maxResults: 10,
  },
});
```

Behavior:

- `search_tools` is created when discovery is useful (auto-threshold, explicit enablement, or external MCP servers)
- In non-proxy mode, discovered tools can be loaded for direct use

## Proxy Loading (`pluginLoading: "proxy"`)

Use this when schema stability and prompt-cache friendliness are priorities.

```typescript
const agent = createAgent({
  model,
  plugins: [githubPlugin, jiraPlugin, stripePlugin],
  pluginLoading: "proxy",
});
```

Behavior:

- Plugin tools are not injected into the active tool set
- Agent gets:
  - `search_tools` for discovery
  - `call_tool` for invocation by MCP-style name
- Tool schema remains stable across turns, which helps provider prompt caching

Per-plugin control:

```typescript
const plugin = definePlugin({
  name: "github",
  deferred: true, // proxied even when agent uses eager mode
  tools: { list_issues: listIssuesTool },
});
```

## External MCP Servers

External servers are searchable through the same mechanism:

```typescript
const mcpManager = new MCPManager();
await mcpManager.addServer("filesystem", {
  type: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
});

const agent = createAgent({
  model,
  mcpManager,
  toolSearch: { enabled: "always" },
});
```

## Caching Guidance

For better prompt cache reuse:

- Keep the system prompt static between turns
- Prefer proxy mode for dynamically expanding tool catalogs
- Avoid injecting per-turn dynamic sections into the default system prompt unless needed

## Migration Notes

Legacy lazy-loading patterns (`pluginLoading: "lazy"`, `use_tools`, `ToolRegistry`) are removed.

Use one of:

- `toolSearch` for discovery-driven loading
- `pluginLoading: "proxy"` + `call_tool` for stable-schema invocation
