import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSubagentDefinitionsFromFilesystemAgents,
  loadPluginFromDirectory,
  loadPluginsFromDirectories,
} from "../src/plugins/loader.js";

const TEST_DIR = join(tmpdir(), "agent-sdk-plugins-loader-tests");

describe("Filesystem Plugin Loader", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  it("loads plugin package with skills, MCP servers, and agent files", async () => {
    const pluginDir = join(TEST_DIR, "acme", "devops");
    await mkdir(pluginDir, { recursive: true });

    await writeFile(
      join(pluginDir, "plugin.json"),
      JSON.stringify(
        {
          name: "devops",
          description: "DevOps toolkit",
          deferred: true,
        },
        null,
        2,
      ),
    );

    await mkdir(join(pluginDir, "skills", "deploy-check"), { recursive: true });
    await writeFile(
      join(pluginDir, "skills", "deploy-check", "SKILL.md"),
      `---
name: deploy-check
description: Deployment safety checks
---

Run deployment preflight checks before release.
`,
    );

    await writeFile(
      join(pluginDir, "mcp.json"),
      JSON.stringify(
        {
          servers: {
            github: {
              type: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-github"],
            },
          },
        },
        null,
        2,
      ),
    );

    await mkdir(join(pluginDir, "agents"), { recursive: true });
    await writeFile(
      join(pluginDir, "agents", "reviewer.md"),
      `---
description: Release review specialist
plugins:
  - self
  - self:mcp
allowedTools:
  - read
  - glob
---

Review release readiness and deployment risk.
`,
    );

    const loaded = await loadPluginsFromDirectories([TEST_DIR]);

    expect(loaded.errors).toEqual([]);
    expect(loaded.plugins.map((p) => p.name)).toEqual(["devops", "devops__github"]);

    const basePlugin = loaded.plugins.find((p) => p.name === "devops");
    expect(basePlugin).toBeDefined();
    expect(basePlugin?.deferred).toBe(true);
    expect(basePlugin?.skills?.map((s) => s.name)).toEqual(["deploy-check"]);

    expect(loaded.agents).toHaveLength(1);
    expect(loaded.agents[0]?.type).toBe("plugin:devops:reviewer");
    expect(loaded.agents[0]?.plugins?.map((p) => p.name)).toEqual(["devops", "devops__github"]);
    expect(loaded.subagents).toEqual([]);
  });

  it("ignores plugin.js entrypoint unless allowCodeEntrypoint is true", async () => {
    const pluginDir = join(TEST_DIR, "tooling");
    await mkdir(pluginDir, { recursive: true });

    await writeFile(
      join(pluginDir, "plugin.json"),
      JSON.stringify(
        {
          name: "tooling",
          description: "Tooling plugin",
        },
        null,
        2,
      ),
    );

    await writeFile(
      join(pluginDir, "plugin.js"),
      `import { tool } from "ai";
import { z } from "zod";

export default {
  tools: {
    ping: tool({
      description: "Ping",
      inputSchema: z.object({}),
      execute: async () => "pong",
    }),
  },
  mcpServers: {
    docs: {
      type: "http",
      url: "https://example.com/mcp",
    },
  },
};
`,
    );

    const withoutCode = await loadPluginFromDirectory(pluginDir);
    expect(withoutCode.errors).toEqual([]);
    expect(withoutCode.plugins.map((p) => p.name)).toEqual(["tooling"]);
    expect(withoutCode.plugins[0]?.tools).toBeUndefined();

    const withCode = await loadPluginFromDirectory(pluginDir, { allowCodeEntrypoint: true });
    expect(withCode.errors).toEqual([]);
    expect(withCode.plugins.map((p) => p.name)).toEqual(["tooling", "tooling__docs"]);
    expect(withCode.plugins[0]?.tools).toBeDefined();
  });

  it("uses resolveModel for agent model identifiers", async () => {
    const pluginDir = join(TEST_DIR, "models");
    await mkdir(join(pluginDir, "agents"), { recursive: true });

    await writeFile(
      join(pluginDir, "plugin.json"),
      JSON.stringify(
        {
          name: "models",
        },
        null,
        2,
      ),
    );

    await writeFile(
      join(pluginDir, "agents", "analyzer.md"),
      `---
description: Model-aware analyzer
model: fast-model
---

Analyze quickly.
`,
    );

    const missingResolver = await loadPluginFromDirectory(pluginDir);
    expect(missingResolver.agents).toHaveLength(0);
    expect(missingResolver.errors[0]?.error).toContain("resolveModel");

    const resolved = await loadPluginFromDirectory(pluginDir, {
      resolveModel: () => ({}) as never,
    });
    expect(resolved.errors).toEqual([]);
    expect(resolved.agents).toHaveLength(1);
    expect(resolved.agents[0]?.type).toBe("plugin:models:analyzer");
  });

  it("materializes subagent definitions from loaded agents", async () => {
    const pluginDir = join(TEST_DIR, "agents-plugin");
    await mkdir(join(pluginDir, "agents"), { recursive: true });

    await writeFile(
      join(pluginDir, "plugin.json"),
      JSON.stringify(
        {
          name: "agents-plugin",
        },
        null,
        2,
      ),
    );

    await writeFile(
      join(pluginDir, "agents", "reviewer.md"),
      `---
description: Reviewer
---

Review carefully.
`,
    );

    const loaded = await loadPluginFromDirectory(pluginDir);
    const subagents = createSubagentDefinitionsFromFilesystemAgents({
      agents: loaded.agents,
      getParentAgent: () => undefined,
    });

    expect(subagents).toHaveLength(1);
    expect(subagents[0]?.type).toBe("plugin:agents-plugin:reviewer");
    expect(subagents[0]?.description).toBe("Reviewer");
  });
});
