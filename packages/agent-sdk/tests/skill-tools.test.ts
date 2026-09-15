/**
 * Tests for the skill tool system.
 *
 * @packageDocumentation
 */

import { asSchema, tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createSkillRegistry,
  createSkillTool,
  DEFAULT_SKILL_CONTINUATION_INSTRUCTION,
  type SkillDefinition,
  SkillRegistry,
  toSkillRuntimeName,
} from "../src/tools/skills.js";

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a simple test skill.
 */
function createTestSkill(
  name: string,
  description: string,
  options?: Partial<SkillDefinition>,
): SkillDefinition {
  return {
    name,
    description,
    tools: {
      [`${name}_tool`]: tool({
        description: `Test tool for ${name}`,
        inputSchema: z.object({ input: z.string() }),
        execute: async ({ input }) => `${name}: ${input}`,
      }),
    },
    instructions: `You have loaded the ${name} skill.`,
    ...options,
  };
}

// =============================================================================
// SkillRegistry Tests
// =============================================================================

describe("SkillRegistry", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe("constructor", () => {
    it("should create empty registry", () => {
      expect(registry.size).toBe(0);
      expect(registry.loadedCount).toBe(0);
    });

    it("should accept initial skills", () => {
      const skill = createTestSkill("test", "Test skill");
      const reg = new SkillRegistry({ skills: [skill] });

      expect(reg.size).toBe(1);
      expect(reg.has("test")).toBe(true);
    });

    it("should accept onSkillLoaded callback", () => {
      const callback = vi.fn();
      const skill = createTestSkill("test", "Test skill");
      const reg = new SkillRegistry({
        skills: [skill],
        onSkillLoaded: callback,
      });

      reg.load("test");
      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith("test", expect.objectContaining({ success: true }));
    });
  });

  describe("register", () => {
    it("should register a skill", () => {
      const skill = createTestSkill("git", "Git operations");
      registry.register(skill);

      expect(registry.has("git")).toBe(true);
      expect(registry.size).toBe(1);
    });

    it("should throw on duplicate registration", () => {
      const skill = createTestSkill("git", "Git operations");
      registry.register(skill);

      expect(() => registry.register(skill)).toThrow("Skill 'git' is already registered");
    });
  });

  describe("unregister", () => {
    it("should unregister a skill", () => {
      const skill = createTestSkill("git", "Git operations");
      registry.register(skill);

      expect(registry.unregister("git")).toBe(true);
      expect(registry.has("git")).toBe(false);
    });

    it("should return false for non-existent skill", () => {
      expect(registry.unregister("nonexistent")).toBe(false);
    });

    it("should also unload the skill", () => {
      const skill = createTestSkill("git", "Git operations");
      registry.register(skill);
      registry.load("git");

      expect(registry.isLoaded("git")).toBe(true);
      registry.unregister("git");
      expect(registry.isLoaded("git")).toBe(false);
    });
  });

  describe("has", () => {
    it("should return true for registered skills", () => {
      const skill = createTestSkill("git", "Git operations");
      registry.register(skill);

      expect(registry.has("git")).toBe(true);
    });

    it("should return false for unregistered skills", () => {
      expect(registry.has("nonexistent")).toBe(false);
    });
  });

  describe("get", () => {
    it("should return skill definition", () => {
      const skill = createTestSkill("git", "Git operations");
      registry.register(skill);

      const retrieved = registry.get("git");
      expect(retrieved).toEqual(skill);
    });

    it("should return undefined for non-existent skill", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("getLoaded", () => {
    it("should return retained loaded-skill metadata", () => {
      const skill = createTestSkill("git", "Git operations");
      registry.register(skill);
      registry.load("git");

      expect(registry.getLoaded("git")).toEqual({
        name: "git",
        description: "Git operations",
        instructions: "You have loaded the git skill.",
      });
    });

    it("should return a defensive copy of retained loaded-skill metadata", () => {
      const skill = createTestSkill("git", "Git operations");
      registry.register(skill);
      registry.load("git");

      const loaded = registry.getLoaded("git");
      expect(loaded).toBeDefined();

      if (!loaded) {
        throw new Error("Expected loaded skill metadata");
      }

      loaded.instructions = "Mutated";

      expect(registry.getLoaded("git")).toEqual({
        name: "git",
        description: "Git operations",
        instructions: "You have loaded the git skill.",
      });
    });

    it("should resolve and retain function-backed instructions with args", () => {
      const skill: SkillDefinition = {
        name: "review",
        description: "Code review",
        tools: {},
        instructions: (args) => `Review target: ${args ?? "all files"}`,
      };
      registry.register(skill);
      registry.load("review", "src/index.ts");

      expect(registry.getLoaded("review")).toEqual({
        name: "review",
        description: "Code review",
        instructions: "Review target: src/index.ts",
      });
      expect(registry.listLoadedDetails()).toContainEqual({
        name: "review",
        description: "Code review",
        instructions: "Review target: src/index.ts",
      });
    });

    it("should return undefined when the skill has not been loaded", () => {
      registry.register(createTestSkill("git", "Git operations"));
      expect(registry.getLoaded("git")).toBeUndefined();
    });
  });

  describe("load", () => {
    it("should load a skill successfully", () => {
      const skill = createTestSkill("git", "Git operations");
      registry.register(skill);

      const result = registry.load("git");

      expect(result.success).toBe(true);
      expect(result.tools).toHaveProperty("git_tool");
      expect(result.instructions).toBe("You have loaded the git skill.");
    });

    it("should mark skill as loaded", () => {
      const skill = createTestSkill("git", "Git operations");
      registry.register(skill);
      registry.load("git");

      expect(registry.isLoaded("git")).toBe(true);
    });

    it("should return error for non-existent skill", () => {
      const result = registry.load("nonexistent");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Skill 'nonexistent' not found");
    });

    it("should not duplicate load already loaded skills", () => {
      const skill = createTestSkill("git", "Git operations");
      registry.register(skill);

      registry.load("git");
      const result = registry.load("git");

      expect(result.success).toBe(true);
      expect(result.error).toContain("already loaded");
      expect(Object.keys(result.tools)).toHaveLength(0);
    });

    it("should support prompt as function", () => {
      const skill: SkillDefinition = {
        name: "review",
        description: "Code review",
        tools: {},
        instructions: (args) => `Reviewing: ${args ?? "all files"}`,
      };
      registry.register(skill);

      const result = registry.load("review", "src/index.ts");

      expect(result.instructions).toBe("Reviewing: src/index.ts");
    });

    it("should support prompt function with no args", () => {
      const skill: SkillDefinition = {
        name: "review",
        description: "Code review",
        tools: {},
        instructions: (args) => `Reviewing: ${args ?? "all files"}`,
      };
      registry.register(skill);

      const result = registry.load("review");

      expect(result.instructions).toBe("Reviewing: all files");
    });
  });

  describe("listAvailable", () => {
    it("should list unloaded skills", () => {
      registry.register(createTestSkill("git", "Git operations"));
      registry.register(createTestSkill("docker", "Docker operations"));

      const available = registry.listAvailable();

      expect(available).toHaveLength(2);
      expect(available.map((s) => s.name)).toContain("git");
      expect(available.map((s) => s.name)).toContain("docker");
    });

    it("should not include loaded skills", () => {
      registry.register(createTestSkill("git", "Git operations"));
      registry.register(createTestSkill("docker", "Docker operations"));
      registry.load("git");

      const available = registry.listAvailable();

      expect(available).toHaveLength(1);
      expect(available[0].name).toBe("docker");
    });

    it("should return empty array if all loaded", () => {
      registry.register(createTestSkill("git", "Git operations"));
      registry.load("git");

      expect(registry.listAvailable()).toHaveLength(0);
    });
  });

  describe("listLoaded", () => {
    it("should list loaded skills", () => {
      registry.register(createTestSkill("git", "Git operations"));
      registry.register(createTestSkill("docker", "Docker operations"));
      registry.load("git");

      const loaded = registry.listLoaded();

      expect(loaded).toEqual(["git"]);
    });

    it("should return empty array if none loaded", () => {
      registry.register(createTestSkill("git", "Git operations"));

      expect(registry.listLoaded()).toHaveLength(0);
    });
  });

  describe("listLoadedDetails", () => {
    it("should list loaded skills with retained instructions", () => {
      registry.register(createTestSkill("git", "Git operations"));
      registry.load("git");

      expect(registry.listLoadedDetails()).toEqual([
        {
          name: "git",
          description: "Git operations",
          instructions: "You have loaded the git skill.",
        },
      ]);
    });

    it("should store rendered instructions instead of function references", () => {
      const skill: SkillDefinition = {
        name: "review",
        description: "Code review",
        tools: {},
        instructions: (args) => `Review target: ${args ?? "all files"}`,
      };
      registry.register(skill);
      registry.load("review", "src/index.ts");

      expect(registry.listLoadedDetails()).toEqual([
        {
          name: "review",
          description: "Code review",
          instructions: "Review target: src/index.ts",
        },
      ]);
    });
  });

  describe("listAll", () => {
    it("should list all skills with loaded status", () => {
      registry.register(createTestSkill("git", "Git operations"));
      registry.register(createTestSkill("docker", "Docker operations"));
      registry.load("git");

      const all = registry.listAll();

      expect(all).toHaveLength(2);
      expect(all.find((s) => s.name === "git")?.loaded).toBe(true);
      expect(all.find((s) => s.name === "docker")?.loaded).toBe(false);
    });
  });

  describe("reset", () => {
    it("should reset loaded state", () => {
      registry.register(createTestSkill("git", "Git operations"));
      registry.load("git");

      registry.reset();

      expect(registry.isLoaded("git")).toBe(false);
      expect(registry.has("git")).toBe(true); // Still registered
    });
  });
});

// =============================================================================
// createSkillTool Tests
// =============================================================================

describe("createSkillTool", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry({
      skills: [
        createTestSkill("git", "Git version control"),
        createTestSkill("docker", "Docker container operations"),
      ],
    });
  });

  it("should create a valid AI SDK tool", () => {
    const skillTool = createSkillTool({ registry });

    expect(skillTool).toHaveProperty("inputSchema");
    expect(skillTool).toHaveProperty("description");
    expect(skillTool).toHaveProperty("execute");
  });

  it("should have description listing available skills", () => {
    const skillTool = createSkillTool({ registry });

    expect(skillTool.description).toContain("git");
    expect(skillTool.description).toContain("docker");
    expect(skillTool.description).toContain("Git version control");
  });

  it("should load skill when executed", async () => {
    const skillTool = createSkillTool({ registry });

    const result = await skillTool.execute({ skill_name: "git" });

    expect(result).toHaveProperty("success", true);
    expect(result).toHaveProperty("skill", "git");
    expect(result).toHaveProperty("newTools");
    expect(result).toHaveProperty("instructions");
    expect(result).toHaveProperty("content");
    expect((result as { content: string }).content).toContain('<skill_content name="git">');
  });

  it("should return tool names in response", async () => {
    const skillTool = createSkillTool({ registry });

    const result = (await skillTool.execute({ skill_name: "git" })) as {
      newTools: string[];
    };

    expect(result.newTools).toContain("git_tool");
  });

  it("should return error for non-existent skill", async () => {
    const skillTool = createSkillTool({ registry });

    const result = (await skillTool.execute({
      skill_name: "nonexistent",
    })) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("should pass args to skill", async () => {
    const skillWithArgs: SkillDefinition = {
      name: "review",
      description: "Code review",
      tools: {},
      instructions: (args) => `Review target: ${args}`,
    };
    registry.register(skillWithArgs);

    const skillTool = createSkillTool({ registry });
    const result = (await skillTool.execute({
      skill_name: "review",
      args: "src/",
    })) as { instructions: string };

    expect(result.instructions).toContain("Review target: src/");
  });

  it("should use custom description prefix", () => {
    const skillTool = createSkillTool({
      registry,
      descriptionPrefix: "Custom prefix for loading skills.",
    });

    expect(skillTool.description).toContain("Custom prefix");
  });

  it("should handle skills with no tools", async () => {
    const promptOnly: SkillDefinition = {
      name: "guidelines",
      description: "Coding guidelines",
      tools: {},
      instructions: "Follow these guidelines...",
    };
    registry.register(promptOnly);

    const skillTool = createSkillTool({ registry });
    const result = (await skillTool.execute({ skill_name: "guidelines" })) as {
      message: string;
    };

    expect(result.message).toContain("instructions only, no new tools");
  });

  describe("continuation instruction", () => {
    it("appends the default continuation instruction to load results", async () => {
      const skillTool = createSkillTool({ registry });
      const result = (await skillTool.execute({ skill_name: "git" })) as { message: string };

      expect(result.message).toContain("New tools available: git_tool.");
      expect(result.message).toContain(DEFAULT_SKILL_CONTINUATION_INSTRUCTION);
    });

    it("appends the continuation instruction to instructions-only load results", async () => {
      registry.register({
        name: "guidelines",
        description: "Coding guidelines",
        instructions: "Follow these guidelines...",
      });

      const skillTool = createSkillTool({ registry });
      const result = (await skillTool.execute({ skill_name: "guidelines" })) as {
        message: string;
      };

      expect(result.message).toContain("(provides instructions only, no new tools).");
      expect(result.message).toContain(DEFAULT_SKILL_CONTINUATION_INSTRUCTION);
    });

    it("uses a custom continuation instruction", async () => {
      const skillTool = createSkillTool({
        registry,
        continuationInstruction: "Keep going.",
      });
      const result = (await skillTool.execute({ skill_name: "git" })) as { message: string };

      expect(result.message).toBe("Loaded skill 'git'. New tools available: git_tool. Keep going.");
    });

    it("omits the continuation instruction when disabled", async () => {
      const skillTool = createSkillTool({ registry, continuationInstruction: false });
      const result = (await skillTool.execute({ skill_name: "git" })) as { message: string };

      expect(result.message).toBe("Loaded skill 'git'. New tools available: git_tool");
      expect(result.message).not.toContain(DEFAULT_SKILL_CONTINUATION_INSTRUCTION);
    });
  });

  describe("args input schema", () => {
    // The tool uses a lazy `() => Schema` so the AI SDK re-evaluates it per
    // request; resolve it the same way the SDK does.
    const schemaKeys = async (skillTool: ReturnType<typeof createSkillTool>): Promise<string[]> => {
      const json = (await asSchema(skillTool.inputSchema).jsonSchema) as {
        properties?: Record<string, unknown>;
      };
      return Object.keys(json.properties ?? {});
    };

    it("does not advertise args when no skill consumes them", async () => {
      // Both test skills have static string instructions.
      const skillTool = createSkillTool({ registry });

      expect(await schemaKeys(skillTool)).toEqual(["skill_name"]);
    });

    it("advertises args when at least one skill has function instructions", async () => {
      registry.register({
        name: "review",
        description: "Code review",
        instructions: (args) => `Review target: ${args}`,
      });

      const skillTool = createSkillTool({ registry });

      expect(await schemaKeys(skillTool)).toEqual(["skill_name", "args"]);
    });

    it("reflects skills registered after the tool was created", async () => {
      const skillTool = createSkillTool({ registry });
      expect(await schemaKeys(skillTool)).toEqual(["skill_name"]);

      registry.register({
        name: "review",
        description: "Code review",
        instructions: (args) => `Review target: ${args}`,
      });

      expect(await schemaKeys(skillTool)).toEqual(["skill_name", "args"]);

      // Validation goes through the same lazy schema, so the late-registered
      // skill receives its args instead of having them stripped.
      const validated = await asSchema(skillTool.inputSchema).validate?.({
        skill_name: "review",
        args: "src/agent.ts",
      });
      expect(validated).toEqual({
        success: true,
        value: { skill_name: "review", args: "src/agent.ts" },
      });

      const result = (await skillTool.execute?.(
        { skill_name: "review", args: "src/agent.ts" },
        { toolCallId: "c", messages: [] },
      )) as { instructions?: string };
      expect(result.instructions).toBe("Review target: src/agent.ts");
    });
  });

  describe("discoverable", () => {
    it("hides non-discoverable skills from the tool description", () => {
      registry.register({
        name: "hidden",
        description: "Only when the user asks",
        discoverable: false,
        instructions: "Hidden instructions",
      });

      const skillTool = createSkillTool({ registry });

      expect(skillTool.description).toContain("git");
      expect(skillTool.description).not.toContain("hidden");
      expect(skillTool.description).not.toContain("Only when the user asks");
    });

    it("still loads non-discoverable skills by name", async () => {
      registry.register({
        name: "hidden",
        description: "Only when the user asks",
        discoverable: false,
        instructions: "Hidden instructions",
      });

      const skillTool = createSkillTool({ registry });
      const result = (await skillTool.execute({ skill_name: "hidden" })) as {
        success: boolean;
        instructions: string;
      };

      expect(result.success).toBe(true);
      expect(result.instructions).toBe("Hidden instructions");
    });

    it("explains that explicit-only skills remain loadable when nothing is discoverable", () => {
      const explicitOnly = new SkillRegistry({
        skills: [
          {
            name: "hidden",
            description: "Only when the user asks",
            discoverable: false,
            instructions: "Hidden instructions",
          },
        ],
      });

      const skillTool = createSkillTool({ registry: explicitOnly });

      expect(skillTool.description).toContain("No skills are listed for automatic discovery");
      expect(skillTool.description).toContain("can still be loaded by name");
      expect(skillTool.description).not.toBe("No skills available to load.");
    });

    it("reports no skills when the registry is empty", () => {
      const skillTool = createSkillTool({ registry: new SkillRegistry() });

      expect(skillTool.description).toBe("No skills available to load.");
    });
  });
});

// =============================================================================
// Runtime Name Tests
// =============================================================================

describe("toSkillRuntimeName", () => {
  it("slugifies display names", () => {
    expect(toSkillRuntimeName("Email Summariser")).toBe("email-summariser");
    expect(toSkillRuntimeName("  PDF / Processing!  ")).toBe("pdf-processing");
  });

  it("returns spec-compliant names unchanged", () => {
    expect(toSkillRuntimeName("pdf-processing")).toBe("pdf-processing");
  });

  it("truncates to 64 characters without a trailing separator", () => {
    const long = `${"a".repeat(63)} b`;
    const slug = toSkillRuntimeName(long);

    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back to a stable fingerprint for un-sluggable names", () => {
    const a = toSkillRuntimeName("---");
    const b = toSkillRuntimeName("\u{1F600}");

    expect(a).toMatch(/^skill--[0-9a-f]{8}$/);
    expect(b).toMatch(/^skill--[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(toSkillRuntimeName("---")).toBe(a);
  });
});

describe("SkillRegistry runtime-name resolution", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry({
      skills: [createTestSkill("Email Summariser", "Summarise emails")],
    });
  });

  it("resolves get() by runtime slug", () => {
    expect(registry.get("email-summariser")?.name).toBe("Email Summariser");
    expect(registry.get("Email Summariser")?.name).toBe("Email Summariser");
  });

  it("loads by runtime slug and records the registered name", () => {
    const onSkillLoaded = vi.fn();
    registry = new SkillRegistry({
      skills: [createTestSkill("Email Summariser", "Summarise emails")],
      onSkillLoaded,
    });

    const result = registry.load("email-summariser");

    expect(result.success).toBe(true);
    expect(registry.isLoaded("Email Summariser")).toBe(true);
    expect(registry.listLoaded()).toEqual(["Email Summariser"]);
    expect(onSkillLoaded).toHaveBeenCalledWith("Email Summariser", result);
  });

  it("treats a slug load after an exact load as already loaded", () => {
    registry.load("Email Summariser");
    const result = registry.load("email-summariser");

    expect(result.success).toBe(true);
    expect(result.error).toContain("already loaded");
    expect(registry.loadedCount).toBe(1);
  });

  it("prefers an exact match over a slug match", () => {
    registry.register(createTestSkill("email-summariser", "Exact name"));

    expect(registry.get("email-summariser")?.description).toBe("Exact name");
  });

  it("refuses ambiguous slug matches", () => {
    registry.register(createTestSkill("email summariser", "Same slug, different name"));

    expect(registry.get("email-summariser")).toBeUndefined();
    expect(registry.load("email-summariser").success).toBe(false);
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createSkillRegistry", () => {
  it("should create registry with skills", () => {
    const skills = [
      createTestSkill("git", "Git operations"),
      createTestSkill("docker", "Docker operations"),
    ];

    const registry = createSkillRegistry(skills);

    expect(registry.size).toBe(2);
    expect(registry.has("git")).toBe(true);
    expect(registry.has("docker")).toBe(true);
  });

  it("should accept options", () => {
    const callback = vi.fn();
    const registry = createSkillRegistry([createTestSkill("test", "Test")], {
      onSkillLoaded: callback,
    });

    registry.load("test");
    expect(callback).toHaveBeenCalled();
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Skill Tool Integration", () => {
  it("should work with multiple skill loads", async () => {
    const registry = new SkillRegistry({
      skills: [
        createTestSkill("git", "Git operations"),
        createTestSkill("docker", "Docker operations"),
        createTestSkill("k8s", "Kubernetes operations"),
      ],
    });

    const skillTool = createSkillTool({ registry });

    // Load first skill
    await skillTool.execute({ skill_name: "git" });
    expect(registry.listLoaded()).toEqual(["git"]);

    // Load second skill
    await skillTool.execute({ skill_name: "docker" });
    expect(registry.listLoaded()).toContain("docker");

    // Available skills should decrease
    expect(registry.listAvailable()).toHaveLength(1);
    expect(registry.listAvailable()[0].name).toBe("k8s");
  });

  it("should describe empty registry appropriately", () => {
    const registry = new SkillRegistry();
    const skillTool = createSkillTool({ registry });

    expect(skillTool.description).toBe("No skills available to load.");
  });

  it("should load file-based skill with skillPath and no tools", async () => {
    const fileSkill: SkillDefinition = {
      name: "file-skill",
      description: "A file-based skill loaded from disk",
      instructions: "These are the file-based skill instructions.",
      skillPath: "/path/to/skills/file-skill",
      metadata: { author: "test" },
    };

    const registry = new SkillRegistry({ skills: [fileSkill] });
    const skillTool = createSkillTool({ registry });

    // Should appear in description
    expect(skillTool.description).toContain("file-skill");
    expect(skillTool.description).toContain("A file-based skill loaded from disk");

    // Should load successfully and return instructions
    const result = (await skillTool.execute({ skill_name: "file-skill" })) as {
      success: boolean;
      instructions: string;
      message: string;
      content: string;
    };

    expect(result.success).toBe(true);
    expect(result.instructions).toBe("These are the file-based skill instructions.");
    expect(result.message).toContain("instructions only, no new tools");
    expect(result.content).toContain('<skill_content name="file-skill">');
    expect(result.content).toContain("<skill_path>/path/to/skills/file-skill</skill_path>");
  });
});
