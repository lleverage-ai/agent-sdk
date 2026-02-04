# Tool Loading Strategies

The SDK provides multiple mechanisms for loading tools, each optimized for different scenarios:

- **Eager Loading** (default): Load all tools upfront — best for small tool sets (< 20 tools)
- **Lazy Loading** (`use_tools`): Load tools on-demand via a registry — best for 20-100+ tools
- **Dynamic Discovery** (`search_tools`): Search and load MCP tools dynamically — best for 100+ tools
- **MCP Loading**: Connect to external MCP servers for standardized tool ecosystems

## When to Use Each Approach

**Use Eager Loading when:**

- Small tool set (< 20 tools) that's always needed
- Simplest setup with best performance
- All tools are core to the agent's purpose

**Use Lazy Loading when:**

- Large tool set (20-100+ tools)
- Agent only needs a subset per conversation
- Plugin architecture with domain-specific tools
- Want to minimize context window usage

**Use Dynamic Discovery when:**

- Very large tool set (100+ tools)
- Tool needs are unpredictable
- Using MCP ecosystem with many servers
- Want agent to explore capabilities dynamically

**Use MCP Loading when:**

- Integrating external tool ecosystems (filesystem, databases, APIs)
- Need standardized tool protocols
- Building on existing MCP infrastructure

## Quick Examples

```typescript
// Eager loading (default)
const agent = createAgent({
  model,
  tools: { calculator, weather, database }, // All loaded immediately
});

// Lazy loading with use_tools
const registry = new ToolRegistry();
registry.registerPlugin("stripe", stripePlugin.tools);
registry.registerPlugin("github", githubPlugin.tools);

const agent = createAgent({
  model,
  tools: {
    use_tools: createUseToolsTool({ registry }),
  },
  pluginLoading: "lazy",
});
// Agent loads tools on demand: use_tools({ plugin: "stripe" })
// (Tools also become active after agent.loadTools([...]) in lazy mode)

// Dynamic discovery with search_tools
const mcpManager = new MCPManager();
await mcpManager.connectServer({ name: "filesystem", command: "npx", args: [...] });

const agent = createAgent({
  model,
  mcpManager,
  mcpEagerLoad: false,
  tools: {
    search_tools: createSearchToolsTool({ manager: mcpManager, enableLoad: true }),
  },
});
// Agent discovers tools: search_tools({ query: "list files", load: true })
```

## Tool Registry

The tool registry allows you to organize tools by plugin and load them on demand:

```typescript
import { ToolRegistry, createUseToolsTool } from "@lleverage-ai/agent-sdk";

const registry = new ToolRegistry();

// Register plugins
registry.registerPlugin("stripe", {
  createCustomer: stripeCreateCustomerTool,
  listCharges: stripeListChargesTool,
  refund: stripeRefundTool,
});

registry.registerPlugin("github", {
  createIssue: githubCreateIssueTool,
  listPRs: githubListPRsTool,
});

// Create the use_tools tool
const useTools = createUseToolsTool({
  registry,
  onLoad: (plugin, tools) => {
    console.log(`Loaded ${tools.length} tools from ${plugin}`);
  },
});

const agent = createAgent({
  model,
  tools: { use_tools: useTools },
  pluginLoading: "lazy",
});
```

## Search Tools

For very large tool sets, enable search-based discovery:

```typescript
import { createSearchToolsTool, MCPManager } from "@lleverage-ai/agent-sdk";

const mcpManager = new MCPManager();

// Connect multiple MCP servers
await mcpManager.connectServer({
  name: "filesystem",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
});

await mcpManager.connectServer({
  name: "database",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-postgres"],
  env: { DATABASE_URL: process.env.DATABASE_URL },
});

// Create search tool
const searchTools = createSearchToolsTool({
  manager: mcpManager,
  enableLoad: true, // Allow loading tools from search results
  maxResults: 10,
});

const agent = createAgent({
  model,
  mcpManager,
  mcpEagerLoad: false, // Don't load all tools upfront
  tools: { search_tools: searchTools },
});

// Agent can now:
// 1. Search: search_tools({ query: "read file" })
// 2. Load: search_tools({ query: "read file", load: true })
```

## Combining Strategies

You can combine multiple loading strategies:

```typescript
const agent = createAgent({
  model,
  // Eager: always-needed tools
  tools: {
    calculator,
    use_tools: createUseToolsTool({ registry }),
    search_tools: createSearchToolsTool({ manager: mcpManager }),
  },
  // Lazy plugins via use_tools
  pluginLoading: "lazy",
  // MCP tools via search_tools
  mcpManager,
  mcpEagerLoad: false,
});
```

## Performance Considerations

| Strategy | Context Usage | Latency | Best For |
|----------|--------------|---------|----------|
| Eager | High (all tools in context) | Low (no loading) | < 20 tools |
| Lazy | Medium (loaded on demand) | Medium (one load call) | 20-100 tools |
| Search | Low (only loaded tools) | Higher (search + load) | 100+ tools |

## Migration Guide

**From eager to lazy loading:**

```typescript
// Before (eager)
const agent = createAgent({
  model,
  plugins: [stripePlugin, githubPlugin, slackPlugin],
});

// After (lazy)
const registry = new ToolRegistry();
registry.registerPlugin("stripe", stripePlugin.tools);
registry.registerPlugin("github", githubPlugin.tools);
registry.registerPlugin("slack", slackPlugin.tools);

const agent = createAgent({
  model,
  tools: { use_tools: createUseToolsTool({ registry }) },
  pluginLoading: "lazy",
});
```
