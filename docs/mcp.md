# MCP Integration

The SDK provides unified tool management through the Model Context Protocol (MCP).

## Plugin-based MCP Tools

Plugin tools are automatically registered as virtual MCP servers:

```typescript
import { definePlugin } from "@lleverage-ai/agent-sdk";

const githubPlugin = definePlugin({
  name: "github",
  mcpServer: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" }, // Expands from process.env
  },
});
```

## Tool Search and Deferred Loading

When you have many plugin tools, enable tool search to reduce context size:

```typescript
const agent = createAgent({
  model,
  plugins: [plugin1, plugin2, plugin3],
  toolSearch: {
    enabled: "auto", // "auto" | "always" | "never"
    threshold: 20, // Defer when plugin tools > 20
    maxResults: 10, // Max search results
  },
});

// Agent gets a `search_tools` tool to discover and load tools on-demand
```

## MCP Tool Utilities

Helper functions for working with MCP tool names:

```typescript
import {
  mcpTools,
  mcpToolsFor,
  toolsFromPlugin,
} from "@lleverage-ai/agent-sdk";

// Get all MCP tool names from an agent
const allMcpTools = mcpTools(agent); // ["mcp__github__list_issues", ...]

// Get tools for a specific plugin
const githubTools = mcpToolsFor(agent, "github");

// Extract tools from a plugin definition
const tools = toolsFromPlugin(myPlugin);
```

## MCP Security Best Practices

When connecting to external MCP servers, apply security controls to protect against malicious or misconfigured tools:

```typescript
import { createAgent, definePlugin } from "@lleverage-ai/agent-sdk";

const githubPlugin = definePlugin({
  name: "github",
  mcpServer: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },

    // Security: Only allow specific tools from this server
    allowedTools: ["get_issue", "list_issues", "search_issues"],

    // Security: Validate tool inputs against their JSON Schema
    validateInputs: true,

    // Security: Reject tools without meaningful schemas
    requireSchema: true,
  },
});

const agent = createAgent({
  model,
  plugins: [githubPlugin],
});
```

### Security Options

| Option | Description |
|--------|-------------|
| `allowedTools` | Allowlist of permitted tool names (without `mcp__` prefix). Only tools in this list will be loaded. Useful for restricting access to dangerous operations. |
| `validateInputs` | When `true`, tool inputs are validated against their declared JSON Schema before execution. Invalid inputs throw `MCPInputValidationError` instead of being passed to the server. Protects against malformed or malicious inputs. |
| `requireSchema` | When `true`, tools without meaningful schemas (empty or minimal schemas) are rejected during connection. Ensures all tools have explicit input validation. |

### Example: Secure Production MCP Configuration

```typescript
// Production configuration with all security controls
const docsPlugin = definePlugin({
  name: "docs",
  mcpServer: {
    type: "http",
    url: "https://docs.example.com/mcp",
    headers: { Authorization: "Bearer ${DOCS_API_TOKEN}" },

    // Only allow read-only operations
    allowedTools: ["search_docs", "get_document", "list_categories"],

    // Validate all inputs
    validateInputs: true,

    // Require schemas for all tools
    requireSchema: true,
  },
});
```

### Handling Validation Errors

```typescript
import { MCPInputValidationError } from "@lleverage-ai/agent-sdk";

try {
  const result = await agent.generate({
    messages: [{ role: "user", content: "Search the docs" }],
  });
} catch (error) {
  if (error instanceof MCPInputValidationError) {
    console.error(`Invalid input for ${error.toolName}:`);
    console.error(error.errors.join("\n"));
    // Handle validation error (e.g., log, alert, retry with corrected input)
  }
}
```

## HTTP MCP Servers

Connect to HTTP-based MCP servers:

```typescript
const apiPlugin = definePlugin({
  name: "api",
  mcpServer: {
    type: "http",
    url: "https://api.example.com/mcp",
    headers: {
      Authorization: "Bearer ${API_TOKEN}",
      "X-Custom-Header": "value",
    },
  },
});
```

## Stdio MCP Servers

Connect to stdio-based MCP servers (local processes):

```typescript
const filesystemPlugin = definePlugin({
  name: "filesystem",
  mcpServer: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
    env: {
      NODE_ENV: "production",
    },
  },
});
```

## MCP Manager

For advanced control over MCP connections:

```typescript
import { MCPManager } from "@lleverage-ai/agent-sdk";

const mcpManager = new MCPManager();

// Connect servers
await mcpManager.connectServer({
  name: "filesystem",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/project"],
});

// List available tools
const tools = mcpManager.listTools();

// Disconnect
await mcpManager.disconnect("filesystem");

// Use with agent
const agent = createAgent({
  model,
  mcpManager,
  mcpEagerLoad: true, // Load all MCP tools at startup
});
```

## Connection Monitoring

Monitor MCP server connectivity with hooks:

```typescript
const agent = createAgent({
  model,
  plugins: [githubPlugin],
  hooks: {
    MCPConnectionFailed: [
      async ({ server_name, config, error, session_id }) => {
        console.error(`MCP server ${server_name} failed:`, error.message);
        // Send alert, log to monitoring system, etc.
      },
    ],
    MCPConnectionRestored: [
      async ({ server_name, tool_count, session_id }) => {
        console.log(`MCP server ${server_name} restored with ${tool_count} tools`);
        // Clear alerts, update status, etc.
      },
    ],
  },
});
```

These hooks enable:

- **Observability**: Track MCP server health in logs and metrics
- **Alerting**: Send notifications when servers fail or recover
- **Graceful degradation**: Disable features that depend on unavailable servers
- **Debugging**: Understand connectivity issues in production
