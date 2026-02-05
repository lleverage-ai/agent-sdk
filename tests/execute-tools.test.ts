/**
 * Tests for bash tool.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExecutableBackend,
  ExecuteBackgroundOptions,
  ExecuteBackgroundResult,
  ExecuteResponse,
} from "../src/backend.js";
import { TaskManager } from "../src/task-manager.js";
import { createBashTool } from "../src/tools/execute.js";

// Mock backend with execute capability
function createMockBackend(responses: Map<string, ExecuteResponse>): ExecutableBackend {
  return {
    id: "mock-backend",
    execute: vi.fn(async (command: string): Promise<ExecuteResponse> => {
      const response = responses.get(command);
      if (response) {
        return response;
      }
      return {
        output: `Mock output for: ${command}`,
        exitCode: 0,
        truncated: false,
      };
    }),
    uploadFiles: vi.fn(),
  };
}

describe("Bash Tool", () => {
  let backend: ExecutableBackend;
  let responses: Map<string, ExecuteResponse>;

  beforeEach(() => {
    responses = new Map();
    backend = createMockBackend(responses);
  });

  describe("createBashTool", () => {
    it("should execute commands", async () => {
      responses.set("echo hello", {
        output: "hello",
        exitCode: 0,
        truncated: false,
      });

      const bash = createBashTool({ backend });
      const result = await bash.execute({ command: "echo hello" }, {} as any);

      expect(result.success).toBe(true);
      expect(result.output).toBe("hello");
      expect(result.exitCode).toBe(0);
    });

    it("should report failed commands", async () => {
      responses.set("exit 1", {
        output: "Error",
        exitCode: 1,
        truncated: false,
      });

      const bash = createBashTool({ backend });
      const result = await bash.execute({ command: "exit 1" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it("should reject empty commands", async () => {
      const bash = createBashTool({ backend });
      const result = await bash.execute({ command: "   " }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("should block commands matching blockedCommands", async () => {
      const bash = createBashTool({
        backend,
        blockedCommands: ["rm -rf"],
      });
      const result = await bash.execute({ command: "rm -rf /" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("blocked");
    });

    it("should block commands with regex patterns", async () => {
      const bash = createBashTool({
        backend,
        blockedCommands: [/sudo/],
      });
      const result = await bash.execute({ command: "sudo rm file" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("blocked");
    });

    it("should allow only allowedCommands when set", async () => {
      const bash = createBashTool({
        backend,
        allowedCommands: ["ls", "cat"],
      });

      // Allowed command
      responses.set("ls -la", {
        output: "file list",
        exitCode: 0,
        truncated: false,
      });
      const allowedResult = await bash.execute({ command: "ls -la" }, {} as any);
      expect(allowedResult.success).toBe(true);

      // Disallowed command
      const blockedResult = await bash.execute({ command: "rm file" }, {} as any);
      expect(blockedResult.success).toBe(false);
      expect(blockedResult.error).toContain("allowlist");
    });

    it("should require approval for matching commands", async () => {
      const bash = createBashTool({
        backend,
        requireApproval: ["git push"],
        onApprovalRequest: async () => false, // Deny
      });

      const result = await bash.execute({ command: "git push origin main" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("denied");
    });

    it("should proceed when approval is granted", async () => {
      responses.set("git push origin main", {
        output: "Pushed",
        exitCode: 0,
        truncated: false,
      });

      const bash = createBashTool({
        backend,
        requireApproval: ["git push"],
        onApprovalRequest: async () => true, // Approve
      });

      const result = await bash.execute({ command: "git push origin main" }, {} as any);

      expect(result.success).toBe(true);
      expect(result.output).toBe("Pushed");
    });

    it("should block when no approval callback is provided", async () => {
      const bash = createBashTool({
        backend,
        requireApproval: ["git push"],
        // No onApprovalRequest
      });

      const result = await bash.execute({ command: "git push origin main" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("approval");
    });

    it("should truncate large outputs", async () => {
      const largeOutput = "x".repeat(150_000);
      responses.set("cat bigfile", {
        output: largeOutput,
        exitCode: 0,
        truncated: false,
      });

      const bash = createBashTool({
        backend,
        maxOutputSize: 1000,
      });

      const result = await bash.execute({ command: "cat bigfile" }, {} as any);

      expect(result.truncated).toBe(true);
      expect(result.output.length).toBeLessThan(largeOutput.length);
      expect(result.output).toContain("[Output truncated");
    });

    it("should handle backend errors", async () => {
      const errorBackend: ExecutableBackend = {
        id: "error-backend",
        execute: vi.fn().mockRejectedValue(new Error("Backend error")),
        uploadFiles: vi.fn(),
      };

      const bash = createBashTool({ backend: errorBackend });
      const result = await bash.execute({ command: "any command" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Backend error");
    });

    it("should preserve truncated flag from backend", async () => {
      responses.set("big command", {
        output: "Some output",
        exitCode: 0,
        truncated: true, // Already truncated by backend
      });

      const bash = createBashTool({ backend });
      const result = await bash.execute({ command: "big command" }, {} as any);

      expect(result.truncated).toBe(true);
    });
  });

  describe("Tool Schema", () => {
    it("should have description", () => {
      const bash = createBashTool({ backend });
      expect(bash.description).toBeDefined();
      expect(bash.description?.length).toBeGreaterThan(0);
    });

    it("should have parameters schema", () => {
      const bash = createBashTool({ backend });
      expect((bash as any).inputSchema || (bash as any).parameters).toBeDefined();
    });
  });

  describe("Background Execution", () => {
    // Mock backend with executeBackground support
    function createBackgroundMockBackend(): ExecutableBackend & {
      executeBackground: (options: ExecuteBackgroundOptions) => ExecuteBackgroundResult;
    } {
      return {
        id: "mock-background-backend",
        execute: vi.fn(async (): Promise<ExecuteResponse> => {
          return { output: "foreground output", exitCode: 0, truncated: false };
        }),
        executeBackground: vi.fn((options: ExecuteBackgroundOptions): ExecuteBackgroundResult => {
          // Simulate async process completion
          setTimeout(() => {
            options.onOutput?.("hello\n");
            options.onComplete?.({
              output: "hello\n",
              exitCode: 0,
              truncated: false,
            });
          }, 10);

          return {
            process: { pid: 12345 } as any,
            abort: vi.fn(),
          };
        }),
        uploadFiles: vi.fn(),
      };
    }

    it("should require TaskManager for background execution", async () => {
      const bgBackend = createBackgroundMockBackend();
      const bash = createBashTool({ backend: bgBackend });

      // Execute without TaskManager in options
      const result = await bash.execute(
        { command: "echo hello", run_in_background: true },
        {} as any,
      );

      expect(result).toHaveProperty("error");
      expect((result as any).error).toContain("TaskManager");
    });

    it("should start background command when TaskManager is provided via execution options", async () => {
      const bgBackend = createBackgroundMockBackend();
      const taskManager = new TaskManager();
      const bash = createBashTool({ backend: bgBackend });

      // Execute with TaskManager in options (simulating agent wrapper injection)
      const result = await bash.execute(
        { command: "echo hello", run_in_background: true },
        { taskManager } as any,
      );

      expect(result).toHaveProperty("taskId");
      expect(result).toHaveProperty("status", "running");
      expect((result as any).message).toContain("task_output");

      // Verify task is registered
      const tasks = taskManager.listTasks();
      expect(tasks.length).toBe(1);
      expect(tasks[0].id).toBe((result as any).taskId);
    });

    it("should update task status on completion", async () => {
      const bgBackend = createBackgroundMockBackend();
      const taskManager = new TaskManager();
      const bash = createBashTool({ backend: bgBackend });

      const result = await bash.execute(
        { command: "echo hello", run_in_background: true },
        { taskManager } as any,
      );

      const taskId = (result as any).taskId;

      // Wait for the simulated completion
      await new Promise((resolve) => setTimeout(resolve, 50));

      const task = taskManager.getTask(taskId);
      expect(task?.status).toBe("completed");
      expect(task?.result).toContain("hello");
    });

    it("should update task status on error", async () => {
      const errorBackend: ExecutableBackend & {
        executeBackground: (options: ExecuteBackgroundOptions) => ExecuteBackgroundResult;
      } = {
        id: "error-background-backend",
        execute: vi.fn(),
        executeBackground: vi.fn((options: ExecuteBackgroundOptions): ExecuteBackgroundResult => {
          setTimeout(() => {
            options.onError?.(new Error("Process failed"));
          }, 10);
          return {
            process: { pid: 12345 } as any,
            abort: vi.fn(),
          };
        }),
        uploadFiles: vi.fn(),
      };

      const taskManager = new TaskManager();
      const bash = createBashTool({ backend: errorBackend });

      const result = await bash.execute(
        { command: "failing-command", run_in_background: true },
        { taskManager } as any,
      );

      const taskId = (result as any).taskId;

      // Wait for the simulated error
      await new Promise((resolve) => setTimeout(resolve, 50));

      const task = taskManager.getTask(taskId);
      expect(task?.status).toBe("failed");
      expect(task?.error).toContain("Process failed");
    });

    it("should work with TaskManager provided at construction time", async () => {
      const bgBackend = createBackgroundMockBackend();
      const taskManager = new TaskManager();

      // Provide TaskManager at construction time
      const bash = createBashTool({ backend: bgBackend, taskManager });

      // Execute without TaskManager in options
      const result = await bash.execute(
        { command: "echo hello", run_in_background: true },
        {} as any,
      );

      expect(result).toHaveProperty("taskId");
      expect(result).toHaveProperty("status", "running");

      const tasks = taskManager.listTasks();
      expect(tasks.length).toBe(1);
    });

    it("should prefer execution options TaskManager over construction time", async () => {
      const bgBackend = createBackgroundMockBackend();
      const constructionTaskManager = new TaskManager();
      const executionTaskManager = new TaskManager();

      const bash = createBashTool({ backend: bgBackend, taskManager: constructionTaskManager });

      // Execute with different TaskManager in options
      const result = await bash.execute(
        { command: "echo hello", run_in_background: true },
        { taskManager: executionTaskManager } as any,
      );

      // Should use execution options TaskManager
      expect(executionTaskManager.listTasks().length).toBe(1);
      expect(constructionTaskManager.listTasks().length).toBe(0);
    });
  });
});

// Test simulating the agent wrapper flow
describe("Bash Tool with Agent Wrapper Simulation", () => {
  it("should work when TaskManager is wrapped like the agent does", async () => {
    const { FilesystemBackend } = await import("../src/backends/filesystem.js");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmpDir = path.join(os.tmpdir(), `bash-test-${Date.now()}`);
    const fs = await import("node:fs/promises");
    await fs.mkdir(tmpDir, { recursive: true });

    try {
      const backend = new FilesystemBackend({
        rootDir: tmpDir,
        enableBash: true,
      });

      // Create TaskManager (simulating what the agent does)
      const taskManager = new TaskManager();

      // Create bash tool WITHOUT TaskManager (simulating createCoreTools without taskManager)
      const bash = createBashTool({ backend });

      // Simulate the agent's wrapToolsWithTaskManager wrapper
      const wrappedBash = {
        ...bash,
        execute: async (input: any, options?: any) => {
          // Inject taskManager into options (what wrapToolsWithTaskManager does)
          const extendedOptions = {
            ...options,
            taskManager,
          };
          return bash.execute(input, extendedOptions);
        },
      };

      // Track task completion
      let completedTask: any = null;
      taskManager.on("taskCompleted", (task) => {
        completedTask = task;
        console.log("Task completed event received:", task.id);
      });

      // Start a quick background command using the wrapped tool
      const result = await wrappedBash.execute(
        { command: "echo wrapped", run_in_background: true },
        {} as any,
      );

      expect(result).toHaveProperty("taskId");
      expect(result).toHaveProperty("status", "running");

      const taskId = (result as any).taskId;

      // Verify task is registered
      expect(taskManager.listTasks().length).toBe(1);
      expect(taskManager.getTask(taskId)?.status).toBe("running");

      // Wait for the command to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check task status via TaskManager
      const task = taskManager.getTask(taskId);
      console.log("Task after waiting (wrapped):", JSON.stringify(task, null, 2));

      expect(task).toBeDefined();
      expect(task?.status).toBe("completed");
      expect(task?.result).toContain("wrapped");

      // Verify event was emitted
      expect(completedTask).not.toBeNull();
      expect(completedTask.id).toBe(taskId);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// Integration test with real FilesystemBackend
describe("Bash Tool Integration", () => {
  it("should complete background command with real FilesystemBackend", async () => {
    // Use dynamic import to avoid issues with FilesystemBackend in test environment
    const { FilesystemBackend } = await import("../src/backends/filesystem.js");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmpDir = path.join(os.tmpdir(), `bash-test-${Date.now()}`);
    const fs = await import("node:fs/promises");
    await fs.mkdir(tmpDir, { recursive: true });

    try {
      const backend = new FilesystemBackend({
        rootDir: tmpDir,
        enableBash: true,
      });

      const taskManager = new TaskManager();
      const bash = createBashTool({ backend, taskManager });

      // Start a quick background command
      const result = await bash.execute(
        { command: "echo hello", run_in_background: true },
        {} as any,
      );

      expect(result).toHaveProperty("taskId");
      expect(result).toHaveProperty("status", "running");

      const taskId = (result as any).taskId;

      // Wait for the command to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check task status
      const task = taskManager.getTask(taskId);
      console.log("Task after waiting:", JSON.stringify(task, null, 2));

      expect(task).toBeDefined();
      expect(task?.status).toBe("completed");
      expect(task?.result).toContain("hello");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("should complete background command when TaskManager is injected via execution options", async () => {
    const { FilesystemBackend } = await import("../src/backends/filesystem.js");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmpDir = path.join(os.tmpdir(), `bash-test-${Date.now()}`);
    const fs = await import("node:fs/promises");
    await fs.mkdir(tmpDir, { recursive: true });

    try {
      const backend = new FilesystemBackend({
        rootDir: tmpDir,
        enableBash: true,
      });

      // Create bash tool WITHOUT TaskManager at construction time
      const bash = createBashTool({ backend });

      // Create TaskManager to inject via execution options (simulating agent wrapper)
      const taskManager = new TaskManager();

      // Start a quick background command with TaskManager in execution options
      const result = await bash.execute(
        { command: "echo injected", run_in_background: true },
        { taskManager } as any,
      );

      expect(result).toHaveProperty("taskId");
      expect(result).toHaveProperty("status", "running");

      const taskId = (result as any).taskId;

      // Wait for the command to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check task status
      const task = taskManager.getTask(taskId);
      console.log("Task after waiting (injected):", JSON.stringify(task, null, 2));

      expect(task).toBeDefined();
      expect(task?.status).toBe("completed");
      expect(task?.result).toContain("injected");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
