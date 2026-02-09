import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryTeamCoordinator } from "../../../src/plugins/agent-teams/coordinator.js";
import { tasksToMermaid } from "../../../src/plugins/agent-teams/mermaid.js";

describe("tasksToMermaid", () => {
  let coordinator: InMemoryTeamCoordinator;

  beforeEach(() => {
    coordinator = new InMemoryTeamCoordinator();
  });

  afterEach(() => {
    coordinator.dispose();
  });

  it("returns placeholder for empty task list", () => {
    const result = tasksToMermaid([]);
    expect(result).toBe("graph TD\n  empty[No tasks]");
  });

  it("renders a single task with no dependencies", () => {
    coordinator.createTask({
      subject: "Research TypeScript",
      description: "Research TS generics",
      status: "pending",
      createdBy: "lead",
      blockedBy: [],
    });

    const result = tasksToMermaid(coordinator.listTasks());

    expect(result).toContain("graph TD");
    expect(result).toContain('task-1["Research TypeScript"]');
    expect(result).toContain("class task-1 pending");
    // No edges
    expect(result).not.toContain("-->");
  });

  it("renders a linear chain (A -> B -> C)", () => {
    const a = coordinator.createTask({
      subject: "Task A",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [],
    });
    const b = coordinator.createTask({
      subject: "Task B",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [a.id],
    });
    coordinator.createTask({
      subject: "Task C",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [b.id],
    });

    const result = tasksToMermaid(coordinator.listTasks());

    expect(result).toContain("task-1 --> task-2");
    expect(result).toContain("task-2 --> task-3");
  });

  it("renders a diamond pattern (A -> B,C -> D)", () => {
    const a = coordinator.createTask({
      subject: "Task A",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [],
    });
    const b = coordinator.createTask({
      subject: "Task B",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [a.id],
    });
    const c = coordinator.createTask({
      subject: "Task C",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [a.id],
    });
    coordinator.createTask({
      subject: "Task D",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [b.id, c.id],
    });

    const result = tasksToMermaid(coordinator.listTasks());

    // A -> B, A -> C
    expect(result).toContain("task-1 --> task-2");
    expect(result).toContain("task-1 --> task-3");
    // B -> D, C -> D
    expect(result).toContain("task-2 --> task-4");
    expect(result).toContain("task-3 --> task-4");
  });

  it("applies status styling classes", () => {
    coordinator.createTask({
      subject: "Done",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [],
    });

    const diagram = tasksToMermaid(coordinator.listTasks());

    expect(diagram).toContain("classDef completed fill:#90EE90,stroke:#333");
    expect(diagram).toContain("classDef in_progress fill:#FFD700,stroke:#333");
    expect(diagram).toContain("classDef pending fill:#D3D3D3,stroke:#333");
  });

  it("escapes double quotes in task subjects", () => {
    coordinator.createTask({
      subject: 'Fix "critical" bug',
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [],
    });

    const result = tasksToMermaid(coordinator.listTasks());

    expect(result).toContain("&quot;");
    expect(result).toContain('task-1["Fix &quot;critical&quot; bug"]');
  });

  it("shows correct status icons for mixed statuses", () => {
    const t1 = coordinator.createTask({
      subject: "Completed Task",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [],
    });
    coordinator.claimTask(t1.id, "tm-1");
    coordinator.completeTask(t1.id, "done");

    const t2 = coordinator.createTask({
      subject: "In Progress Task",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [],
    });
    coordinator.claimTask(t2.id, "tm-2");

    coordinator.createTask({
      subject: "Pending Task",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [],
    });

    const result = tasksToMermaid(coordinator.listTasks());

    expect(result).toContain('task-1["Completed Task \u2713"]');
    expect(result).toContain('task-2["In Progress Task \u23F3"]');
    expect(result).toContain('task-3["Pending Task"]');

    expect(result).toContain("class task-1 completed");
    expect(result).toContain("class task-2 in_progress");
    expect(result).toContain("class task-3 pending");
  });

  it("starts with graph TD and uses valid mermaid syntax", () => {
    coordinator.createTask({
      subject: "Task A",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: [],
    });
    coordinator.createTask({
      subject: "Task B",
      description: "",
      status: "pending",
      createdBy: "lead",
      blockedBy: ["task-1"],
    });

    const result = tasksToMermaid(coordinator.listTasks());

    // Starts with graph TD
    expect(result.startsWith("graph TD")).toBe(true);

    // Node IDs are valid (alphanumeric with hyphens)
    const nodePattern = /^\s+([\w-]+)\["/gm;
    const nodes: string[] = [];
    let match = nodePattern.exec(result);
    while (match !== null) {
      nodes.push(match[1]);
      match = nodePattern.exec(result);
    }
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node).toMatch(/^[\w-]+$/);
    }

    // Edges use -->
    const edgePattern = /^\s+([\w-]+) --> ([\w-]+)$/gm;
    const edges: string[] = [];
    match = edgePattern.exec(result);
    while (match !== null) {
      edges.push(`${match[1]} --> ${match[2]}`);
      match = edgePattern.exec(result);
    }
    expect(edges).toContain("task-1 --> task-2");
  });
});
