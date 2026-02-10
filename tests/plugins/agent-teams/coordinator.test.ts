import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryTeamCoordinator } from "../../../src/plugins/agent-teams/coordinator.js";
import type { TeammateInfo } from "../../../src/plugins/agent-teams/types.js";

describe("InMemoryTeamCoordinator", () => {
  let coordinator: InMemoryTeamCoordinator;

  beforeEach(() => {
    coordinator = new InMemoryTeamCoordinator();
  });

  afterEach(() => {
    coordinator.dispose();
  });

  // ===========================================================================
  // Teammate Management
  // ===========================================================================

  describe("teammate management", () => {
    const teammate: TeammateInfo = {
      id: "tm-1",
      role: "researcher",
      description: "Researches topics",
      status: "idle",
      spawnedAt: new Date().toISOString(),
    };

    it("registers and retrieves a teammate", () => {
      coordinator.registerTeammate(teammate);
      const result = coordinator.getTeammate("tm-1");
      expect(result).toMatchObject({ id: "tm-1", role: "researcher" });
    });

    it("returns undefined for unknown teammate", () => {
      expect(coordinator.getTeammate("nonexistent")).toBeUndefined();
    });

    it("lists all teammates", () => {
      coordinator.registerTeammate(teammate);
      coordinator.registerTeammate({
        ...teammate,
        id: "tm-2",
        role: "coder",
      });
      const list = coordinator.listTeammates();
      expect(list).toHaveLength(2);
    });

    it("removes a teammate", () => {
      coordinator.registerTeammate(teammate);
      coordinator.removeTeammate("tm-1");
      expect(coordinator.getTeammate("tm-1")).toBeUndefined();
    });

    it("updates teammate status", () => {
      coordinator.registerTeammate(teammate);
      coordinator.updateTeammateStatus("tm-1", "working", "task-1");
      const updated = coordinator.getTeammate("tm-1");
      expect(updated?.status).toBe("working");
      expect(updated?.currentTaskId).toBe("task-1");
    });
  });

  // ===========================================================================
  // Task Management
  // ===========================================================================

  describe("task management", () => {
    it("creates a task with auto-generated ID", () => {
      const task = coordinator.createTask({
        subject: "Research TypeScript",
        description: "Research TypeScript generics",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });

      expect(task.id).toMatch(/^task-/);
      expect(task.subject).toBe("Research TypeScript");
      expect(task.blocks).toEqual([]);
      expect(task.createdAt).toBeTruthy();
    });

    it("retrieves a task by ID", () => {
      const created = coordinator.createTask({
        subject: "Task 1",
        description: "Description",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });

      const retrieved = coordinator.getTask(created.id);
      expect(retrieved?.subject).toBe("Task 1");
    });

    it("returns undefined for unknown task", () => {
      expect(coordinator.getTask("nonexistent")).toBeUndefined();
    });

    it("lists tasks with status filter", () => {
      coordinator.createTask({
        subject: "Pending",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });
      const task2 = coordinator.createTask({
        subject: "In Progress",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });
      coordinator.claimTask(task2.id, "tm-1");

      const pendingTasks = coordinator.listTasks({ status: "pending" });
      expect(pendingTasks).toHaveLength(1);

      const inProgress = coordinator.listTasks({ status: "in_progress" });
      expect(inProgress).toHaveLength(1);
    });

    it("lists tasks with assignee filter", () => {
      const task = coordinator.createTask({
        subject: "Task",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });
      coordinator.claimTask(task.id, "tm-1");

      const assignedTasks = coordinator.listTasks({ assignee: "tm-1" });
      expect(assignedTasks).toHaveLength(1);

      const otherTasks = coordinator.listTasks({ assignee: "tm-2" });
      expect(otherTasks).toHaveLength(0);
    });

    it("claims a pending unblocked task", () => {
      const task = coordinator.createTask({
        subject: "Task",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });

      const claimed = coordinator.claimTask(task.id, "tm-1");
      expect(claimed).toBe(true);

      const updated = coordinator.getTask(task.id);
      expect(updated?.assignee).toBe("tm-1");
      expect(updated?.status).toBe("in_progress");
    });

    it("prevents double-claiming a task", () => {
      const task = coordinator.createTask({
        subject: "Task",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });

      coordinator.claimTask(task.id, "tm-1");
      const secondClaim = coordinator.claimTask(task.id, "tm-2");
      expect(secondClaim).toBe(false);
    });

    it("prevents claiming a blocked task", () => {
      const task1 = coordinator.createTask({
        subject: "Prerequisite",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });

      const task2 = coordinator.createTask({
        subject: "Dependent",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [task1.id],
      });

      const claimed = coordinator.claimTask(task2.id, "tm-1");
      expect(claimed).toBe(false);
      expect(coordinator.isTaskBlocked(task2.id)).toBe(true);
    });

    it("unblocks dependent tasks when prerequisite completes", () => {
      const task1 = coordinator.createTask({
        subject: "Prerequisite",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });

      const task2 = coordinator.createTask({
        subject: "Dependent",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [task1.id],
      });

      // Claim and complete prerequisite
      coordinator.claimTask(task1.id, "tm-1");
      coordinator.completeTask(task1.id, "Done");

      // Dependent should now be unblocked
      expect(coordinator.isTaskBlocked(task2.id)).toBe(false);
      const claimed = coordinator.claimTask(task2.id, "tm-2");
      expect(claimed).toBe(true);
    });

    it("completes a task with result", () => {
      const task = coordinator.createTask({
        subject: "Task",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });
      coordinator.claimTask(task.id, "tm-1");

      const completed = coordinator.completeTask(task.id, "Result data");
      expect(completed).toBe(true);

      const updated = coordinator.getTask(task.id);
      expect(updated?.status).toBe("completed");
      expect(updated?.result).toBe("Result data");
    });

    it("prevents completing an already completed task", () => {
      const task = coordinator.createTask({
        subject: "Task",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });
      coordinator.claimTask(task.id, "tm-1");
      coordinator.completeTask(task.id);

      const secondComplete = coordinator.completeTask(task.id, "More");
      expect(secondComplete).toBe(false);
    });

    it("updates task properties", () => {
      const task = coordinator.createTask({
        subject: "Original",
        description: "Original desc",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });

      coordinator.updateTask(task.id, { subject: "Updated" });
      const updated = coordinator.getTask(task.id);
      expect(updated?.subject).toBe("Updated");
    });

    it("manages reverse dependencies (blocks)", () => {
      const task1 = coordinator.createTask({
        subject: "Task 1",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });

      coordinator.createTask({
        subject: "Task 2",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [task1.id],
      });

      const t1 = coordinator.getTask(task1.id);
      expect(t1?.blocks).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Messaging
  // ===========================================================================

  describe("messaging", () => {
    it("sends and receives a direct message", () => {
      const msg = coordinator.sendMessage({
        from: "lead",
        to: "tm-1",
        content: "Hello teammate",
      });

      expect(msg.id).toMatch(/^msg-/);
      expect(msg.read).toBe(false);

      const messages = coordinator.getMessages("tm-1");
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Hello teammate");
    });

    it("sends broadcast messages", () => {
      coordinator.sendMessage({
        from: "lead",
        to: null,
        content: "Team update",
      });

      const tm1Messages = coordinator.getMessages("tm-1");
      expect(tm1Messages).toHaveLength(1);

      const tm2Messages = coordinator.getMessages("tm-2");
      expect(tm2Messages).toHaveLength(1);
    });

    it("does not receive own messages", () => {
      coordinator.sendMessage({
        from: "lead",
        to: null,
        content: "Broadcast",
      });

      const leadMessages = coordinator.getMessages("lead");
      expect(leadMessages).toHaveLength(0);
    });

    it("filters unread messages only", () => {
      const msg = coordinator.sendMessage({
        from: "lead",
        to: "tm-1",
        content: "Read me",
      });

      coordinator.markRead(msg.id);

      const unread = coordinator.getMessages("tm-1", true);
      expect(unread).toHaveLength(0);

      const all = coordinator.getMessages("tm-1", false);
      expect(all).toHaveLength(1);
    });

    it("marks messages as read", () => {
      const msg = coordinator.sendMessage({
        from: "lead",
        to: "tm-1",
        content: "Test",
      });

      coordinator.markRead(msg.id);

      const messages = coordinator.getMessages("tm-1");
      expect(messages[0].read).toBe(true);
    });
  });

  // ===========================================================================
  // waitForMessage
  // ===========================================================================

  describe("waitForMessage", () => {
    it("resolves immediately if unread messages exist", async () => {
      coordinator.sendMessage({
        from: "lead",
        to: "tm-1",
        content: "Existing message",
      });

      const messages = await coordinator.waitForMessage("tm-1", 1000);
      expect(messages).toHaveLength(1);
      expect(messages![0].content).toBe("Existing message");
    });

    it("resolves when a message arrives", async () => {
      const promise = coordinator.waitForMessage("tm-1", 5000);

      // Send message after a short delay
      setTimeout(() => {
        coordinator.sendMessage({
          from: "lead",
          to: "tm-1",
          content: "Delayed message",
        });
      }, 50);

      const messages = await promise;
      expect(messages).toHaveLength(1);
      expect(messages![0].content).toBe("Delayed message");
    });

    it("resolves with null on timeout", async () => {
      const messages = await coordinator.waitForMessage("tm-1", 100);
      expect(messages).toBeNull();
    });

    it("cancels existing waiter when called twice for the same agent", async () => {
      // First wait — will be cancelled by the second call
      const firstPromise = coordinator.waitForMessage("tm-1", 60000);

      // Second wait — should cancel the first
      const secondPromise = coordinator.waitForMessage("tm-1", 60000);

      // First should resolve with empty array (cancelled)
      const firstResult = await firstPromise;
      expect(firstResult).toEqual([]);

      // Send a message — should resolve the second waiter
      setTimeout(() => {
        coordinator.sendMessage({
          from: "lead",
          to: "tm-1",
          content: "After double wait",
        });
      }, 50);

      const secondResult = await secondPromise;
      expect(secondResult).not.toBeNull();
      expect(secondResult![0].content).toBe("After double wait");
    });

    it("resolves when broadcast arrives", async () => {
      const promise = coordinator.waitForMessage("tm-1", 5000);

      setTimeout(() => {
        coordinator.sendMessage({
          from: "lead",
          to: null,
          content: "Broadcast",
        });
      }, 50);

      const messages = await promise;
      expect(messages).not.toBeNull();
      expect(messages![0].content).toBe("Broadcast");
    });
  });

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe("lifecycle", () => {
    it("cleans up on dispose", () => {
      coordinator.registerTeammate({
        id: "tm-1",
        role: "test",
        description: "Test",
        status: "idle",
        spawnedAt: new Date().toISOString(),
      });
      coordinator.createTask({
        subject: "Task",
        description: "",
        status: "pending",
        createdBy: "lead",
        blockedBy: [],
      });

      coordinator.dispose();

      expect(coordinator.listTeammates()).toHaveLength(0);
      expect(coordinator.listTasks()).toHaveLength(0);
    });

    it("cleans up waiters on dispose", async () => {
      const promise = coordinator.waitForMessage("tm-1", 60000);
      coordinator.dispose();

      const result = await promise;
      expect(result).toEqual([]);
    });

    it("cleans up waiters on removeTeammate", async () => {
      const promise = coordinator.waitForMessage("tm-1", 60000);
      coordinator.removeTeammate("tm-1");

      const result = await promise;
      expect(result).toEqual([]);
    });
  });
});
