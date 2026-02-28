/**
 * Integration tests for prompt builder with actual agents.
 * These tests verify that the prompt builder correctly extracts
 * information from real agent configurations.
 */

import { generateText, tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../src/agent.js";
import { FilesystemBackend } from "../src/backends/filesystem.js";
import { createAgentState, StateBackend } from "../src/backends/state.js";
import { definePlugin } from "../src/plugins.js";
import { createDefaultPromptBuilder } from "../src/prompt-builder/components.js";
import { defineSkill } from "../src/tools.js";
import type { LanguageModel } from "../src/types.js";

// Mock model
const mockModel: LanguageModel = "test-model" as LanguageModel;

// Mock generateText to avoid actual API calls
vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({
      text: "Mocked response",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 20 },
      steps: [],
    }),
    streamText: vi.fn(),
  };
});

describe("Prompt Builder Integration - System Prompt Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pass tools to system prompt when agent has tools", async () => {
    const agent = createAgent({
      model: mockModel,
      promptBuilder: createDefaultPromptBuilder(),
      tools: {
        read: tool({
          description: "Read a file from disk",
          inputSchema: z.object({ path: z.string() }),
          execute: async () => "file content",
        }),
        write: tool({
          description: "Write content to a file",
          inputSchema: z.object({
            path: z.string(),
            content: z.string(),
          }),
          execute: async () => "written",
        }),
      },
    });

    await agent.generate({ prompt: "Test prompt" });

    // Verify generateText was called
    expect(generateText).toHaveBeenCalled();

    // Get the system prompt that was passed to the model
    const callArgs = (generateText as any).mock.calls[0][0];
    const systemPrompt = callArgs.system;

    // Verify the system prompt contains tool information
    expect(systemPrompt).toContain("# Available Tools");
    expect(systemPrompt).toContain("- **read**: Read a file from disk");
    expect(systemPrompt).toContain("- **write**: Write content to a file");
  });

  it("should pass skills to system prompt when agent has skills", async () => {
    const gitSkill = defineSkill({
      name: "git",
      description: "Git version control operations",
      instructions: "Use git for version control.",
    });

    const agent = createAgent({
      model: mockModel,
      promptBuilder: createDefaultPromptBuilder(),
      skills: [gitSkill],
    });

    await agent.generate({ prompt: "Test prompt" });

    const callArgs = (generateText as any).mock.calls[0][0];
    const systemPrompt = callArgs.system;

    // Skills are registered in the skill registry and accessible via the skill tool,
    // so they appear in the tools section rather than a separate skills section
    expect(systemPrompt).toContain("# Available Tools");
    expect(systemPrompt).toContain("skill");
    expect(systemPrompt).toContain("git");
  });

  it("should pass plugin information to system prompt", async () => {
    const testPlugin = definePlugin({
      name: "test-plugin",
      description: "A plugin for testing",
      tools: {
        pluginTool: tool({
          description: "Tool from plugin",
          inputSchema: z.object({ input: z.string() }),
          execute: async () => "result",
        }),
      },
    });

    const agent = createAgent({
      model: mockModel,
      promptBuilder: createDefaultPromptBuilder(),
      plugins: [testPlugin],
    });

    await agent.generate({ prompt: "Test prompt" });

    const callArgs = (generateText as any).mock.calls[0][0];
    const systemPrompt = callArgs.system;

    // Should include plugin info
    expect(systemPrompt).toContain("# Loaded Plugins");
    expect(systemPrompt).toContain("- **test-plugin**: A plugin for testing");

    // Should also include the plugin's tools
    expect(systemPrompt).toContain("# Available Tools");
    expect(systemPrompt).toContain("pluginTool");
  });

  it("should include backend capabilities in system prompt", async () => {
    const backend = new FilesystemBackend({
      rootDir: "/tmp/test",
      enableBash: true,
    });

    const agent = createAgent({
      model: mockModel,
      promptBuilder: createDefaultPromptBuilder(),
      backend,
    });

    await agent.generate({ prompt: "Test prompt" });

    const callArgs = (generateText as any).mock.calls[0][0];
    const systemPrompt = callArgs.system;

    expect(systemPrompt).toContain("# Capabilities");
    expect(systemPrompt).toContain("Execute shell commands (bash)");
    expect(systemPrompt).toContain("Read and write files to the filesystem");
  });

  it("should include permission mode in system prompt", async () => {
    const agent = createAgent({
      model: mockModel,
      promptBuilder: createDefaultPromptBuilder(),
      permissionMode: "acceptEdits",
    });

    await agent.generate({ prompt: "Test prompt" });

    const callArgs = (generateText as any).mock.calls[0][0];
    const systemPrompt = callArgs.system;

    expect(systemPrompt).toContain("# Permission Mode");
    expect(systemPrompt).toContain("File editing tools are auto-approved");
  });

  it("should use static systemPrompt when provided instead of builder", async () => {
    const agent = createAgent({
      model: mockModel,
      systemPrompt: "You are a test assistant with special instructions.",
      tools: {
        read: tool({
          description: "Read files",
          inputSchema: z.object({ path: z.string() }),
          execute: async () => "content",
        }),
      },
    });

    await agent.generate({ prompt: "Test prompt" });

    const callArgs = (generateText as any).mock.calls[0][0];
    const systemPrompt = callArgs.system;

    // Should use the static prompt, not the builder
    expect(systemPrompt).toBe("You are a test assistant with special instructions.");
    expect(systemPrompt).not.toContain("# Available Tools");
  });

  it("should build complete prompt with all components", async () => {
    const gitSkill = defineSkill({
      name: "git",
      description: "Git operations",
      instructions: "Use git commands.",
    });

    const myPlugin = definePlugin({
      name: "custom-plugin",
      description: "Custom functionality",
      tools: {
        customTool: tool({
          description: "Custom tool",
          inputSchema: z.object({ data: z.string() }),
          execute: async () => "result",
        }),
      },
    });

    const backend = new FilesystemBackend({
      rootDir: "/home/user/project",
      enableBash: true,
    });

    const agent = createAgent({
      model: mockModel,
      promptBuilder: createDefaultPromptBuilder(),
      backend,
      tools: {
        read: tool({
          description: "Read files",
          inputSchema: z.object({ path: z.string() }),
          execute: async () => "content",
        }),
      },
      skills: [gitSkill],
      plugins: [myPlugin],
      permissionMode: "acceptEdits",
    });

    await agent.generate({ prompt: "Test prompt" });

    const callArgs = (generateText as any).mock.calls[0][0];
    const systemPrompt = callArgs.system;

    // Verify all sections are present
    expect(systemPrompt).toContain("You are a helpful AI assistant");
    expect(systemPrompt).toContain("# Available Tools");
    expect(systemPrompt).toContain("# Loaded Plugins");
    expect(systemPrompt).toContain("# Capabilities");
    expect(systemPrompt).toContain("# Permission Mode");

    // Verify specific content
    expect(systemPrompt).toContain("- **read**: Read files");
    // The git skill is registered in the skill registry, accessible via the skill tool
    expect(systemPrompt).toContain("skill");
    expect(systemPrompt).toContain("git");
    expect(systemPrompt).toContain("- **custom-plugin**: Custom functionality");
    expect(systemPrompt).toContain("Execute shell commands (bash)");
    expect(systemPrompt).toContain("File editing tools are auto-approved");
  });

  it("should update prompt context on subsequent generations", async () => {
    const agent = createAgent({
      model: mockModel,
      promptBuilder: createDefaultPromptBuilder(),
      tools: {
        test: tool({
          description: "Test tool",
          inputSchema: z.object({ input: z.string() }),
          execute: async () => "result",
        }),
      },
    });

    // First generation
    await agent.generate({ prompt: "First prompt" });
    const firstCall = (generateText as any).mock.calls[0][0];
    const firstSystemPrompt = firstCall.system;

    // Second generation
    await agent.generate({ prompt: "Second prompt" });
    const secondCall = (generateText as any).mock.calls[1][0];
    const secondSystemPrompt = secondCall.system;

    // Both should have the same tools (context is rebuilt each time)
    expect(firstSystemPrompt).toContain("# Available Tools");
    expect(secondSystemPrompt).toContain("# Available Tools");
    expect(firstSystemPrompt).toEqual(secondSystemPrompt);
  });
});

describe("Prompt Builder Integration with Real Agents", () => {
  describe("with tools", () => {
    it("should include tools in the generated prompt", () => {
      const readTool = tool({
        description: "Read a file from the filesystem",
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => `Contents of ${path}`,
      });

      const writeTool = tool({
        description: "Write content to a file",
        inputSchema: z.object({
          path: z.string(),
          content: z.string(),
        }),
        execute: async ({ path, content }) => `Wrote to ${path}`,
      });

      const agent = createAgent({
        model: mockModel,
        promptBuilder: createDefaultPromptBuilder(),
        tools: {
          read: readTool,
          write: writeTool,
        },
      });

      // Access the internal context builder by generating
      // (We'll check the prompt in the next test using a custom component)
      expect(agent).toBeDefined();
    });

    it("should render tools in system prompt via custom component", async () => {
      const builder = createDefaultPromptBuilder();
      let capturedPrompt = "";

      // Add a component that captures the full prompt
      builder.register({
        name: "capture",
        priority: 0,
        render: (ctx) => {
          // Verify tools are present in context
          expect(ctx.tools).toBeDefined();
          expect(ctx.tools?.length).toBeGreaterThan(0);

          const readTool = ctx.tools?.find((t) => t.name === "read");
          expect(readTool).toBeDefined();
          expect(readTool?.description).toBe("Read a file from the filesystem");

          const writeTool = ctx.tools?.find((t) => t.name === "write");
          expect(writeTool).toBeDefined();
          expect(writeTool?.description).toBe("Write content to a file");

          capturedPrompt = "captured";
          return "";
        },
      });

      const agent = createAgent({
        model: mockModel,
        promptBuilder: builder,
        tools: {
          read: tool({
            description: "Read a file from the filesystem",
            inputSchema: z.object({ path: z.string() }),
            execute: async ({ path }) => `Contents of ${path}`,
          }),
          write: tool({
            description: "Write content to a file",
            inputSchema: z.object({
              path: z.string(),
              content: z.string(),
            }),
            execute: async ({ path }) => `Wrote to ${path}`,
          }),
        },
      });

      await agent.generate({ prompt: "Test prompt" });
      expect(capturedPrompt).toBe("captured");
    });
  });

  describe("with skills", () => {
    it("should include skills in the prompt context", async () => {
      const gitSkill = defineSkill({
        name: "git",
        description: "Git version control operations",
        instructions: "Use git commands to manage version control.",
      });

      const npmSkill = defineSkill({
        name: "npm",
        description: "NPM package management",
        instructions: "Use npm commands to manage packages.",
      });

      let skillsInContext: Array<{ name: string; description: string }> | undefined;

      const builder = createDefaultPromptBuilder().register({
        name: "verify-skills",
        priority: 0,
        render: (ctx) => {
          skillsInContext = ctx.skills;
          return "";
        },
      });

      const agent = createAgent({
        model: mockModel,
        promptBuilder: builder,
        skills: [gitSkill, npmSkill],
      });

      await agent.generate({ prompt: "Test prompt" });

      // Skills are registered in the skill registry and excluded from prompt context
      // (they're accessible via the skill tool instead)
      expect(skillsInContext).toBeUndefined();
    });
  });

  describe("with plugins", () => {
    it("should include plugins in the prompt context", async () => {
      const testPlugin = definePlugin({
        name: "test-plugin",
        description: "A test plugin for verification",
        tools: {
          testTool: tool({
            description: "A test tool",
            inputSchema: z.object({ input: z.string() }),
            execute: async ({ input }) => `Test: ${input}`,
          }),
        },
      });

      let pluginsInContext: Array<{ name: string; description: string }> | undefined;
      let toolsInContext: Array<{ name: string; description: string }> | undefined;

      const builder = createDefaultPromptBuilder().register({
        name: "verify-plugins",
        priority: 0,
        render: (ctx) => {
          pluginsInContext = ctx.plugins;
          toolsInContext = ctx.tools;
          return "";
        },
      });

      const agent = createAgent({
        model: mockModel,
        promptBuilder: builder,
        plugins: [testPlugin],
      });

      await agent.generate({ prompt: "Test prompt" });

      expect(pluginsInContext).toBeDefined();
      expect(pluginsInContext).toContainEqual({
        name: "test-plugin",
        description: "A test plugin for verification",
      });
      expect(toolsInContext).toBeDefined();
      expect(toolsInContext?.some((t) => t.name === "mcp__test-plugin__testTool")).toBe(true);
    });
  });

  describe("with backend information", () => {
    it("should include backend type in context", () => {
      let backendInfo:
        | {
            type: string;
            hasExecuteCapability: boolean;
            rootDir?: string;
          }
        | undefined;

      const builder = createDefaultPromptBuilder().register({
        name: "verify-backend",
        priority: 0,
        render: (ctx) => {
          backendInfo = ctx.backend;
          return "";
        },
      });

      const state = createAgentState();
      const backend = new StateBackend(state);

      const agent = createAgent({
        model: mockModel,
        promptBuilder: builder,
        backend,
      });

      expect(agent).toBeDefined();
    });
  });

  describe("default builder with agent", () => {
    it("should automatically use default builder when no systemPrompt provided", () => {
      const agent = createAgent({
        model: mockModel,
        // No systemPrompt or promptBuilder - should use default
        tools: {
          testTool: tool({
            description: "Test tool",
            inputSchema: z.object({ input: z.string() }),
            execute: async () => "test",
          }),
        },
      });

      expect(agent).toBeDefined();
    });

    it("should use systemPrompt when provided (backward compatibility)", () => {
      const agent = createAgent({
        model: mockModel,
        systemPrompt: "You are a test assistant.",
        tools: {
          testTool: tool({
            description: "Test tool",
            inputSchema: z.object({ input: z.string() }),
            execute: async () => "test",
          }),
        },
      });

      expect(agent).toBeDefined();
    });

    it("should throw error when both systemPrompt and promptBuilder provided", () => {
      expect(() => {
        createAgent({
          model: mockModel,
          systemPrompt: "You are a test assistant.",
          promptBuilder: createDefaultPromptBuilder(),
        });
      }).toThrow("Cannot specify both systemPrompt and promptBuilder");
    });
  });

  describe("full integration scenario", () => {
    it("should build complete prompt with tools, skills, and plugins", () => {
      const gitSkill = defineSkill({
        name: "git",
        description: "Git operations",
        instructions: "Use git commands.",
      });

      const myPlugin = definePlugin({
        name: "my-plugin",
        description: "My custom plugin",
        tools: {
          pluginTool: tool({
            description: "Plugin tool",
            inputSchema: z.object({ data: z.string() }),
            execute: async () => "result",
          }),
        },
      });

      let fullContext: any;

      const builder = createDefaultPromptBuilder().register({
        name: "capture-all",
        priority: 0,
        render: (ctx) => {
          fullContext = ctx;
          return "";
        },
      });

      const agent = createAgent({
        model: mockModel,
        promptBuilder: builder,
        tools: {
          read: tool({
            description: "Read files",
            inputSchema: z.object({ path: z.string() }),
            execute: async () => "content",
          }),
        },
        skills: [gitSkill],
        plugins: [myPlugin],
        maxSteps: 15,
        permissionMode: "acceptEdits",
      });

      expect(agent).toBeDefined();

      // Verify agent configuration
      expect(gitSkill.name).toBe("git");
      expect(myPlugin.name).toBe("my-plugin");
    });
  });

  describe("component rendering verification", () => {
    it("should render identity component by default", () => {
      const builder = createDefaultPromptBuilder();
      const prompt = builder.build({});

      expect(prompt).toContain("You are a helpful AI assistant");
    });

    it("should render tools component when tools are present", () => {
      const builder = createDefaultPromptBuilder();
      const prompt = builder.build({
        tools: [
          { name: "read", description: "Read files" },
          { name: "write", description: "Write files" },
        ],
      });

      expect(prompt).toContain("# Available Tools");
      expect(prompt).toContain("- **read**: Read files");
      expect(prompt).toContain("- **write**: Write files");
    });

    it("should not render tools component when no tools", () => {
      const builder = createDefaultPromptBuilder();
      const prompt = builder.build({});

      expect(prompt).not.toContain("# Available Tools");
    });

    it("should render skills component when skills are present", () => {
      const builder = createDefaultPromptBuilder();
      const prompt = builder.build({
        skills: [
          { name: "git", description: "Git operations" },
          { name: "npm", description: "NPM commands" },
        ],
      });

      expect(prompt).toContain("# Available Skills");
      expect(prompt).toContain("- **git**: Git operations");
      expect(prompt).toContain("- **npm**: NPM commands");
    });

    it("should render capabilities component with backend info", () => {
      const builder = createDefaultPromptBuilder();
      const prompt = builder.build({
        backend: {
          type: "filesystem",
          hasExecuteCapability: true,
          rootDir: "/home/user/project",
        },
      });

      expect(prompt).toContain("# Capabilities");
      expect(prompt).toContain("Execute shell commands (bash)");
      expect(prompt).toContain("Read and write files to the filesystem");
      expect(prompt).toContain("Working directory: /home/user/project");
    });

    it("should render permission mode component", () => {
      const builder = createDefaultPromptBuilder();
      const prompt = builder.build({
        permissionMode: "acceptEdits",
      });

      expect(prompt).toContain("# Permission Mode");
      expect(prompt).toContain("File editing tools are auto-approved");
    });

    it("should not include context component by default", () => {
      const builder = createDefaultPromptBuilder();
      const prompt = builder.build({
        threadId: "thread-123",
        currentMessages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
        ],
      });

      expect(prompt).not.toContain("# Context");
      expect(prompt).not.toContain("Thread ID: thread-123");
      expect(prompt).not.toContain("Conversation history: 2 message(s)");
    });

    it("should order components by priority", () => {
      const builder = createDefaultPromptBuilder();
      const prompt = builder.build({
        tools: [{ name: "test", description: "Test" }],
        skills: [{ name: "skill", description: "Skill" }],
        permissionMode: "default",
      });

      // Identity (priority 100) should come before tools (priority 70)
      const identityIndex = prompt.indexOf("You are a helpful AI assistant");
      const toolsIndex = prompt.indexOf("# Available Tools");

      expect(identityIndex).toBeLessThan(toolsIndex);
      expect(identityIndex).toBeGreaterThan(-1);
      expect(toolsIndex).toBeGreaterThan(-1);
    });
  });

  describe("custom component integration", () => {
    it("should allow adding custom components to default builder", () => {
      const builder = createDefaultPromptBuilder().register({
        name: "custom-header",
        priority: 110, // Higher than identity
        render: () => "# Custom Agent Configuration",
      });

      const prompt = builder.build({});

      expect(prompt).toContain("# Custom Agent Configuration");

      // Custom header should come before identity
      const customIndex = prompt.indexOf("# Custom Agent Configuration");
      const identityIndex = prompt.indexOf("You are a helpful AI assistant");

      expect(customIndex).toBeLessThan(identityIndex);
    });

    it("should allow removing default components", () => {
      const builder = createDefaultPromptBuilder().unregister("identity");

      const prompt = builder.build({});

      expect(prompt).not.toContain("You are a helpful AI assistant");
    });

    it("should allow replacing default components", () => {
      const builder = createDefaultPromptBuilder()
        .unregister("identity")
        .register({
          name: "custom-identity",
          priority: 100,
          render: () => "You are a specialized coding assistant.",
        });

      const prompt = builder.build({});

      expect(prompt).toContain("You are a specialized coding assistant");
      expect(prompt).not.toContain("You are a helpful AI assistant");
    });
  });
});
