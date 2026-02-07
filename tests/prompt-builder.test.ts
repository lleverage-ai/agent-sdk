/**
 * Tests for the prompt builder system.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  capabilitiesComponent,
  contextComponent,
  createDefaultPromptBuilder,
  identityComponent,
  permissionModeComponent,
  pluginsComponent,
  skillsComponent,
  toolsComponent,
} from "../src/prompt-builder/components.js";
import type { PromptComponent, PromptContext } from "../src/prompt-builder/index.js";
import { PromptBuilder } from "../src/prompt-builder/index.js";

describe("PromptBuilder", () => {
  describe("basic functionality", () => {
    it("should create an empty builder", () => {
      const builder = new PromptBuilder();
      expect(builder.getComponentNames()).toEqual([]);
    });

    it("should register a component", () => {
      const builder = new PromptBuilder();
      const component: PromptComponent = {
        name: "test",
        render: () => "Hello",
      };

      builder.register(component);
      expect(builder.getComponentNames()).toEqual(["test"]);
    });

    it("should register multiple components", () => {
      const builder = new PromptBuilder();
      const components: PromptComponent[] = [
        { name: "one", render: () => "One" },
        { name: "two", render: () => "Two" },
      ];

      builder.registerMany(components);
      expect(builder.getComponentNames()).toEqual(["one", "two"]);
    });

    it("should unregister a component", () => {
      const builder = new PromptBuilder();
      builder.register({ name: "test", render: () => "Test" });
      builder.unregister("test");
      expect(builder.getComponentNames()).toEqual([]);
    });

    it("should replace a component when re-registering with same name", () => {
      const builder = new PromptBuilder();
      builder.register({ name: "test", render: () => "First" });
      builder.register({ name: "test", render: () => "Second" });

      const prompt = builder.build({});
      expect(prompt).toBe("Second");
    });

    it("should allow method chaining", () => {
      const builder = new PromptBuilder()
        .register({ name: "one", render: () => "One" })
        .register({ name: "two", render: () => "Two" })
        .unregister("one");

      expect(builder.getComponentNames()).toEqual(["two"]);
    });
  });

  describe("clone", () => {
    it("should clone a builder with all components", () => {
      const original = new PromptBuilder()
        .register({ name: "one", render: () => "One" })
        .register({ name: "two", render: () => "Two" });

      const cloned = original.clone();

      expect(cloned.getComponentNames()).toEqual(["one", "two"]);
      expect(cloned).not.toBe(original);
    });

    it("should not modify original when modifying clone", () => {
      const original = new PromptBuilder().register({ name: "one", render: () => "One" });

      const cloned = original.clone();
      cloned.register({ name: "two", render: () => "Two" });

      expect(original.getComponentNames()).toEqual(["one"]);
      expect(cloned.getComponentNames()).toEqual(["one", "two"]);
    });
  });

  describe("build", () => {
    it("should build an empty prompt from no components", () => {
      const builder = new PromptBuilder();
      const prompt = builder.build({});
      expect(prompt).toBe("");
    });

    it("should build a simple prompt", () => {
      const builder = new PromptBuilder().register({
        name: "test",
        render: () => "Hello, World!",
      });

      const prompt = builder.build({});
      expect(prompt).toBe("Hello, World!");
    });

    it("should join multiple components with double newlines", () => {
      const builder = new PromptBuilder()
        .register({ name: "one", priority: 100, render: () => "First" })
        .register({ name: "two", priority: 50, render: () => "Second" });

      const prompt = builder.build({});
      expect(prompt).toBe("First\n\nSecond");
    });

    it("should sort components by priority (higher first)", () => {
      const builder = new PromptBuilder()
        .register({ name: "low", priority: 10, render: () => "Low" })
        .register({ name: "high", priority: 100, render: () => "High" })
        .register({ name: "medium", priority: 50, render: () => "Medium" });

      const prompt = builder.build({});
      expect(prompt).toBe("High\n\nMedium\n\nLow");
    });

    it("should use default priority of 50", () => {
      const builder = new PromptBuilder()
        .register({ name: "default", render: () => "Default" })
        .register({ name: "high", priority: 100, render: () => "High" })
        .register({ name: "low", priority: 10, render: () => "Low" });

      const prompt = builder.build({});
      expect(prompt).toBe("High\n\nDefault\n\nLow");
    });

    it("should filter components by condition", () => {
      const builder = new PromptBuilder()
        .register({
          name: "conditional",
          condition: (ctx) => ctx.tools !== undefined,
          render: () => "Has tools",
        })
        .register({
          name: "always",
          render: () => "Always shown",
        });

      // Without tools
      const promptWithoutTools = builder.build({});
      expect(promptWithoutTools).toBe("Always shown");

      // With tools
      const promptWithTools = builder.build({ tools: [{ name: "test", description: "Test" }] });
      expect(promptWithTools).toBe("Has tools\n\nAlways shown");
    });

    it("should filter out empty strings", () => {
      const builder = new PromptBuilder()
        .register({ name: "empty", render: () => "" })
        .register({ name: "whitespace", render: () => "   " })
        .register({ name: "content", render: () => "Content" });

      const prompt = builder.build({});
      expect(prompt).toBe("Content");
    });

    it("should pass context to render function", () => {
      const builder = new PromptBuilder().register({
        name: "context-aware",
        render: (ctx) => `Model: ${ctx.model ?? "unknown"}`,
      });

      const prompt = builder.build({ model: "claude-3-5-sonnet" });
      expect(prompt).toBe("Model: claude-3-5-sonnet");
    });
  });
});

describe("Default Components", () => {
  let context: PromptContext;

  beforeEach(() => {
    context = {};
  });

  describe("identityComponent", () => {
    it("should render a basic identity", () => {
      const result = identityComponent.render(context);
      expect(result).toBe("You are a helpful AI assistant.");
    });

    it("should have high priority", () => {
      expect(identityComponent.priority).toBe(100);
    });
  });

  describe("toolsComponent", () => {
    it("should not render when no tools", () => {
      const condition = toolsComponent.condition?.(context);
      expect(condition).toBe(false);
    });

    it("should not render when tools array is empty", () => {
      const condition = toolsComponent.condition?.({ tools: [] });
      expect(condition).toBe(false);
    });

    it("should render tools list", () => {
      const ctx: PromptContext = {
        tools: [
          { name: "read", description: "Read files" },
          { name: "write", description: "Write files" },
        ],
      };

      const result = toolsComponent.render(ctx);
      expect(result).toContain("# Available Tools");
      expect(result).toContain("- **read**: Read files");
      expect(result).toContain("- **write**: Write files");
    });
  });

  describe("skillsComponent", () => {
    it("should not render when no skills", () => {
      const condition = skillsComponent.condition?.(context);
      expect(condition).toBe(false);
    });

    it("should render skills list", () => {
      const ctx: PromptContext = {
        skills: [
          { name: "git", description: "Git operations" },
          { name: "npm", description: "NPM commands" },
        ],
      };

      const result = skillsComponent.render(ctx);
      expect(result).toContain("# Available Skills");
      expect(result).toContain("- **git**: Git operations");
      expect(result).toContain("- **npm**: NPM commands");
    });
  });

  describe("pluginsComponent", () => {
    it("should not render when no plugins", () => {
      const condition = pluginsComponent.condition?.(context);
      expect(condition).toBe(false);
    });

    it("should render plugins list", () => {
      const ctx: PromptContext = {
        plugins: [
          { name: "plugin-a", description: "Plugin A" },
          { name: "plugin-b", description: "Plugin B" },
        ],
      };

      const result = pluginsComponent.render(ctx);
      expect(result).toContain("# Loaded Plugins");
      expect(result).toContain("- **plugin-a**: Plugin A");
      expect(result).toContain("- **plugin-b**: Plugin B");
    });
  });

  describe("capabilitiesComponent", () => {
    it("should render empty string when no capabilities", () => {
      const result = capabilitiesComponent.render(context);
      expect(result).toBe("");
    });

    it("should render execute capability", () => {
      const ctx: PromptContext = {
        backend: {
          type: "filesystem",
          hasExecuteCapability: true,
        },
      };

      const result = capabilitiesComponent.render(ctx);
      expect(result).toContain("# Capabilities");
      expect(result).toContain("Execute shell commands (bash)");
    });

    it("should render filesystem capabilities", () => {
      const ctx: PromptContext = {
        backend: {
          type: "filesystem",
          hasExecuteCapability: false,
          rootDir: "/home/user/project",
        },
      };

      const result = capabilitiesComponent.render(ctx);
      expect(result).toContain("Read and write files to the filesystem");
      expect(result).toContain("Working directory: /home/user/project");
    });

    it("should render state backend capabilities", () => {
      const ctx: PromptContext = {
        backend: {
          type: "state",
          hasExecuteCapability: false,
        },
      };

      const result = capabilitiesComponent.render(ctx);
      expect(result).toContain("In-memory file operations (sandboxed)");
    });
  });

  describe("permissionModeComponent", () => {
    it("should not render when no permission mode", () => {
      const condition = permissionModeComponent.condition?.(context);
      expect(condition).toBe(false);
    });

    it("should render default mode", () => {
      const ctx: PromptContext = { permissionMode: "default" };
      const result = permissionModeComponent.render(ctx);
      expect(result).toContain("Default permission mode");
    });

    it("should render acceptEdits mode", () => {
      const ctx: PromptContext = { permissionMode: "acceptEdits" };
      const result = permissionModeComponent.render(ctx);
      expect(result).toContain("File editing tools are auto-approved");
    });

    it("should render bypassPermissions mode", () => {
      const ctx: PromptContext = { permissionMode: "bypassPermissions" };
      const result = permissionModeComponent.render(ctx);
      expect(result).toContain("All tools are auto-approved");
    });

    it("should render plan mode", () => {
      const ctx: PromptContext = { permissionMode: "plan" };
      const result = permissionModeComponent.render(ctx);
      expect(result).toContain("Plan mode");
    });
  });

  describe("contextComponent", () => {
    it("should not render when no context", () => {
      const condition = contextComponent.condition?.(context);
      expect(condition).toBe(false);
    });

    it("should render thread ID", () => {
      const ctx: PromptContext = { threadId: "thread-123" };
      const result = contextComponent.render(ctx);
      expect(result).toContain("Thread ID: thread-123");
    });

    it("should render message count", () => {
      const ctx: PromptContext = {
        currentMessages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
        ],
      };
      const result = contextComponent.render(ctx);
      expect(result).toContain("Conversation history: 2 message(s)");
    });

    it("should render both thread ID and message count", () => {
      const ctx: PromptContext = {
        threadId: "thread-123",
        currentMessages: [{ role: "user", content: "Hello" }],
      };
      const result = contextComponent.render(ctx);
      expect(result).toContain("Thread ID: thread-123");
      expect(result).toContain("Conversation history: 1 message(s)");
    });
  });
});

describe("createDefaultPromptBuilder", () => {
  it("should create a builder with all default components", () => {
    const builder = createDefaultPromptBuilder();
    const names = builder.getComponentNames();

    expect(names).toContain("identity");
    expect(names).toContain("tools-listing");
    expect(names).toContain("skills-listing");
    expect(names).toContain("plugins-listing");
    expect(names).toContain("capabilities");
    expect(names).toContain("permission-mode");
    expect(names).toContain("context");
  });

  it("should build a complete prompt with all components", () => {
    const builder = createDefaultPromptBuilder();
    const context: PromptContext = {
      tools: [{ name: "read", description: "Read files" }],
      skills: [{ name: "git", description: "Git operations" }],
      plugins: [{ name: "test-plugin", description: "Test plugin" }],
      backend: {
        type: "filesystem",
        hasExecuteCapability: true,
        rootDir: "/home/user",
      },
      permissionMode: "default",
      threadId: "thread-123",
      currentMessages: [{ role: "user", content: "Hello" }],
    };

    const prompt = builder.build(context);

    // Check that all sections are present
    expect(prompt).toContain("You are a helpful AI assistant");
    expect(prompt).toContain("# Available Tools");
    expect(prompt).toContain("# Available Skills");
    expect(prompt).toContain("# Loaded Plugins");
    expect(prompt).toContain("# Capabilities");
    expect(prompt).toContain("# Permission Mode");
    expect(prompt).toContain("# Context");
  });

  it("should be customizable via clone", () => {
    const base = createDefaultPromptBuilder();
    const custom = base
      .clone()
      .unregister("identity")
      .register({
        name: "custom-identity",
        priority: 100,
        render: () => "You are a specialized assistant.",
      });

    const prompt = custom.build({});
    expect(prompt).toContain("You are a specialized assistant");
    expect(prompt).not.toContain("You are a helpful AI assistant");
  });
});

describe("Integration scenarios", () => {
  it("should handle minimal context", () => {
    const builder = createDefaultPromptBuilder();
    const prompt = builder.build({});

    // Should at least have identity
    expect(prompt).toContain("You are a helpful AI assistant");
  });

  it("should handle rich context", () => {
    const builder = createDefaultPromptBuilder();
    const context: PromptContext = {
      tools: [
        { name: "read", description: "Read files" },
        { name: "write", description: "Write files" },
        { name: "bash", description: "Execute commands" },
      ],
      skills: [
        { name: "git", description: "Git operations" },
        { name: "npm", description: "NPM package management" },
      ],
      plugins: [{ name: "mcp-filesystem", description: "MCP filesystem plugin" }],
      backend: {
        type: "filesystem",
        hasExecuteCapability: true,
        rootDir: "/home/user/project",
      },
      model: "claude-3-5-sonnet-20241022",
      maxSteps: 10,
      permissionMode: "default",
      threadId: "session-abc123",
      currentMessages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi! How can I help?" },
        { role: "user", content: "Read package.json" },
      ],
    };

    const prompt = builder.build(context);

    // Verify structure
    const sections = prompt.split("\n\n");
    expect(sections.length).toBeGreaterThan(3);

    // Verify content
    expect(prompt).toContain("read");
    expect(prompt).toContain("git");
    expect(prompt).toContain("mcp-filesystem");
    expect(prompt).toContain("Execute shell commands");
    expect(prompt).toContain("session-abc123");
  });

  it("should respect component priorities", () => {
    const builder = new PromptBuilder()
      .register({ name: "low", priority: 10, render: () => "LOW" })
      .register({ name: "high", priority: 100, render: () => "HIGH" })
      .register({ name: "mid", priority: 50, render: () => "MID" });

    const prompt = builder.build({});
    const index = { high: -1, mid: -1, low: -1 };

    index.high = prompt.indexOf("HIGH");
    index.mid = prompt.indexOf("MID");
    index.low = prompt.indexOf("LOW");

    expect(index.high).toBeLessThan(index.mid);
    expect(index.mid).toBeLessThan(index.low);
  });
});
