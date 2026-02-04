/**
 * Tests for bash tool.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecuteResponse, SandboxBackendProtocol } from "../src/backend.js";
import { createBashTool } from "../src/tools/execute.js";

// Mock sandbox
function createMockSandbox(responses: Map<string, ExecuteResponse>): SandboxBackendProtocol {
  return {
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
    uploadFile: vi.fn(),
  };
}

describe("Bash Tool", () => {
  let sandbox: SandboxBackendProtocol;
  let responses: Map<string, ExecuteResponse>;

  beforeEach(() => {
    responses = new Map();
    sandbox = createMockSandbox(responses);
  });

  describe("createBashTool", () => {
    it("should execute commands", async () => {
      responses.set("echo hello", {
        output: "hello",
        exitCode: 0,
        truncated: false,
      });

      const bash = createBashTool({ sandbox });
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

      const bash = createBashTool({ sandbox });
      const result = await bash.execute({ command: "exit 1" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it("should reject empty commands", async () => {
      const bash = createBashTool({ sandbox });
      const result = await bash.execute({ command: "   " }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("should block commands matching blockedCommands", async () => {
      const bash = createBashTool({
        sandbox,
        blockedCommands: ["rm -rf"],
      });
      const result = await bash.execute({ command: "rm -rf /" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("blocked");
    });

    it("should block commands with regex patterns", async () => {
      const bash = createBashTool({
        sandbox,
        blockedCommands: [/sudo/],
      });
      const result = await bash.execute({ command: "sudo rm file" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("blocked");
    });

    it("should allow only allowedCommands when set", async () => {
      const bash = createBashTool({
        sandbox,
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
        sandbox,
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
        sandbox,
        requireApproval: ["git push"],
        onApprovalRequest: async () => true, // Approve
      });

      const result = await bash.execute({ command: "git push origin main" }, {} as any);

      expect(result.success).toBe(true);
      expect(result.output).toBe("Pushed");
    });

    it("should block when no approval callback is provided", async () => {
      const bash = createBashTool({
        sandbox,
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
        sandbox,
        maxOutputSize: 1000,
      });

      const result = await bash.execute({ command: "cat bigfile" }, {} as any);

      expect(result.truncated).toBe(true);
      expect(result.output.length).toBeLessThan(largeOutput.length);
      expect(result.output).toContain("[Output truncated");
    });

    it("should handle sandbox errors", async () => {
      const errorSandbox: SandboxBackendProtocol = {
        execute: vi.fn().mockRejectedValue(new Error("Sandbox error")),
        uploadFile: vi.fn(),
      };

      const bash = createBashTool({ sandbox: errorSandbox });
      const result = await bash.execute({ command: "any command" }, {} as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Sandbox error");
    });

    it("should preserve truncated flag from sandbox", async () => {
      responses.set("big command", {
        output: "Some output",
        exitCode: 0,
        truncated: true, // Already truncated by sandbox
      });

      const bash = createBashTool({ sandbox });
      const result = await bash.execute({ command: "big command" }, {} as any);

      expect(result.truncated).toBe(true);
    });
  });

  describe("Tool Schema", () => {
    it("should have description", () => {
      const bash = createBashTool({ sandbox });
      expect(bash.description).toBeDefined();
      expect(bash.description?.length).toBeGreaterThan(0);
    });

    it("should have parameters schema", () => {
      const bash = createBashTool({ sandbox });
      expect((bash as any).inputSchema || (bash as any).parameters).toBeDefined();
    });
  });
});
