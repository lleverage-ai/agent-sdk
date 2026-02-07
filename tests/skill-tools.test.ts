/**
 * Tests for the skill tool system.
 *
 * @packageDocumentation
 */

import { tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createSkillRegistry,
  createSkillTool,
  type SkillDefinition,
  SkillRegistry,
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
});
