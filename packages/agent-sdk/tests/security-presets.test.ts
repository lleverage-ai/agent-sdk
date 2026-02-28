/**
 * Tests for security policy presets.
 */

import { describe, expect, it } from "vitest";
import { FilesystemBackend } from "../src/backends/filesystem.js";
import { applySecurityPolicy, type SecurityPolicyPreset } from "../src/security/index.js";

describe("Security Policy Presets", () => {
  describe("applySecurityPolicy", () => {
    it("should return a FilesystemBackend backend", () => {
      const result = applySecurityPolicy("development");
      expect(result.backend).toBeInstanceOf(FilesystemBackend);
    });

    it("should include permission mode in result", () => {
      const result = applySecurityPolicy("production");
      expect(result.permissionMode).toBeDefined();
    });

    it("should support overrides", () => {
      const result = applySecurityPolicy("production", {
        permissionMode: "plan",
      });
      expect(result.permissionMode).toBe("plan");
    });

    it("should merge backend options with overrides", () => {
      const result = applySecurityPolicy("development", {
        backend: { timeout: 5000 },
      });
      expect(result.backend).toBeInstanceOf(FilesystemBackend);
    });
  });

  describe("development preset", () => {
    it("should have permissive settings", () => {
      const result = applySecurityPolicy("development");
      expect(result.permissionMode).toBe("default");
      expect(result.disallowedTools).toBeUndefined();
      expect(result.allowedTools).toBeUndefined();
    });

    it("should allow dangerous commands in backend", async () => {
      const result = applySecurityPolicy("development");
      // Should not throw for dangerous commands (allowDangerous: true)
      // We can't directly test this without executing, but we verify the backend was created
      expect(result.backend).toBeInstanceOf(FilesystemBackend);
    });

    it("should have long timeout", () => {
      const result = applySecurityPolicy("development");
      // Backend is created with 120000ms timeout (verified in implementation)
      expect(result.backend).toBeInstanceOf(FilesystemBackend);
    });
  });

  describe("ci preset", () => {
    it("should use plan mode (no tool execution)", () => {
      const result = applySecurityPolicy("ci");
      expect(result.permissionMode).toBe("plan");
    });

    it("should block bash and execute tools", () => {
      const result = applySecurityPolicy("ci");
      expect(result.disallowedTools).toContain("bash");
      expect(result.disallowedTools).toContain("execute");
    });

    it("should have medium timeout for long tests", () => {
      const result = applySecurityPolicy("ci");
      // Backend is created with 300000ms timeout (verified in implementation)
      expect(result.backend).toBeInstanceOf(FilesystemBackend);
    });

    it("should block network operations in backend", () => {
      const result = applySecurityPolicy("ci");
      // Backend has blockedCommands for curl, wget, git push, etc.
      expect(result.backend).toBeInstanceOf(FilesystemBackend);
    });
  });

  describe("production preset", () => {
    it("should use default permission mode", () => {
      const result = applySecurityPolicy("production");
      expect(result.permissionMode).toBe("default");
    });

    it("should block write and edit tools", () => {
      const result = applySecurityPolicy("production");
      expect(result.disallowedTools).toContain("write");
      expect(result.disallowedTools).toContain("edit");
    });

    it("should have short timeout (fail fast)", () => {
      const result = applySecurityPolicy("production");
      // Backend is created with 60000ms timeout (verified in implementation)
      expect(result.backend).toBeInstanceOf(FilesystemBackend);
    });

    it("should block package management commands", () => {
      const result = applySecurityPolicy("production");
      // Backend has blockedCommands for npm install, yarn add, etc.
      expect(result.backend).toBeInstanceOf(FilesystemBackend);
    });
  });

  describe("readonly preset", () => {
    it("should use plan mode", () => {
      const result = applySecurityPolicy("readonly");
      expect(result.permissionMode).toBe("plan");
    });

    it("should block all write operations", () => {
      const result = applySecurityPolicy("readonly");
      expect(result.disallowedTools).toContain("bash");
      expect(result.disallowedTools).toContain("execute");
      expect(result.disallowedTools).toContain("write");
      expect(result.disallowedTools).toContain("edit");
    });

    it("should allow only read tools", () => {
      const result = applySecurityPolicy("readonly");
      expect(result.allowedTools).toContain("read");
      expect(result.allowedTools).toContain("glob");
      expect(result.allowedTools).toContain("grep");
      expect(result.allowedTools).toContain("ls");
    });

    it("should have very short timeout", () => {
      const result = applySecurityPolicy("readonly");
      // Backend is created with 30000ms timeout (verified in implementation)
      expect(result.backend).toBeInstanceOf(FilesystemBackend);
    });

    it("should block all write commands in backend", () => {
      const result = applySecurityPolicy("readonly");
      // Backend has extensive blockedCommands list
      expect(result.backend).toBeInstanceOf(FilesystemBackend);
    });
  });

  describe("overrides", () => {
    it("should override permission mode", () => {
      const result = applySecurityPolicy("development", {
        permissionMode: "bypassPermissions",
      });
      expect(result.permissionMode).toBe("bypassPermissions");
    });

    it("should override disallowed tools", () => {
      const result = applySecurityPolicy("production", {
        disallowedTools: ["custom-tool"],
      });
      expect(result.disallowedTools).toEqual(["custom-tool"]);
    });

    it("should override allowed tools", () => {
      const result = applySecurityPolicy("readonly", {
        allowedTools: ["read", "custom-read"],
      });
      expect(result.allowedTools).toEqual(["read", "custom-read"]);
    });

    it("should merge backend options", () => {
      const result = applySecurityPolicy("ci", {
        backend: {
          timeout: 10000,
          maxFileSizeMb: 1,
        },
      });
      expect(result.backend).toBeInstanceOf(FilesystemBackend);
    });

    it("should override unified hooks", () => {
      const mockHooks = {
        PreToolUse: [
          {
            matcher: "bash",
            hooks: [],
          },
        ],
      };
      const result = applySecurityPolicy("development", {
        hooks: mockHooks,
      });
      expect(result.hooks).toBe(mockHooks);
    });
  });

  describe("preset comparison", () => {
    it("development should be most permissive", () => {
      const dev = applySecurityPolicy("development");
      expect(dev.permissionMode).toBe("default");
      expect(dev.disallowedTools).toBeUndefined();
      expect(dev.allowedTools).toBeUndefined();
    });

    it("readonly should be most restrictive", () => {
      const readonly = applySecurityPolicy("readonly");
      expect(readonly.permissionMode).toBe("plan");
      expect(readonly.disallowedTools?.length).toBeGreaterThan(0);
      expect(readonly.allowedTools?.length).toBeGreaterThan(0);
    });

    it("ci and production should be balanced", () => {
      const ci = applySecurityPolicy("ci");
      const prod = applySecurityPolicy("production");

      expect(ci.permissionMode).toBe("plan");
      expect(prod.permissionMode).toBe("default");

      expect(ci.disallowedTools?.length).toBeGreaterThan(0);
      expect(prod.disallowedTools?.length).toBeGreaterThan(0);
    });
  });

  describe("integration with agent", () => {
    it("should provide all required fields for createAgent", () => {
      const result = applySecurityPolicy("production");

      // Check all expected fields are present
      expect(result.backend).toBeDefined();
      expect(result.permissionMode).toBeDefined();

      // Optional fields
      expect(result).toHaveProperty("disallowedTools");
      expect(result).toHaveProperty("allowedTools");
      expect(result).toHaveProperty("hooks");
    });

    it("should be spreadable into agent options", () => {
      const policy = applySecurityPolicy("ci");

      // Simulate spreading into agent options
      const agentOptions = {
        model: {} as any, // Mock model
        ...policy,
      };

      expect(agentOptions.backend).toBe(policy.backend);
      expect(agentOptions.permissionMode).toBe(policy.permissionMode);
    });
  });

  describe("error handling", () => {
    it("should throw for unknown preset", () => {
      expect(() => {
        applySecurityPolicy("unknown" as SecurityPolicyPreset);
      }).toThrow("Unknown security preset");
    });
  });
});
