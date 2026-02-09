/**
 * In-memory implementation of the TeamCoordinator interface.
 *
 * @packageDocumentation
 */

import type {
  TeamCoordinator,
  TeamMessage,
  TeammateInfo,
  TeammateStatus,
  TeamTask,
  TeamTaskStatus,
} from "./types.js";

/**
 * In-process implementation of TeamCoordinator using Maps for storage.
 *
 * Suitable for single-process deployments. For distributed teams,
 * implement the TeamCoordinator interface with a shared data store.
 *
 * @category Agent Teams
 */
export class InMemoryTeamCoordinator implements TeamCoordinator {
  private teammates = new Map<string, TeammateInfo>();
  private tasks = new Map<string, TeamTask>();
  private messages: TeamMessage[] = [];
  private taskIdCounter = 0;
  private messageIdCounter = 0;
  private disposed = false;

  /** Waiters for message notification */
  private waiters = new Map<
    string,
    { resolve: (msgs: TeamMessage[]) => void; timer: ReturnType<typeof setTimeout> }
  >();

  // =========================================================================
  // Teammate Management
  // =========================================================================

  registerTeammate(info: TeammateInfo): void {
    this.teammates.set(info.id, { ...info });
  }

  removeTeammate(id: string): void {
    this.teammates.delete(id);
    // Clean up any waiters
    const waiter = this.waiters.get(id);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve([]);
      this.waiters.delete(id);
    }
  }

  getTeammate(id: string): TeammateInfo | undefined {
    const info = this.teammates.get(id);
    return info ? { ...info } : undefined;
  }

  listTeammates(): TeammateInfo[] {
    return Array.from(this.teammates.values()).map((t) => ({ ...t }));
  }

  updateTeammateStatus(id: string, status: TeammateStatus, taskId?: string): void {
    const teammate = this.teammates.get(id);
    if (teammate) {
      teammate.status = status;
      teammate.currentTaskId = taskId;
    }
  }

  // =========================================================================
  // Task Management
  // =========================================================================

  createTask(task: Omit<TeamTask, "id" | "createdAt" | "updatedAt" | "blocks">): TeamTask {
    const id = `task-${++this.taskIdCounter}`;
    const now = new Date().toISOString();

    const newTask: TeamTask = {
      ...task,
      id,
      blocks: [],
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(id, newTask);

    // Update reverse dependencies
    for (const blockedById of task.blockedBy) {
      const blockerTask = this.tasks.get(blockedById);
      if (blockerTask && !blockerTask.blocks.includes(id)) {
        blockerTask.blocks.push(id);
      }
    }

    return { ...newTask };
  }

  getTask(id: string): TeamTask | undefined {
    const task = this.tasks.get(id);
    return task ? { ...task } : undefined;
  }

  listTasks(filter?: { status?: TeamTaskStatus; assignee?: string }): TeamTask[] {
    let tasks = Array.from(this.tasks.values());

    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    if (filter?.assignee) {
      tasks = tasks.filter((t) => t.assignee === filter.assignee);
    }

    return tasks.map((t) => ({ ...t }));
  }

  claimTask(taskId: string, teammateId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Cannot claim if already assigned
    if (task.assignee) return false;

    // Cannot claim if not pending
    if (task.status !== "pending") return false;

    // Cannot claim if blocked
    if (this.isTaskBlocked(taskId)) return false;

    task.assignee = teammateId;
    task.status = "in_progress";
    task.updatedAt = new Date().toISOString();

    return true;
  }

  completeTask(taskId: string, result?: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Cannot complete if already completed
    if (task.status === "completed") return false;

    task.status = "completed";
    task.result = result;
    task.updatedAt = new Date().toISOString();

    return true;
  }

  updateTask(
    taskId: string,
    updates: Partial<Pick<TeamTask, "subject" | "description" | "status" | "blockedBy">>,
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (updates.subject !== undefined) task.subject = updates.subject;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.status !== undefined) task.status = updates.status;
    if (updates.blockedBy !== undefined) {
      // Remove old reverse dependencies
      for (const oldBlockedById of task.blockedBy) {
        const blockerTask = this.tasks.get(oldBlockedById);
        if (blockerTask) {
          blockerTask.blocks = blockerTask.blocks.filter((id) => id !== taskId);
        }
      }
      task.blockedBy = updates.blockedBy;
      // Add new reverse dependencies
      for (const newBlockedById of updates.blockedBy) {
        const blockerTask = this.tasks.get(newBlockedById);
        if (blockerTask && !blockerTask.blocks.includes(taskId)) {
          blockerTask.blocks.push(taskId);
        }
      }
    }
    task.updatedAt = new Date().toISOString();

    return true;
  }

  isTaskBlocked(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    return task.blockedBy.some((depId) => {
      const depTask = this.tasks.get(depId);
      return depTask && depTask.status !== "completed";
    });
  }

  // =========================================================================
  // Messaging
  // =========================================================================

  sendMessage(msg: Omit<TeamMessage, "id" | "timestamp" | "read">): TeamMessage {
    const id = `msg-${++this.messageIdCounter}`;
    const newMsg: TeamMessage = {
      ...msg,
      id,
      timestamp: new Date().toISOString(),
      read: false,
    };

    this.messages.push(newMsg);

    // Notify any waiters for the recipient
    if (msg.to) {
      this.notifyWaiter(msg.to);
    } else {
      // Broadcast - notify all waiters
      for (const waiterId of this.waiters.keys()) {
        if (waiterId !== msg.from) {
          this.notifyWaiter(waiterId);
        }
      }
    }

    return { ...newMsg };
  }

  getMessages(recipientId: string, unreadOnly = false): TeamMessage[] {
    return this.messages
      .filter((m) => {
        const isRecipient = m.to === recipientId || m.to === null;
        const isNotSelf = m.from !== recipientId;
        if (unreadOnly) {
          return isRecipient && isNotSelf && !m.read;
        }
        return isRecipient && isNotSelf;
      })
      .map((m) => ({ ...m }));
  }

  markRead(messageId: string): void {
    const msg = this.messages.find((m) => m.id === messageId);
    if (msg) {
      msg.read = true;
    }
  }

  async waitForMessage(agentId: string, timeoutMs = 30000): Promise<TeamMessage[] | null> {
    // Check for existing unread messages first
    const existing = this.getMessages(agentId, true);
    if (existing.length > 0) {
      return existing;
    }

    // Wait for new messages
    return new Promise<TeamMessage[] | null>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(agentId);
        resolve(null);
      }, timeoutMs);

      this.waiters.set(agentId, { resolve: (msgs) => resolve(msgs), timer });
    });
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Clean up all waiters
    for (const [, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve([]);
    }
    this.waiters.clear();

    this.teammates.clear();
    this.tasks.clear();
    this.messages = [];
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private notifyWaiter(recipientId: string): void {
    const waiter = this.waiters.get(recipientId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waiters.delete(recipientId);
      const messages = this.getMessages(recipientId, true);
      waiter.resolve(messages);
    }
  }
}
