# Filesystem Plugins

Load full plugin packages from disk, similar to Claude Code-style local plugin folders.

## Directory Layout

A plugin package is a directory containing a `plugin.json` manifest.

```text
plugins/
  <namespace>/
    <plugin-id>/
      plugin.json
      mcp.json            # optional
      plugin.js           # optional, code entrypoint
      skills/             # optional
        <skill-name>/
          SKILL.md
      agents/             # optional
        <agent-name>.md
```

`loadPluginsFromDirectories()` discovers plugin directories one or two levels deep:
- `./plugins/my-plugin/plugin.json`
- `./plugins/acme/my-plugin/plugin.json`

## `plugin.json` (required)

```json
{
  "name": "github",
  "description": "GitHub workflows",
  "deferred": true,
  "entrypoint": "./plugin.js",
  "skillsDir": "skills",
  "agentsDir": "agents"
}
```

Fields:
- `name` (required): plugin ID used for tool namespacing (`mcp__<name>__<tool>`)
- `description` (optional): human-readable description
- `deferred` (optional): maps to `AgentPlugin.deferred`
- `entrypoint` (optional): path to plugin code module (default: `./plugin.js`)
- `skillsDir` (optional): skills directory (default: `skills`)
- `agentsDir` (optional): agents directory (default: `agents`)

## `mcp.json` (optional)

```json
{
  "servers": {
    "github-api": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

Each entry in `servers` is converted into an `AgentPlugin` with:
- `name`: `<plugin-name>__<server-name>`
- `mcpServer`: that server config

This allows multiple MCP servers per filesystem plugin package while keeping the existing `AgentPlugin` shape.

## `plugin.js` (optional)

If `allowCodeEntrypoint: true` is passed to the loader, the entrypoint module is imported.

Supported exports:
- `default` object and/or named `plugin` object
- optional fields: `tools`, `skills`, `hooks`, `setup`, `deferred`, `subagent`, `mcpServer`, `mcpServers`

`mcpServers` is a map of server name to MCP server config; each is converted into `<plugin-name>__<server-name>` plugin entries.

## `agents/*.md` format

Each file in `agentsDir` must use YAML frontmatter.

```markdown
---
name: reviewer
description: Code review specialist
model: inherit
allowedTools:
  - read
  - glob
  - grep
plugins:
  - self
  - self:mcp
streaming: false
---

You are a strict code reviewer. Focus on correctness and regressions.
```

Frontmatter fields:
- `name` (optional): subagent type suffix (default: filename)
- `description` (required): subagent description
- `model` (optional): `inherit` or an identifier resolved via `resolveModel()`
- `allowedTools` (optional): array of allowed tool names
- `plugins` (optional): list of plugin refs:
  - `self` => main plugin entry
  - `self:mcp` => all MCP plugin entries generated from this package
  - explicit plugin name
- `streaming` (optional): boolean

Markdown body becomes the subagent system prompt.

## API

```typescript
const loaded = await loadPluginsFromDirectories(["./plugins"], {
  allowCodeEntrypoint: true,
  includeHidden: false,
  resolveModel: (id) => (id === "haiku" ? anthropic("claude-haiku-4.5") : undefined),
  getParentAgent: () => agent,
});

// loaded.plugins -> AgentPlugin[]
// loaded.agents -> parsed filesystem agent definitions
// loaded.subagents -> SubagentDefinition[] (when getParentAgent is provided)
// loaded.errors -> non-fatal load errors
```

If you do not pass `getParentAgent`, create subagent definitions later:

```typescript
const subagents = createSubagentDefinitionsFromFilesystemAgents({
  agents: loaded.agents,
  getParentAgent: () => agent,
});
```

## Security Defaults

- Code entrypoints are disabled by default (`allowCodeEntrypoint: false`).
- Manifest/MCP/agent parse errors are non-fatal and reported in `errors`.
- Skills follow the existing file-based skill validation rules.
