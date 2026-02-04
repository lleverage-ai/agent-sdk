/**
 * Tests for the tool factory.
 */

import type { LanguageModel } from "ai";
import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FilesystemBackend } from "../src/backends/filesystem.js";
import { type AgentState, createAgentState, StateBackend } from "../src/backends/state.js";
import {
  type CoreTools,
  type CoreToolsOptions,
  coreToolsToToolSet,
  createCoreTools,
  createFilesystemToolsOnly,
} from "../src/tools/factory.js";
import { defineLoadableSkill, SkillRegistry } from "../src/tools/skills.js";
import type { Agent, SkillDefinition, SubagentDefinition } from "../src/types.js";

// =============================================================================
// Mocks
// =============================================================================

// Mock AI SDK's generateText
vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({
      text: "Mock response",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 20 },
      steps: [],
    }),
  };
});

function createMockModel(): LanguageModel {
  return {
    specificationVersion: "v1",
    provider: "test",
    modelId: "test-model",
    defaultObjectGenerationMode: "json",
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  } as unknown as LanguageModel;
}

function createMockAgent(): Agent {
  const model = createMockModel();
  return {
    id: "test-agent",
    options: { model },
    backend: new StateBackend(createAgentState()),
    state: createAgentState(),
    generate: vi.fn().mockResolvedValue({
      status: "complete",
      text: "Mock response",
      finishReason: "stop",
      steps: [],
    }),
    stream: vi.fn(),
    streamResponse: vi.fn(),
    streamRaw: vi.fn(),
    getSkills: vi.fn().mockReturnValue([]),
  };
}

function createMockSubagentDefinition(type: string): SubagentDefinition {
  return {
    type,
    description: `${type} subagent`,
    create: () => createMockAgent(),
  };
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestOptions(overrides?: Partial<CoreToolsOptions>): CoreToolsOptions {
  const state = createAgentState();
  const backend = new StateBackend(state);
  return {
    backend,
    state,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("createCoreTools", () => {
  describe("basic creation", () => {
    it("creates filesystem tools by default", () => {
      const { tools } = createCoreTools(createTestOptions());

      expect(tools.read).toBeDefined();
      expect(tools.write).toBeDefined();
      expect(tools.edit).toBeDefined();
      expect(tools.glob).toBeDefined();
      expect(tools.grep).toBeDefined();
    });

    it("creates todo_write tool by default", () => {
      const { tools } = createCoreTools(createTestOptions());

      expect(tools.todo_write).toBeDefined();
    });

    it("does not create bash tool without execute-capable backend", () => {
      const { tools } = createCoreTools(createTestOptions());

      expect(tools.bash).toBeUndefined();
    });

    it("does not create skill tool without registry", () => {
      const { tools, skillRegistry } = createCoreTools(createTestOptions());

      expect(tools.skill).toBeUndefined();
      expect(skillRegistry).toBeUndefined();
    });

    it("does not create task tool without subagents", () => {
      const { tools } = createCoreTools(createTestOptions());

      expect(tools.task).toBeUndefined();
    });
  });

  describe("filesystem tool options", () => {
    it("excludes write when disabled", () => {
      const { tools } = createCoreTools(createTestOptions({ includeWrite: false }));

      expect(tools.write).toBeUndefined();
      expect(tools.edit).toBeDefined();
    });

    it("excludes edit when disabled", () => {
      const { tools } = createCoreTools(createTestOptions({ includeEdit: false }));

      expect(tools.write).toBeDefined();
      expect(tools.edit).toBeUndefined();
    });

    it("excludes both write and edit when disabled", () => {
      const { tools } = createCoreTools(
        createTestOptions({
          includeWrite: false,
          includeEdit: false,
        }),
      );

      expect(tools.write).toBeUndefined();
      expect(tools.edit).toBeUndefined();
      expect(tools.read).toBeDefined();
      expect(tools.glob).toBeDefined();
      expect(tools.grep).toBeDefined();
    });
  });

  describe("todo tool options", () => {
    it("excludes todo_write when disabled", () => {
      const { tools } = createCoreTools(createTestOptions({ includeTodoWrite: false }));

      expect(tools.todo_write).toBeUndefined();
    });
  });

  describe("bash tool with execute-capable backend", () => {
    it("creates bash tool when backend has execute capability", () => {
      const backend = new FilesystemBackend({
        rootDir: process.cwd(),
        enableBash: true,
        timeout: 1000,
      });
      const state = createAgentState();

      const { tools } = createCoreTools({
        backend,
        state,
      });

      expect(tools.bash).toBeDefined();
    });

    it("does not create bash tool when backend lacks execute capability", () => {
      // StateBackend doesn't have execute capability
      const state = createAgentState();
      const backend = new StateBackend(state);

      const { tools } = createCoreTools({
        backend,
        state,
      });

      expect(tools.bash).toBeUndefined();
    });

    it("passes bash options to the tool", () => {
      const backend = new FilesystemBackend({
        rootDir: process.cwd(),
        enableBash: true,
        timeout: 1000,
      });
      const state = createAgentState();

      const { tools } = createCoreTools({
        backend,
        state,
        bashOptions: {
          blockedCommands: ["rm"],
        },
      });

      expect(tools.bash).toBeDefined();
    });
  });

  describe("skill tool with registry", () => {
    it("creates skill tool when registry provided", () => {
      const providedRegistry = new SkillRegistry();

      const { tools, skillRegistry } = createCoreTools(
        createTestOptions({
          skillRegistry: providedRegistry,
        }),
      );

      expect(tools.skill).toBeDefined();
      expect(skillRegistry).toBe(providedRegistry);
    });

    it("passes skill tool options", () => {
      const providedRegistry = new SkillRegistry({
        skills: [
          defineLoadableSkill({
            name: "test-skill",
            description: "A test skill",
            tools: {},
            prompt: "Test prompt",
          }),
        ],
      });

      const { tools } = createCoreTools(
        createTestOptions({
          skillRegistry: providedRegistry,
          skillToolOptions: {
            descriptionPrefix: "Custom prefix",
          },
        }),
      );

      expect(tools.skill).toBeDefined();
    });
  });

  describe("task tool with subagents", () => {
    it("creates task tool when subagents, parentAgent, and defaultModel provided", () => {
      const parentAgent = createMockAgent();
      const defaultModel = createMockModel();

      const { tools } = createCoreTools(
        createTestOptions({
          subagents: [createMockSubagentDefinition("researcher")],
          parentAgent,
          defaultModel,
        }),
      );

      expect(tools.task).toBeDefined();
    });

    it("does not create task tool when subagents empty", () => {
      const parentAgent = createMockAgent();
      const defaultModel = createMockModel();

      const { tools } = createCoreTools(
        createTestOptions({
          subagents: [],
          parentAgent,
          defaultModel,
        }),
      );

      expect(tools.task).toBeUndefined();
    });

    it("does not create task tool when parentAgent missing", () => {
      const defaultModel = createMockModel();

      const { tools } = createCoreTools(
        createTestOptions({
          subagents: [createMockSubagentDefinition("researcher")],
          defaultModel,
        }),
      );

      expect(tools.task).toBeUndefined();
    });

    it("does not create task tool when defaultModel missing", () => {
      const parentAgent = createMockAgent();

      const { tools } = createCoreTools(
        createTestOptions({
          subagents: [createMockSubagentDefinition("researcher")],
          parentAgent,
        }),
      );

      expect(tools.task).toBeUndefined();
    });

    it("includes general-purpose subagent when enabled", () => {
      const parentAgent = createMockAgent();
      const defaultModel = createMockModel();

      const { tools } = createCoreTools(
        createTestOptions({
          subagents: [createMockSubagentDefinition("researcher")],
          parentAgent,
          defaultModel,
          includeGeneralPurpose: true,
        }),
      );

      expect(tools.task).toBeDefined();
      // The task tool description should include general-purpose
      expect(tools.task?.description).toContain("general-purpose");
    });
  });

  describe("tool functionality", () => {
    it("filesystem tools work with state backend", async () => {
      const state = createAgentState();
      const backend = new StateBackend(state);
      const { tools } = createCoreTools({ backend, state });

      // Write a file using the tool
      const writeResult = await tools.write?.execute?.(
        { file_path: "/test.txt", content: "Hello World" },
        {} as any,
      );

      expect(writeResult).toContain("Successfully wrote");

      // Read it back
      const readResult = await tools.read?.execute?.({ file_path: "/test.txt" }, {} as any);

      expect(readResult).toContain("Hello World");
    });

    it("todo_write tool works with shared state", async () => {
      const state = createAgentState();
      const backend = new StateBackend(state);
      const { tools } = createCoreTools({ backend, state });

      // Write todos
      const writeResult = await tools.todo_write?.execute?.(
        {
          todos: [
            { content: "Task 1", status: "pending" },
            { content: "Task 2", status: "in_progress" },
          ],
        },
        {} as any,
      );

      expect(writeResult).toEqual({
        success: true,
        count: 2,
        summary: { pending: 1, inProgress: 1, completed: 0 },
      });

      // Verify state was updated
      expect(state.todos.length).toBe(2);
    });

    it("skill tool loads skills from registry", async () => {
      const state = createAgentState();
      const backend = new StateBackend(state);

      const skillRegistry = new SkillRegistry({
        skills: [
          defineLoadableSkill({
            name: "test-skill",
            description: "A test skill",
            tools: {
              test_tool: tool({
                description: "Test tool",
                inputSchema: z.object({}),
                execute: async () => "test result",
              }),
            },
            prompt: "Test instructions",
          }),
        ],
      });

      const { tools } = createCoreTools({ backend, state, skillRegistry });

      // Load the skill
      const result = await tools.skill?.execute?.({ skill_name: "test-skill" }, {} as any);

      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("skill", "test-skill");
      expect(result).toHaveProperty("newTools");
      expect((result as any).newTools).toContain("test_tool");
    });
  });
});

describe("convenience factories", () => {
  describe("createFilesystemToolsOnly", () => {
    it("creates only filesystem tools", () => {
      const state = createAgentState();
      const backend = new StateBackend(state);

      const tools = createFilesystemToolsOnly({ backend });

      expect(tools.read).toBeDefined();
      expect(tools.write).toBeDefined();
      expect(tools.edit).toBeDefined();
      expect(tools.glob).toBeDefined();
      expect(tools.grep).toBeDefined();
    });

    it("respects includeWrite option", () => {
      const state = createAgentState();
      const backend = new StateBackend(state);

      const tools = createFilesystemToolsOnly({
        backend,
        includeWrite: false,
      });

      expect(tools.write).toBeUndefined();
    });

    it("respects includeEdit option", () => {
      const state = createAgentState();
      const backend = new StateBackend(state);

      const tools = createFilesystemToolsOnly({
        backend,
        includeEdit: false,
      });

      expect(tools.edit).toBeUndefined();
    });
  });
});

describe("tool integration", () => {
  it("all tools can be spread into an agent", () => {
    const state = createAgentState();
    const backend = new FilesystemBackend({
      rootDir: process.cwd(),
      enableBash: true,
      timeout: 1000,
    });
    const providedRegistry = new SkillRegistry();
    const parentAgent = createMockAgent();
    const defaultModel = createMockModel();

    const { tools } = createCoreTools({
      backend,
      state,
      skillRegistry: providedRegistry,
      subagents: [createMockSubagentDefinition("researcher")],
      parentAgent,
      defaultModel,
    });

    // All properties should be tools
    for (const [_name, tool] of Object.entries(tools)) {
      if (tool !== undefined) {
        expect(tool).toHaveProperty("execute");
        expect(tool).toHaveProperty("inputSchema");
      }
    }
  });

  it("tools work together in a workflow", async () => {
    const state = createAgentState();
    const backend = new StateBackend(state);

    const { tools } = createCoreTools({ backend, state });

    // 1. Create todos
    await tools.todo_write?.execute?.(
      { todos: [{ content: "Write documentation", status: "pending" }] },
      {} as any,
    );

    // 2. Write a file
    await tools.write?.execute?.(
      { file_path: "/README.md", content: "# My Project\n\nDocumentation here." },
      {} as any,
    );

    // 3. Search for the file
    const searchResult = await tools.grep?.execute?.({ pattern: "Documentation" }, {} as any);

    expect(searchResult).toContain("README.md");

    // 4. Update todos to completed
    await tools.todo_write?.execute?.(
      { todos: [{ content: "Write documentation", status: "completed" }] },
      {} as any,
    );

    // 5. Verify state
    expect(state.todos[0].status).toBe("completed");
  });
});

describe("disabled option", () => {
  it("disables specified tools via disabled array", () => {
    const { tools } = createCoreTools(
      createTestOptions({
        disabled: ["write", "edit", "bash"],
      }),
    );

    expect(tools.read).toBeDefined();
    expect(tools.glob).toBeDefined();
    expect(tools.grep).toBeDefined();
    expect(tools.write).toBeUndefined();
    expect(tools.edit).toBeUndefined();
    expect(tools.bash).toBeUndefined();
  });

  it("disabled takes precedence over include options", () => {
    const { tools } = createCoreTools(
      createTestOptions({
        disabled: ["write"],
        includeWrite: true, // This should be overridden by disabled
      }),
    );

    expect(tools.write).toBeUndefined();
  });

  it("can disable all filesystem tools", () => {
    const { tools } = createCoreTools(
      createTestOptions({
        disabled: ["read", "write", "edit", "glob", "grep"],
      }),
    );

    expect(tools.read).toBeUndefined();
    expect(tools.write).toBeUndefined();
    expect(tools.edit).toBeUndefined();
    expect(tools.glob).toBeUndefined();
    expect(tools.grep).toBeUndefined();
    expect(tools.todo_write).toBeDefined();
  });

  it("can disable todo_write", () => {
    const { tools } = createCoreTools(
      createTestOptions({
        disabled: ["todo_write"],
      }),
    );

    expect(tools.todo_write).toBeUndefined();
    expect(tools.read).toBeDefined();
  });

  it("can disable skill tool", () => {
    const providedRegistry = new SkillRegistry();

    const { tools, skillRegistry } = createCoreTools(
      createTestOptions({
        skillRegistry: providedRegistry,
        disabled: ["skill"],
      }),
    );

    expect(tools.skill).toBeUndefined();
    expect(skillRegistry).toBeUndefined();
  });
});

describe("skills option (alternative to skillRegistry)", () => {
  it("creates skill tool from skills array", () => {
    const skills: SkillDefinition[] = [
      {
        name: "git-skill",
        description: "Git operations",
        prompt: "Git instructions",
        tools: {
          git_status: tool({
            description: "Get git status",
            inputSchema: z.object({}),
            execute: async () => "clean",
          }),
        },
      },
    ];

    const { tools, skillRegistry } = createCoreTools(
      createTestOptions({
        skills,
      }),
    );

    expect(tools.skill).toBeDefined();
    expect(skillRegistry).toBeDefined();
  });

  it("ignores skills without tools", () => {
    const skills: SkillDefinition[] = [
      {
        name: "prompt-only-skill",
        description: "Just a prompt",
        prompt: "Instructions only",
        // No tools defined
      },
    ];

    const { tools, skillRegistry } = createCoreTools(
      createTestOptions({
        skills,
      }),
    );

    expect(tools.skill).toBeUndefined();
    expect(skillRegistry).toBeUndefined();
  });

  it("skillRegistry takes precedence over skills array", () => {
    const existingRegistry = new SkillRegistry({
      skills: [
        defineLoadableSkill({
          name: "existing-skill",
          description: "From registry",
          tools: {},
          prompt: "Existing",
        }),
      ],
    });

    const skills: SkillDefinition[] = [
      {
        name: "array-skill",
        description: "From array",
        prompt: "Array",
        tools: {
          some_tool: tool({
            description: "Tool",
            inputSchema: z.object({}),
            execute: async () => "result",
          }),
        },
      },
    ];

    const { skillRegistry } = createCoreTools(
      createTestOptions({
        skillRegistry: existingRegistry,
        skills,
      }),
    );

    // Should use the provided registry, not create from skills array
    expect(skillRegistry).toBe(existingRegistry);
  });
});

describe("coreToolsToToolSet", () => {
  it("converts CoreTools to ToolSet", () => {
    const { tools } = createCoreTools(createTestOptions());

    const toolSet = coreToolsToToolSet(tools);

    // Should have tools but not skillRegistry
    expect(toolSet.read).toBeDefined();
    expect(toolSet.write).toBeDefined();
    expect(toolSet.edit).toBeDefined();
    expect(toolSet.glob).toBeDefined();
    expect(toolSet.grep).toBeDefined();
    expect(toolSet.todo_write).toBeDefined();
    expect("skillRegistry" in toolSet).toBe(false);
  });

  it("filters out undefined tools", () => {
    const { tools } = createCoreTools(
      createTestOptions({
        includeWrite: false,
        includeEdit: false,
      }),
    );

    const toolSet = coreToolsToToolSet(tools);

    expect(toolSet.read).toBeDefined();
    expect(toolSet.write).toBeUndefined();
    expect(toolSet.edit).toBeUndefined();
    // Should only contain defined tools
    const keys = Object.keys(toolSet);
    expect(keys).not.toContain("write");
    expect(keys).not.toContain("edit");
  });

  it("works with all tools enabled", () => {
    const state = createAgentState();
    const backend = new FilesystemBackend({
      rootDir: process.cwd(),
      enableBash: true,
      timeout: 1000,
    });
    const providedRegistry = new SkillRegistry();
    const parentAgent = createMockAgent();
    const defaultModel = createMockModel();

    const { tools } = createCoreTools({
      backend,
      state,
      skillRegistry: providedRegistry,
      subagents: [createMockSubagentDefinition("researcher")],
      parentAgent,
      defaultModel,
    });

    const toolSet = coreToolsToToolSet(tools);

    // All tools should be in the toolSet
    expect(toolSet.read).toBeDefined();
    expect(toolSet.write).toBeDefined();
    expect(toolSet.edit).toBeDefined();
    expect(toolSet.glob).toBeDefined();
    expect(toolSet.grep).toBeDefined();
    expect(toolSet.todo_write).toBeDefined();
    expect(toolSet.bash).toBeDefined();
    expect(toolSet.skill).toBeDefined();
    expect(toolSet.task).toBeDefined();

    // skillRegistry should not be in toolSet
    expect("skillRegistry" in toolSet).toBe(false);
  });
});

describe("type exports", () => {
  it("exports CoreToolsOptions type", () => {
    // This test verifies the type is exported correctly
    const options: CoreToolsOptions = {
      backend: new StateBackend(createAgentState()),
      state: createAgentState(),
    };
    expect(options).toBeDefined();
  });

  it("exports CoreTools type", () => {
    const tools: CoreTools = {} as CoreTools;
    expect(tools).toBeDefined();
  });
});
