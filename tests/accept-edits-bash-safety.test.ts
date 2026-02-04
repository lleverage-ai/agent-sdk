/**
 * Tests for acceptEdits mode bash command safety.
 *
 * Verifies that when acceptEdits permission mode is enabled with shell file
 * operation blocking, bash commands that perform file writes are properly blocked
 * while the write/edit tools remain accessible through the permission system.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent } from "../src/agent.js";
import { LocalSandbox } from "../src/backends/sandbox.js";
import {
  ACCEPT_EDITS_BLOCKED_PATTERNS,
  applySecurityPolicy,
  getSandboxOptionsForAcceptEdits,
} from "../src/security/index.js";
import { createMockModel } from "./setup.js";

describe("acceptEdits mode bash safety", () => {
  describe("ACCEPT_EDITS_BLOCKED_PATTERNS", () => {
    it("should block output redirection", () => {
      const commands = ["echo 'test' > file.txt", "cat input.txt > output.txt", "ls >> log.txt"];

      for (const cmd of commands) {
        const blocked = ACCEPT_EDITS_BLOCKED_PATTERNS.some((pattern) => pattern.test(cmd));
        expect(blocked).toBe(true);
      }
    });

    it("should block file deletion and movement", () => {
      const commands = ["rm file.txt", "rm -rf /tmp/data", "mv old.txt new.txt"];

      for (const cmd of commands) {
        const blocked = ACCEPT_EDITS_BLOCKED_PATTERNS.some((pattern) => pattern.test(cmd));
        expect(blocked).toBe(true);
      }
    });

    it("should block file creation and modification", () => {
      const commands = [
        "touch newfile.txt",
        "cp source.txt dest.txt",
        "mkdir newdir",
        "rmdir olddir",
      ];

      for (const cmd of commands) {
        const blocked = ACCEPT_EDITS_BLOCKED_PATTERNS.some((pattern) => pattern.test(cmd));
        expect(blocked).toBe(true);
      }
    });

    it("should block permission changes", () => {
      const commands = ["chmod 755 script.sh", "chown user:group file.txt"];

      for (const cmd of commands) {
        const blocked = ACCEPT_EDITS_BLOCKED_PATTERNS.some((pattern) => pattern.test(cmd));
        expect(blocked).toBe(true);
      }
    });

    it("should block package manager operations", () => {
      const commands = [
        "npm install express",
        "npm uninstall lodash",
        "yarn add react",
        "yarn remove vue",
        "pip install requests",
        "pip uninstall flask",
      ];

      for (const cmd of commands) {
        const blocked = ACCEPT_EDITS_BLOCKED_PATTERNS.some((pattern) => pattern.test(cmd));
        expect(blocked).toBe(true);
      }
    });

    it("should allow read-only operations", () => {
      const commands = [
        "ls -la",
        "cat file.txt",
        "grep pattern file.txt",
        "find . -name '*.ts'",
        "head -n 10 file.txt",
        "tail -f log.txt",
      ];

      for (const cmd of commands) {
        const blocked = ACCEPT_EDITS_BLOCKED_PATTERNS.some((pattern) => pattern.test(cmd));
        expect(blocked).toBe(false);
      }
    });
  });

  describe("getSandboxOptionsForAcceptEdits", () => {
    it("should add blocked patterns to base options", () => {
      const options = getSandboxOptionsForAcceptEdits({
        timeout: 30000,
        cwd: "/tmp",
      });

      expect(options.timeout).toBe(30000);
      expect(options.cwd).toBe("/tmp");
      expect(options.blockedCommands).toBeDefined();
      expect(options.blockedCommands?.length).toBeGreaterThan(0);
    });

    it("should merge with existing blocked commands", () => {
      const customPattern = /custom-command/;
      const options = getSandboxOptionsForAcceptEdits({
        blockedCommands: [customPattern],
      });

      expect(options.blockedCommands).toContain(customPattern);
      expect(options.blockedCommands?.length).toBeGreaterThan(1);
    });

    it("should create valid sandbox options", () => {
      const options = getSandboxOptionsForAcceptEdits();
      const sandbox = new LocalSandbox(options);

      expect(sandbox).toBeDefined();
      expect(sandbox.id).toBeDefined();
    });
  });

  describe("applySecurityPolicy with acceptEdits", () => {
    it("should block shell file ops by default with acceptEdits mode", async () => {
      const policy = applySecurityPolicy("development", {
        permissionMode: "acceptEdits",
      });

      expect(policy.permissionMode).toBe("acceptEdits");
      expect(policy.backend).toBeDefined();

      // Verify sandbox blocks file write commands
      const sandbox = policy.backend as LocalSandbox;
      try {
        await sandbox.execute("echo 'test' > /tmp/test.txt");
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.name).toBe("CommandBlockedError");
      }
    });

    it("should respect blockShellFileOps: false", async () => {
      const policy = applySecurityPolicy("development", {
        permissionMode: "acceptEdits",
        blockShellFileOps: false,
      });

      expect(policy.permissionMode).toBe("acceptEdits");

      // Should NOT block file write commands when blockShellFileOps is false
      const sandbox = policy.backend as LocalSandbox;
      // This should succeed (or fail with a normal execution error, not CommandBlockedError)
      try {
        // Try a safe write operation
        const result = await sandbox.execute("echo 'test' > /tmp/test-${Date.now()}.txt");
        // If it succeeds, that's fine - it means blocking is disabled
        expect(result.exitCode).toBeDefined();
      } catch (error: any) {
        // If it fails, it should NOT be due to blocking
        expect(error.name).not.toBe("CommandBlockedError");
      }
    });

    it("should not add blocking for non-acceptEdits modes", async () => {
      const policy = applySecurityPolicy("development", {
        permissionMode: "default",
        blockShellFileOps: true,
      });

      expect(policy.permissionMode).toBe("default");

      // blockShellFileOps should only apply when permissionMode is acceptEdits
      const sandbox = policy.backend as LocalSandbox;
      // This should succeed since blockShellFileOps only applies to acceptEdits mode
      try {
        const result = await sandbox.execute("echo 'test' > /tmp/test-${Date.now()}.txt");
        expect(result.exitCode).toBeDefined();
      } catch (error: any) {
        // If it fails, it should NOT be due to blocking
        expect(error.name).not.toBe("CommandBlockedError");
      }
    });

    it("should preserve existing sandbox blocked commands", async () => {
      const customPattern = /dangerous-command/;
      const policy = applySecurityPolicy("development", {
        permissionMode: "acceptEdits",
        sandbox: {
          blockedCommands: [customPattern],
        },
      });

      const sandbox = policy.backend as LocalSandbox;

      // Custom pattern should be blocked
      try {
        await sandbox.execute("dangerous-command");
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.name).toBe("CommandBlockedError");
      }

      // File write operations should also be blocked
      try {
        await sandbox.execute("echo 'test' > /tmp/test.txt");
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.name).toBe("CommandBlockedError");
      }
    });
  });

  describe("integration with LocalSandbox", () => {
    it("should block shell write commands when configured", async () => {
      const options = getSandboxOptionsForAcceptEdits({
        cwd: "/tmp",
        timeout: 5000,
      });
      const sandbox = new LocalSandbox(options);

      // Try to execute a blocked command
      try {
        await sandbox.execute("echo 'test' > /tmp/testfile.txt");
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.name).toBe("CommandBlockedError");
        expect(error.message).toContain("blocked");
      }
    });

    it("should allow read commands when configured", async () => {
      const options = getSandboxOptionsForAcceptEdits({
        cwd: "/tmp",
        timeout: 5000,
      });
      const sandbox = new LocalSandbox(options);

      // Try to execute an allowed command
      const result = await sandbox.execute("echo 'test'");
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("test");
    });

    it("should block multiple types of write operations", async () => {
      const options = getSandboxOptionsForAcceptEdits({
        cwd: "/tmp",
        timeout: 5000,
      });
      const sandbox = new LocalSandbox(options);

      const blockedCommands = ["touch /tmp/newfile", "mkdir /tmp/newdir", "rm /tmp/somefile"];

      for (const cmd of blockedCommands) {
        try {
          await sandbox.execute(cmd);
          expect(true).toBe(false); // Should not reach here
        } catch (error: any) {
          expect(error.name).toBe("CommandBlockedError");
        }
      }
    });
  });

  describe("createAgent automatic shell blocking", () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it("should automatically block shell file ops in acceptEdits mode by default", async () => {
      const sandbox = new LocalSandbox({
        cwd: "/tmp",
        timeout: 5000,
      });

      const agent = createAgent({
        model: createMockModel(),
        backend: sandbox,
        permissionMode: "acceptEdits",
        // blockShellFileOps defaults to true
      });

      // Get the bash tool from the agent
      const tools = agent.getActiveTools();
      const bashTool = tools.bash;

      expect(bashTool).toBeDefined();

      // Try to execute a shell file write command via the bash tool
      // This should be blocked by the automatic shell blocking
      // The bash tool catches errors and returns them in the result
      // @ts-expect-error - accessing execute for testing
      const result = await bashTool.execute({ command: "echo 'test' > /tmp/testfile.txt" });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("acceptEdits");

      // Verify no warning was logged (since blocking is enabled)
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should log warning when blockShellFileOps is explicitly disabled", () => {
      const sandbox = new LocalSandbox({
        cwd: "/tmp",
        timeout: 5000,
      });

      createAgent({
        model: createMockModel(),
        backend: sandbox,
        permissionMode: "acceptEdits",
        blockShellFileOps: false, // Explicitly disable
      });

      // Verify warning was logged
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("blockShellFileOps is disabled"),
      );
    });

    it("should allow shell file ops when blockShellFileOps is false", async () => {
      const sandbox = new LocalSandbox({
        cwd: "/tmp",
        timeout: 5000,
      });

      const agent = createAgent({
        model: createMockModel(),
        backend: sandbox,
        permissionMode: "acceptEdits",
        blockShellFileOps: false, // Explicitly allow shell file ops
      });

      // Get the bash tool from the agent
      const tools = agent.getActiveTools();
      const bashTool = tools.bash;

      expect(bashTool).toBeDefined();

      // Use a simple echo command that should succeed
      // @ts-expect-error - accessing execute for testing
      const result = await bashTool.execute({ command: "echo 'test'" });
      expect(result.success).toBe(true);
      expect(result.output).toContain("test");
    });

    it("should not apply shell blocking for non-acceptEdits modes", async () => {
      const sandbox = new LocalSandbox({
        cwd: "/tmp",
        timeout: 5000,
      });

      const agent = createAgent({
        model: createMockModel(),
        backend: sandbox,
        permissionMode: "default", // Not acceptEdits
      });

      // Get the bash tool from the agent
      const tools = agent.getActiveTools();
      const bashTool = tools.bash;

      expect(bashTool).toBeDefined();

      // Shell commands should work without acceptEdits-specific blocking
      // @ts-expect-error - accessing execute for testing
      const result = await bashTool.execute({ command: "echo 'test'" });
      expect(result.success).toBe(true);
      expect(result.output).toContain("test");

      // Verify no warning was logged
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should not apply shell blocking when no sandbox backend", () => {
      // Create agent without sandbox backend (uses StateBackend)
      const agent = createAgent({
        model: createMockModel(),
        permissionMode: "acceptEdits",
      });

      // Should not have bash tool since there's no sandbox
      const tools = agent.getActiveTools();
      expect(tools.bash).toBeUndefined();

      // No warning should be logged
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should block multiple file operation commands automatically", async () => {
      const sandbox = new LocalSandbox({
        cwd: "/tmp",
        timeout: 5000,
      });

      const agent = createAgent({
        model: createMockModel(),
        backend: sandbox,
        permissionMode: "acceptEdits",
      });

      const tools = agent.getActiveTools();
      const bashTool = tools.bash;

      const blockedCommands = [
        "echo 'test' > /tmp/file.txt", // Output redirection
        "rm /tmp/file.txt", // File deletion
        "touch /tmp/newfile", // File creation
        "mkdir /tmp/newdir", // Directory creation
        "mv /tmp/a /tmp/b", // File move
        "cp /tmp/a /tmp/b", // File copy
      ];

      for (const cmd of blockedCommands) {
        // @ts-expect-error - accessing execute for testing
        const result = await bashTool.execute({ command: cmd });
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        // Error message should indicate it was blocked
        expect(result.error).toContain("blocked");
      }
    });

    it("should allow read-only commands in acceptEdits mode", async () => {
      const sandbox = new LocalSandbox({
        cwd: "/tmp",
        timeout: 5000,
      });

      const agent = createAgent({
        model: createMockModel(),
        backend: sandbox,
        permissionMode: "acceptEdits",
      });

      const tools = agent.getActiveTools();
      const bashTool = tools.bash;

      // Read-only commands should work
      // @ts-expect-error - accessing execute for testing
      const result = await bashTool.execute({ command: "ls -la /tmp" });
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });
  });
});
