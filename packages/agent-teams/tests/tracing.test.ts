/**
 * Tests for team tracing (spans, semantic attributes, memory exporter).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createTracer,
  createMemorySpanExporter,
} from "@lleverage-ai/agent-sdk";

import { createTeamPlugin } from "../src/plugin.js";
import { createTeamTaskTool } from "../src/tools/team-task-tool.js";
import { createTeamMessageTool } from "../src/tools/team-message-tool.js";
import { createTeammateTool } from "../src/tools/teammate-tool.js";
import { FileTransport } from "../src/transport/file-transport.js";
import { createMailbox } from "../src/mailbox/mailbox.js";
import { createSharedTaskQueue } from "../src/task-queue/shared-task-queue.js";
import { getTeamPaths } from "../src/team-config.js";
import { TeamSemanticAttributes } from "../src/observability/semantic-attributes.js";
import type { TeamAgentConfig } from "../src/types.js";

const TEAM_NAME = "trace-test";
const LEAD_ID = "lead";
const WORKER_ID = "worker-1";

const agents: TeamAgentConfig[] = [
  { agentId: LEAD_ID, role: "lead", name: "Lead" },
  { agentId: WORKER_ID, role: "teammate", name: "Worker", entryScript: "./worker.ts" },
];

let baseDir: string;
let paths: ReturnType<typeof getTeamPaths>;
let transport: FileTransport;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "team-tracing-test-"));
  paths = getTeamPaths(baseDir, TEAM_NAME);
  transport = new FileTransport({ lockDir: paths.locksDir });
  await transport.ensureDir(paths.teamDir);
  await transport.ensureDir(paths.messagesDir);
  await transport.ensureDir(paths.stateDir);
  await transport.ensureDir(paths.plansDir);
  await transport.ensureDir(paths.locksDir);
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("TeamSemanticAttributes", () => {
  it("exports all expected attribute keys", () => {
    expect(TeamSemanticAttributes.TEAM_NAME).toBe("team.name");
    expect(TeamSemanticAttributes.TEAM_SESSION_ID).toBe("team.session_id");
    expect(TeamSemanticAttributes.TEAM_AGENT_ID).toBe("team.agent_id");
    expect(TeamSemanticAttributes.TEAM_AGENT_ROLE).toBe("team.agent_role");
    expect(TeamSemanticAttributes.TEAM_TASK_ID).toBe("team.task_id");
    expect(TeamSemanticAttributes.TEAM_TASK_TITLE).toBe("team.task_title");
    expect(TeamSemanticAttributes.TEAM_TASK_STATUS).toBe("team.task_status");
    expect(TeamSemanticAttributes.TEAM_TASK_COUNT).toBe("team.task_count");
    expect(TeamSemanticAttributes.TEAM_MESSAGE_TYPE).toBe("team.message_type");
    expect(TeamSemanticAttributes.TEAM_MESSAGE_FROM).toBe("team.message_from");
    expect(TeamSemanticAttributes.TEAM_MESSAGE_TO).toBe("team.message_to");
    expect(TeamSemanticAttributes.TEAM_PLAN_ID).toBe("team.plan_id");
  });
});

describe("tool tracing", () => {
  it("creates spans for team_create_tasks", async () => {
    const exporter = createMemorySpanExporter();
    const tracer = createTracer({ name: "test", exporters: [exporter] });

    const taskQueue = createSharedTaskQueue(transport, paths.tasks);
    const mailbox = createMailbox(transport, paths.messagesDir);

    const tools = createTeammateTool({
      agentId: LEAD_ID,
      mailbox,
      taskQueue,
      transport,
      plansDir: paths.plansDir,
      teammateIds: [WORKER_ID],
      tracer,
    });

    await tools.team_create_tasks.execute({
      tasks: [
        { title: "Task 1", description: "First task", dependencies: [] },
        { title: "Task 2", description: "Second task", dependencies: [] },
      ],
    });

    await tracer.flush();

    expect(exporter.spans.length).toBeGreaterThanOrEqual(1);
    const createSpan = exporter.spans.find((s) => s.name === "team.create_tasks");
    expect(createSpan).toBeDefined();
    expect(createSpan!.attributes[TeamSemanticAttributes.TEAM_TASK_COUNT]).toBe(2);
    expect(createSpan!.attributes[TeamSemanticAttributes.TEAM_AGENT_ID]).toBe(LEAD_ID);
  });

  it("creates spans for team_claim_task", async () => {
    const exporter = createMemorySpanExporter();
    const tracer = createTracer({ name: "test", exporters: [exporter] });

    const taskQueue = createSharedTaskQueue(transport, paths.tasks);
    await taskQueue.create({ title: "Claimable", description: "Test", dependencies: [] });

    const tools = createTeamTaskTool({
      agentId: WORKER_ID,
      taskQueue,
      tracer,
    });

    await tools.team_claim_task.execute({});
    await tracer.flush();

    const claimSpan = exporter.spans.find((s) => s.name === "team.task_lifecycle");
    expect(claimSpan).toBeDefined();
    expect(claimSpan!.attributes[TeamSemanticAttributes.TEAM_AGENT_ID]).toBe(WORKER_ID);
  });

  it("creates spans for team_complete_task", async () => {
    const exporter = createMemorySpanExporter();
    const tracer = createTracer({ name: "test", exporters: [exporter] });

    const taskQueue = createSharedTaskQueue(transport, paths.tasks);
    const task = await taskQueue.create({ title: "Complete me", description: "Test", dependencies: [] });
    await taskQueue.claim(task.id, WORKER_ID);

    const tools = createTeamTaskTool({
      agentId: WORKER_ID,
      taskQueue,
      tracer,
    });

    await tools.team_complete_task.execute({ taskId: task.id, result: "Done" });
    await tracer.flush();

    const completeSpan = exporter.spans.find(
      (s) => s.name === "team.task_lifecycle" && s.attributes[TeamSemanticAttributes.TEAM_TASK_STATUS] === "completed",
    );
    expect(completeSpan).toBeDefined();
    expect(completeSpan!.attributes[TeamSemanticAttributes.TEAM_TASK_ID]).toBe(task.id);
  });

  it("creates spans for team_fail_task", async () => {
    const exporter = createMemorySpanExporter();
    const tracer = createTracer({ name: "test", exporters: [exporter] });

    const taskQueue = createSharedTaskQueue(transport, paths.tasks);
    const task = await taskQueue.create({ title: "Fail me", description: "Test", dependencies: [] });
    await taskQueue.claim(task.id, WORKER_ID);

    const tools = createTeamTaskTool({
      agentId: WORKER_ID,
      taskQueue,
      tracer,
    });

    await tools.team_fail_task.execute({ taskId: task.id, error: "Something broke" });
    await tracer.flush();

    const failSpan = exporter.spans.find(
      (s) => s.name === "team.task_lifecycle" && s.attributes[TeamSemanticAttributes.TEAM_TASK_STATUS] === "failed",
    );
    expect(failSpan).toBeDefined();
  });

  it("creates spans for team_send_message", async () => {
    const exporter = createMemorySpanExporter();
    const tracer = createTracer({ name: "test", exporters: [exporter] });

    const mailbox = createMailbox(transport, paths.messagesDir);
    const tools = createTeamMessageTool({
      agentId: LEAD_ID,
      mailbox,
      tracer,
    });

    await tools.team_send_message.execute({
      to: WORKER_ID,
      content: "Hello worker",
    });
    await tracer.flush();

    const msgSpan = exporter.spans.find((s) => s.name === "team.message");
    expect(msgSpan).toBeDefined();
    expect(msgSpan!.attributes[TeamSemanticAttributes.TEAM_MESSAGE_FROM]).toBe(LEAD_ID);
    expect(msgSpan!.attributes[TeamSemanticAttributes.TEAM_MESSAGE_TO]).toBe(WORKER_ID);
    expect(msgSpan!.attributes[TeamSemanticAttributes.TEAM_MESSAGE_TYPE]).toBe("text");
  });

  it("creates spans for team_broadcast_message", async () => {
    const exporter = createMemorySpanExporter();
    const tracer = createTracer({ name: "test", exporters: [exporter] });

    const mailbox = createMailbox(transport, paths.messagesDir);
    const tools = createTeamMessageTool({
      agentId: LEAD_ID,
      mailbox,
      tracer,
    });

    await tools.team_broadcast_message.execute({ content: "Announcement" });
    await tracer.flush();

    const broadcastSpan = exporter.spans.find((s) => s.name === "team.message");
    expect(broadcastSpan).toBeDefined();
    expect(broadcastSpan!.attributes[TeamSemanticAttributes.TEAM_MESSAGE_TO]).toBe("__broadcast__");
  });

  it("creates spans for team_shutdown_teammate", async () => {
    const exporter = createMemorySpanExporter();
    const tracer = createTracer({ name: "test", exporters: [exporter] });

    const mailbox = createMailbox(transport, paths.messagesDir);
    const taskQueue = createSharedTaskQueue(transport, paths.tasks);
    const tools = createTeammateTool({
      agentId: LEAD_ID,
      mailbox,
      taskQueue,
      transport,
      plansDir: paths.plansDir,
      teammateIds: [WORKER_ID],
      tracer,
    });

    await tools.team_shutdown_teammate.execute({
      targetAgentId: WORKER_ID,
      reason: "Done",
    });
    await tracer.flush();

    const shutdownSpan = exporter.spans.find((s) => s.name === "team.shutdown");
    expect(shutdownSpan).toBeDefined();
    expect(shutdownSpan!.attributes[TeamSemanticAttributes.TEAM_AGENT_ID]).toBe(WORKER_ID);
  });
});

describe("plugin setup tracing", () => {
  it("creates team.initialize span during setup", async () => {
    const exporter = createMemorySpanExporter();
    const tracer = createTracer({ name: "test", exporters: [exporter] });

    const plugin = createTeamPlugin({
      teamName: TEAM_NAME,
      baseDir,
      agents,
      agentId: LEAD_ID,
      role: "lead",
      tracer,
    });

    await plugin.setup!({} as Parameters<NonNullable<typeof plugin.setup>>[0]);
    await tracer.flush();

    const initSpan = exporter.spans.find((s) => s.name === "team.initialize");
    expect(initSpan).toBeDefined();
    expect(initSpan!.attributes[TeamSemanticAttributes.TEAM_NAME]).toBe(TEAM_NAME);
    expect(initSpan!.attributes[TeamSemanticAttributes.TEAM_AGENT_ID]).toBe(LEAD_ID);
    expect(initSpan!.attributes[TeamSemanticAttributes.TEAM_AGENT_ROLE]).toBe("lead");
  });
});

describe("trace context propagation", () => {
  it("env var keys are defined for trace propagation", () => {
    const { TEAM_ENV_VARS } = require("../src/types.js");
    expect(TEAM_ENV_VARS.TRACE_ID).toBe("AGENT_TEAM_TRACE_ID");
    expect(TEAM_ENV_VARS.PARENT_SPAN_ID).toBe("AGENT_TEAM_PARENT_SPAN_ID");
  });
});
