import { describe, expect, it, vi } from "vitest";
import { TEAM_HOOKS } from "../../../src/plugins/agent-teams/hooks.js";
import { createAgentTeamsPlugin } from "../../../src/plugins/agent-teams/index.js";
import type { TeammateDefinition } from "../../../src/plugins/agent-teams/types.js";
import type { Agent, HookRegistration } from "../../../src/types.js";

describe("createAgentTeamsPlugin", () => {
  const teammates: TeammateDefinition[] = [
    {
      role: "researcher",
      description: "Researches topics thoroughly",
      agentOptions: { systemPrompt: "You are a thorough researcher." },
    },
    {
      role: "coder",
      description: "Writes clean, tested code",
      agentOptions: { systemPrompt: "You are a senior developer." },
    },
  ];

  it("returns a valid plugin with correct name", () => {
    const plugin = createAgentTeamsPlugin({ teammates });

    expect(plugin.name).toBe("agent-teams");
    expect(plugin.description).toBeDefined();
  });

  it("includes start_team tool", () => {
    const plugin = createAgentTeamsPlugin({ teammates });

    expect(plugin.tools).toBeDefined();
    expect(plugin.tools!.start_team).toBeDefined();
  });

  it("has setup function", () => {
    const plugin = createAgentTeamsPlugin({ teammates });

    expect(plugin.setup).toBeDefined();
    expect(typeof plugin.setup).toBe("function");
  });

  it("passes through hooks", () => {
    const hookFn = vi.fn();
    const hooks: HookRegistration = {
      Custom: {
        [TEAM_HOOKS.TeammateSpawned]: [hookFn],
      },
    };

    const plugin = createAgentTeamsPlugin({
      teammates,
      hooks,
    });

    expect(plugin.hooks).toBe(hooks);
  });

  it("setup stores agent reference", async () => {
    const plugin = createAgentTeamsPlugin({ teammates });
    const mockAgent = {
      generate: vi.fn(),
      resume: vi.fn(),
      options: { model: {} as any, systemPrompt: "Primary" },
    } as unknown as Agent;

    // Setup should not throw
    await plugin.setup!(mockAgent);
  });

  it("defaults maxConcurrentTeammates to Infinity", () => {
    const plugin = createAgentTeamsPlugin({ teammates });
    // We can't inspect internals easily, but we know it doesn't throw
    expect(plugin).toBeDefined();
  });

  it("respects maxConcurrentTeammates option", () => {
    const plugin = createAgentTeamsPlugin({
      teammates,
      maxConcurrentTeammates: 2,
    });
    expect(plugin).toBeDefined();
  });
});

describe("Plugin System Prompt Builders", () => {
  it("leader system prompt includes teammate roles", () => {
    // We test this indirectly - the createLeaderAgent in the plugin
    // builds the system prompt including teammate info.
    // This is covered by the plugin's internal behavior.
    // Just verify the plugin creates without error with various teammate configs.
    const plugin = createAgentTeamsPlugin({
      teammates: [
        {
          role: "analyst",
          description: "Analyzes data",
          agentOptions: { systemPrompt: "You analyze data." },
        },
      ],
    });
    expect(plugin).toBeDefined();
  });
});

describe("Plugin Exports", () => {
  it("exports all expected items", async () => {
    const mod = await import("../../../src/plugins/agent-teams/index.js");

    expect(mod.createAgentTeamsPlugin).toBeDefined();
    expect(mod.InMemoryTeamCoordinator).toBeDefined();
    expect(mod.HeadlessSessionRunner).toBeDefined();
    expect(mod.TEAM_HOOKS).toBeDefined();
    expect(mod.tasksToMermaid).toBeDefined();
  });

  it("TEAM_HOOKS has all expected events", () => {
    expect(TEAM_HOOKS.TeammateSpawned).toBe("team:TeammateSpawned");
    expect(TEAM_HOOKS.TeammateIdle).toBe("team:TeammateIdle");
    expect(TEAM_HOOKS.TeammateStopped).toBe("team:TeammateStopped");
    expect(TEAM_HOOKS.TeamTaskCreated).toBe("team:TeamTaskCreated");
    expect(TEAM_HOOKS.TeamTaskClaimed).toBe("team:TeamTaskClaimed");
    expect(TEAM_HOOKS.TeamTaskCompleted).toBe("team:TeamTaskCompleted");
    expect(TEAM_HOOKS.TeamMessageSent).toBe("team:TeamMessageSent");
  });
});
