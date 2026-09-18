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
  - `call_tool` for invocation by qualified tool name
- Function-based plugin tools that use `StreamingContext` can also be deferred;
  discovery uses `writer: null`, and `call_tool` receives the live writer during
  `streamDataResponse()`
- Tool schema remains stable across turns, which helps provider prompt caching
- Inline plugin tools use `<plugin>__<tool>`
- External MCP tools use `mcp__<server>__<tool>`

Per-plugin control:

```typescript
const plugin = definePlugin({
  name: "github",
  deferred: true, // proxied even when agent uses eager mode
  tools: { list_issues: listIssuesTool },
});
```

### Direct calls to proxied tools

Models sometimes emit a proxied tool's qualified name directly
(`github__list_issues`) instead of going through `call_tool`. Because that
name is not in the active tool set, the AI SDK would raise `NoSuchToolError`
and the model would have to retry.

By default the SDK repairs such calls into the equivalent `call_tool`
invocation, keeping the original tool call id so the transcript stays
consistent and the call still passes through the normal validation and
approval pipeline. Only exact, currently discoverable names whose input
parses to a JSON object are repaired; anything else falls through to the
normal error path.

```typescript
const agent = createAgent({
  model,
  plugins: [githubPlugin],
  pluginLoading: "proxy",
  repairDiscoveredToolCalls: false, // opt out
});
```

Setting `AGENT_SDK_DISABLE_TOOL_CALL_REPAIR=true` disables the repair for
every agent in the process (useful in tests that assert the unrepaired error);
an explicit `repairDiscoveredToolCalls` option takes precedence over the
environment variable.

### Near-miss suggestions

A name that is close but not exact (`skills__update_skill` for
`skills__change_skill_draft`) cannot be repaired. Instead of a bare "not
found" that sends the model back to `search_tools`, the error names the
closest discoverable tools, ranked by the same index `search_tools` uses:

- `call_tool` returns
  `` Error: Tool "skills__update_skill" not found. Closest available tools: `skills__change_skill_draft`, `skills__get_skill`. Call one of them by its exact name. ``
- a direct call of the unknown name, when `transformToolError` is configured,
  is transformed from a `NoSuchToolError` whose `availableTools` holds the
  suggestions and whose message ends `... through call_tool.` It stays a
  `NoSuchToolError` so hosts that classify by error class keep the message.

At most `NEAR_MISS_SUGGESTION_LIMIT` (3) names are suggested, the requested
name is never suggested back, and a failing search falls back to the plain
`search_tools` hint. Suggestions are names only; nothing is executed on the
model's behalf. `suggestNearMissTools(mcpManager, toolName)` exposes the same
ranking for custom proxies.

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
