/**
 * Tests for createTeamPlugin factory.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createTeamPlugin } from "../src/plugin.js";
import { readTeamConfig, getTeamPaths } from "../src/team-config.js";
import { FileTransport } from "../src/transport/file-transport.js";
import type { TeamAgentConfig } from "../src/types.js";

const TEAM_NAME = "test-team";
const LEAD_ID = "lead";
const WORKER_ID = "worker-1";

const agents: TeamAgentConfig[] = [
  { agentId: LEAD_ID, role: "lead", name: "Lead" },
  { agentId: WORKER_ID, role: "teammate", name: "Worker", entryScript: "./worker.ts" },
];

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "team-plugin-test-"));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("createTeamPlugin", () => {
  describe("lead role", () => {
    it("returns a valid AgentPlugin with correct name", () => {
      const plugin = createTeamPlugin({
        teamName: TEAM_NAME,
        baseDir,
        agents,
        agentId: LEAD_ID,
        role: "lead",
      });

      expect(plugin.name).toBe("agent-teams");
      expect(plugin.description).toContain("lead");
      expect(plugin.description).toContain(LEAD_ID);
      expect(plugin.description).toContain(TEAM_NAME);
    });

    it("provides lead management tools + task + message tools", () => {
      const plugin = createTeamPlugin({
        teamName: TEAM_NAME,
        baseDir,
        agents,
        agentId: LEAD_ID,
        role: "lead",
      });

      const tools = plugin.tools as Record<string, unknown>;
      // Lead-only tools
      expect(tools).toHaveProperty("team_create_tasks");
      expect(tools).toHaveProperty("team_shutdown_teammate");
      expect(tools).toHaveProperty("team_shutdown_all");
      expect(tools).toHaveProperty("team_approve_plan");
      expect(tools).toHaveProperty("team_reject_plan");
      expect(tools).toHaveProperty("team_check_status");
      // Shared tools
      expect(tools).toHaveProperty("team_list_tasks");
      expect(tools).toHaveProperty("team_claim_task");
      expect(tools).toHaveProperty("team_complete_task");
      expect(tools).toHaveProperty("team_fail_task");
      expect(tools).toHaveProperty("team_send_message");
      expect(tools).toHaveProperty("team_broadcast_message");
      expect(tools).toHaveProperty("team_read_messages");
    });

    it("provides skills", () => {
      const plugin = createTeamPlugin({
        teamName: TEAM_NAME,
        baseDir,
        agents,
        agentId: LEAD_ID,
        role: "lead",
      });

      expect(plugin.skills).toBeDefined();
      expect(plugin.skills).toHaveLength(1);
      expect(plugin.skills![0]!.name).toBe("team-coordination");
      expect(plugin.skills![0]!.description).toContain("lead");
    });

    it("setup initializes coordination directory", async () => {
      const plugin = createTeamPlugin({
        teamName: TEAM_NAME,
        baseDir,
        agents,
        agentId: LEAD_ID,
        role: "lead",
      });

      await plugin.setup!({} as Parameters<NonNullable<typeof plugin.setup>>[0]);

      // Config file should be written
      const paths = getTeamPaths(baseDir, TEAM_NAME);
      const transport = new FileTransport({ lockDir: paths.locksDir });
      const config = await readTeamConfig(transport, baseDir, TEAM_NAME);
      expect(config).toBeDefined();
      expect(config!.teamName).toBe(TEAM_NAME);
      expect(config!.agents).toHaveLength(2);
    });
  });

  describe("teammate role", () => {
    it("provides only task + message tools (no lead tools)", () => {
      const plugin = createTeamPlugin({
        teamName: TEAM_NAME,
        baseDir,
        agents,
        agentId: WORKER_ID,
        role: "teammate",
      });

      const tools = plugin.tools as Record<string, unknown>;
      // Should NOT have lead-only tools
      expect(tools).not.toHaveProperty("team_create_tasks");
      expect(tools).not.toHaveProperty("team_shutdown_teammate");
      expect(tools).not.toHaveProperty("team_shutdown_all");
      expect(tools).not.toHaveProperty("team_approve_plan");
      expect(tools).not.toHaveProperty("team_reject_plan");
      expect(tools).not.toHaveProperty("team_check_status");
      // Should have shared tools
      expect(tools).toHaveProperty("team_list_tasks");
      expect(tools).toHaveProperty("team_claim_task");
      expect(tools).toHaveProperty("team_complete_task");
      expect(tools).toHaveProperty("team_fail_task");
      expect(tools).toHaveProperty("team_send_message");
      expect(tools).toHaveProperty("team_broadcast_message");
      expect(tools).toHaveProperty("team_read_messages");
    });

    it("provides teammate-oriented skills", () => {
      const plugin = createTeamPlugin({
        teamName: TEAM_NAME,
        baseDir,
        agents,
        agentId: WORKER_ID,
        role: "teammate",
      });

      expect(plugin.skills).toBeDefined();
      expect(plugin.skills![0]!.description).toContain("teammate");
    });
  });

  describe("hooks integration", () => {
    it("returns hooks when hookCallbacks are provided", () => {
      const onTaskCreated = async () => undefined;

      const plugin = createTeamPlugin({
        teamName: TEAM_NAME,
        baseDir,
        agents,
        agentId: LEAD_ID,
        role: "lead",
        hookCallbacks: {
          onTaskCreated,
        },
      });

      expect(plugin.hooks).toBeDefined();
      expect(plugin.hooks!.TeamTaskCreated).toBeDefined();
      expect(plugin.hooks!.TeamTaskCreated).toHaveLength(1);
    });

    it("returns undefined hooks when no hookCallbacks", () => {
      const plugin = createTeamPlugin({
        teamName: TEAM_NAME,
        baseDir,
        agents,
        agentId: LEAD_ID,
        role: "lead",
      });

      expect(plugin.hooks).toBeUndefined();
    });
  });

  describe("tool hooks firing", () => {
    it("fires TeamTaskCreated hook when tasks are created", async () => {
      // First set up the coordination directory
      const leadPlugin = createTeamPlugin({
        teamName: TEAM_NAME,
        baseDir,
        agents,
        agentId: LEAD_ID,
        role: "lead",
      });
      await leadPlugin.setup!({} as Parameters<NonNullable<typeof leadPlugin.setup>>[0]);

      // Now create a plugin with hooks
      const hookCalls: string[] = [];
      const plugin = createTeamPlugin({
        teamName: TEAM_NAME,
        baseDir,
        agents,
        agentId: LEAD_ID,
        role: "lead",
        hookCallbacks: {
          onTaskCreated: async () => {
            hookCalls.push("TaskCreated");
            return undefined;
          },
        },
      });

      const tools = plugin.tools as Record<string, { execute: (params: unknown) => Promise<string> }>;
      await tools.team_create_tasks.execute({
        tasks: [
          { title: "Test task", description: "A test", dependencies: [] },
        ],
      });

      expect(hookCalls).toContain("TaskCreated");
    });

    it("fires TeamTaskCompleted hook when task is completed", async () => {
      const leadPlugin = createTeamPlugin({
        teamName: TEAM_NAME,
        baseDir,
        agents,
        agentId: LEAD_ID,
        role: "lead",
      });
      await leadPlugin.setup!({} as Parameters<NonNullable<typeof leadPlugin.setup>>[0]);

      const hookCalls: string[] = [];
      const plugin = createTeamPlugin({
        teamName: TEAM_NAME,
        baseDir,
        agents,
        agentId: LEAD_ID,
        role: "lead",
        hookCallbacks: {
          onTaskCreated: async () => { hookCalls.push("TaskCreated"); return undefined; },
          onTaskAssigned: async () => { hookCalls.push("TaskAssigned"); return undefined; },
          onTaskCompleted: async () => { hookCalls.push("TaskCompleted"); return undefined; },
        },
      });

      const tools = plugin.tools as Record<string, { execute: (params: unknown) => Promise<string> }>;

      // Create a task
      await tools.team_create_tasks.execute({
        tasks: [{ title: "Complete me", description: "Test", dependencies: [] }],
      });

      // Claim it
      await tools.team_claim_task.execute({});

      // Complete it
      const listResult = await tools.team_list_tasks.execute({ status: "claimed" });
      const taskId = listResult.match(/\[([^\]]+)\]/)?.[1];
      if (taskId) {
        // We need the full task ID, let's get it by listing
        const paths = getTeamPaths(baseDir, TEAM_NAME);
        const transport = new FileTransport({ lockDir: paths.locksDir });
        const { createSharedTaskQueue } = await import("../src/task-queue/shared-task-queue.js");
        const queue = createSharedTaskQueue(transport, paths.tasks);
        const tasks = await queue.list();
        const claimed = tasks.find((t) => t.status === "claimed");
        if (claimed) {
          await tools.team_complete_task.execute({ taskId: claimed.id });
        }
      }

      expect(hookCalls).toContain("TaskCreated");
      expect(hookCalls).toContain("TaskAssigned");
      expect(hookCalls).toContain("TaskCompleted");
    });
  });
});
