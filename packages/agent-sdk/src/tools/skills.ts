/**
 * Skill tool for progressive disclosure of capabilities.
 *
 * The skill tool allows agents to load skills (tools + prompts) on-demand
 * based on conversation context. This keeps the initial context small and
 * focused, expanding capabilities only as needed.
 *
 * @packageDocumentation
 */

import * as path from "node:path";
import type { ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod";

// =============================================================================
// Types
// =============================================================================

/**
 * Skill definition aligned with the Agent Skills specification.
 *
 * Skills can be:
 * - **Programmatic**: TypeScript objects with inline tools
 * - **File-based**: Loaded from SKILL.md directories
 *
 * @see https://agentskills.io/specification
 *
 * @example Programmatic skill
 * ```typescript
 * const gitSkill: SkillDefinition = {
 *   name: "git",
 *   description: "Git version control operations. Use when working with git repositories.",
 *   license: "MIT",
 *   tools: {
 *     git_status: tool({ ... }),
 *     git_commit: tool({ ... }),
 *   },
 *   instructions: "You now have access to Git tools. Use them to manage version control.",
 * };
 * ```
 *
 * @example File-based skill
 * ```typescript
 * const pdfSkill: SkillDefinition = {
 *   name: "pdf-processing",
 *   description: "Extract text and tables from PDF files, fill forms, merge documents.",
 *   license: "Apache-2.0",
 *   skillPath: "/path/to/skills/pdf-processing",
 *   // instructions and tools loaded from SKILL.md and scripts/
 * };
 * ```
 *
 * @category Tools
 */
export interface SkillDefinition {
  // =============================================================================
  // Agent Skills Specification Frontmatter
  // https://agentskills.io/specification
  // =============================================================================

  /**
   * Unique skill identifier.
   *
   * **Requirements:**
   * - 1-64 characters
   * - Lowercase alphanumeric and hyphens only
   * - Must not start or end with hyphen
   * - Must not contain consecutive hyphens
   * - Should match directory name for file-based skills
   *
   * @example "pdf-processing", "code-review", "data-analysis"
   */
  name: string;

  /**
   * Description of what this skill does and when to use it.
   *
   * **Requirements:**
   * - 1-1024 characters
   * - Should include keywords for agent discovery
   * - Should describe both capabilities and use cases
   *
   * @example "Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF documents."
   */
  description: string;

  /**
   * License for this skill.
   * Can be a license name or reference to a bundled license file.
   *
   * @example "MIT"
   * @example "Proprietary. See LICENSE.txt"
   */
  license?: string;

  /**
   * Environment requirements for this skill.
   *
   * **Requirements:**
   * - Max 500 characters
   * - Only include if skill has specific requirements
   *
   * @example "Requires git, docker, and internet access"
   * @example "Designed for Claude Code"
   */
  compatibility?: string;

  /**
   * Arbitrary metadata key-value pairs.
   * Use reasonably unique keys to avoid conflicts.
   *
   * @example { author: "acme-corp", version: "1.0", category: "data" }
   */
  metadata?: Record<string, string>;

  // =============================================================================
  // Runtime Implementation
  // =============================================================================

  /**
   * Instructions provided when skill is activated.
   *
   * - For **programmatic skills**: Inline string or function
   * - For **file-based skills**: Loaded from SKILL.md body
   * - Can be omitted if loaded from file
   *
   * These instructions are injected into the agent's context when the skill
   * is loaded, providing guidance on how to use the skill's capabilities.
   *
   * @example
   * ```typescript
   * instructions: "You have access to Git tools. Always check status before committing."
   * ```
   *
   * @example With arguments
   * ```typescript
   * instructions: (args) => `Analyze ${args} using the data tools.`
   * ```
   */
  instructions?: string | ((args?: string) => string);

  /**
   * Tools provided by this skill.
   *
   * - For **programmatic skills**: Inline AI SDK tools
   * - For **file-based skills**: Generated from scripts/ directory
   * - Can be omitted if no tools
   *
   * @example
   * ```typescript
   * tools: {
   *   check_status: tool({
   *     description: "Check status",
   *     inputSchema: z.object({}),
   *     execute: async () => ({ status: "ok" }),
   *   }),
   * }
   * ```
   */
  tools?: ToolSet;

  // =============================================================================
  // SDK Extensions for Progressive Disclosure
  // =============================================================================

  /**
   * Path to skill directory containing SKILL.md.
   *
   * When provided, the skill uses progressive disclosure:
   * 1. **Metadata** from SKILL.md frontmatter (for discovery)
   * 2. **Instructions** from SKILL.md body (on activation)
   * 3. **Resources** from scripts/, references/, assets/ (on-demand via read/bash tools)
   *
   * Use `getSkillResourcePath()` to access references/ and assets/ on-demand:
   * - references/ - Additional documentation loaded when needed
   * - assets/ - Templates, schemas, and other data files
   *
   * @example "/path/to/skills/pdf-processing"
   */
  skillPath?: string;
}

/**
 * Result from attempting to load a skill.
 *
 * @category Tools
 */
export interface SkillLoadResult {
  /** Whether the skill was loaded successfully */
  success: boolean;

  /** Tools provided by the loaded skill (empty if failed) */
  tools: ToolSet;

  /** Instructions from the loaded skill (empty if failed) */
  instructions: string;

  /** Error message if loading failed */
  error?: string;
}

/**
 * Options for creating a skill registry.
 *
 * @category Tools
 */
export interface SkillRegistryOptions {
  /**
   * Initial skills to register.
   */
  skills?: SkillDefinition[];

  /**
   * Callback when a skill is loaded.
   */
  onSkillLoaded?: (skillName: string, result: SkillLoadResult) => void;
}

// =============================================================================
// Skill Registry
// =============================================================================

/**
 * Registry for managing loadable skills.
 *
 * The registry tracks available skills and which ones have been loaded.
 * Skills are loaded on-demand by the agent using the skill tool.
 *
 * @example
 * ```typescript
 * const registry = new SkillRegistry({
 *   skills: [gitSkill, dockerSkill],
 * });
 *
 * // Register more skills later
 * registry.register(kubernetesSkill);
 *
 * // Check available skills
 * const available = registry.listAvailable();
 *
 * // Load a skill
 * const result = registry.load("git");
 * ```
 *
 * @category Tools
 */
export class SkillRegistry {
  /** All registered skills */
  private skills = new Map<string, SkillDefinition>();

  /** Currently loaded skills */
  private loadedSkills = new Set<string>();

  /** Callback for skill load events */
  private onSkillLoaded?: (skillName: string, result: SkillLoadResult) => void;

  /**
   * Creates a new skill registry.
   *
   * @param options - Configuration options
   */
  constructor(options: SkillRegistryOptions = {}) {
    this.onSkillLoaded = options.onSkillLoaded;

    if (options.skills) {
      for (const skill of options.skills) {
        this.register(skill);
      }
    }
  }

  /**
   * Register a skill with the registry.
   *
   * @param skill - The skill definition to register
   * @throws Error if a skill with the same name is already registered
   *
   * @example
   * ```typescript
   * registry.register({
   *   name: "aws",
   *   description: "AWS cloud operations",
   *   tools: { ... },
   *   prompt: "You now have access to AWS tools.",
   * });
   * ```
   */
  register(skill: SkillDefinition): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill '${skill.name}' is already registered`);
    }
    this.skills.set(skill.name, skill);
  }

  /**
   * Unregister a skill from the registry.
   *
   * @param name - The name of the skill to unregister
   * @returns True if the skill was found and removed
   */
  unregister(name: string): boolean {
    this.loadedSkills.delete(name);
    return this.skills.delete(name);
  }

  /**
   * Check if a skill is registered.
   *
   * @param name - The name of the skill to check
   * @returns True if the skill is registered
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Check if a skill is currently loaded.
   *
   * @param name - The name of the skill to check
   * @returns True if the skill is loaded
   */
  isLoaded(name: string): boolean {
    return this.loadedSkills.has(name);
  }

  /**
   * Get a registered skill definition.
   *
   * @param name - The name of the skill
   * @returns The skill definition or undefined if not found
   */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * Load a skill, making its tools and instructions available.
   *
   * This method handles dependencies, loading them first if specified.
   * Already-loaded skills are skipped (no duplicate loading).
   *
   * @param name - The name of the skill to load
   * @param args - Optional arguments to pass to the skill's instructions function
   * @returns The load result with tools, instructions, and status
   *
   * @example
   * ```typescript
   * const result = registry.load("git");
   * if (result.success) {
   *   // Inject result.tools into agent
   *   // Inject result.instructions into context
   * }
   * ```
   */
  load(name: string, args?: string): SkillLoadResult {
    // Check if already loaded
    if (this.loadedSkills.has(name)) {
      return {
        success: true,
        tools: {},
        instructions: "",
        error: `Skill '${name}' is already loaded`,
      };
    }

    // Check if skill exists
    const skill = this.skills.get(name);
    if (!skill) {
      return {
        success: false,
        tools: {},
        instructions: "",
        error: `Skill '${name}' not found. Available: ${this.listAvailable()
          .map((s) => s.name)
          .join(", ")}`,
      };
    }

    // Mark as loaded
    this.loadedSkills.add(name);

    // Get the instructions (may be undefined for file-based skills)
    const instructions = skill.instructions
      ? typeof skill.instructions === "function"
        ? skill.instructions(args)
        : skill.instructions
      : "";

    // Build result
    const result: SkillLoadResult = {
      success: true,
      tools: skill.tools ?? {},
      instructions,
    };

    // Notify callback
    if (this.onSkillLoaded) {
      this.onSkillLoaded(name, result);
    }

    return result;
  }

  /**
   * List skills that are available but not yet loaded.
   *
   * @returns Array of skill summaries (name and description)
   */
  listAvailable(): Array<{ name: string; description: string }> {
    const available: Array<{ name: string; description: string }> = [];

    for (const [name, skill] of this.skills) {
      if (!this.loadedSkills.has(name)) {
        available.push({
          name,
          description: skill.description,
        });
      }
    }

    return available;
  }

  /**
   * List all loaded skills.
   *
   * @returns Array of loaded skill names
   */
  listLoaded(): string[] {
    return Array.from(this.loadedSkills);
  }

  /**
   * List all registered skills (loaded and available).
   *
   * @returns Array of all skill summaries
   */
  listAll(): Array<{ name: string; description: string; loaded: boolean }> {
    const all: Array<{ name: string; description: string; loaded: boolean }> = [];

    for (const [name, skill] of this.skills) {
      all.push({
        name,
        description: skill.description,
        loaded: this.loadedSkills.has(name),
      });
    }

    return all;
  }

  /**
   * Reset the registry, marking all skills as unloaded.
   *
   * This does not unregister skills, only resets the loaded state.
   */
  reset(): void {
    this.loadedSkills.clear();
  }

  /**
   * Get the number of registered skills.
   */
  get size(): number {
    return this.skills.size;
  }

  /**
   * Get the number of loaded skills.
   */
  get loadedCount(): number {
    return this.loadedSkills.size;
  }
}

// =============================================================================
// Skill Tool
// =============================================================================

/**
 * Options for creating the skill loading tool.
 *
 * @category Tools
 */
export interface SkillToolOptions {
  /** The skill registry to use */
  registry: SkillRegistry;

  /**
   * Custom name for the tool.
   * @defaultValue "load_skill"
   */
  name?: string;

  /**
   * Custom description prefix for the tool.
   * The list of available skills is appended automatically.
   */
  descriptionPrefix?: string;
}

/**
 * Creates a tool that allows agents to load skills on-demand.
 *
 * The tool's description dynamically lists available (not yet loaded) skills,
 * so the agent can decide which skill to load based on the conversation.
 *
 * @param options - Configuration options
 * @returns An AI SDK compatible tool for loading skills
 *
 * @example
 * ```typescript
 * import { createSkillTool, SkillRegistry } from "@lleverage-ai/agent-sdk";
 *
 * const registry = new SkillRegistry({
 *   skills: [gitSkill, dockerSkill],
 * });
 *
 * const skillTool = createSkillTool({ registry });
 *
 * const agent = createAgent({
 *   model,
 *   tools: { load_skill: skillTool },
 * });
 *
 * // Agent can now invoke load_skill to gain new capabilities
 * ```
 *
 * @category Tools
 */
export function createSkillTool(options: SkillToolOptions) {
  const { registry, descriptionPrefix } = options;

  const escapeXml = (value: string): string =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");

  const getMetadataFiles = (
    skill: SkillDefinition,
    subdir: "scripts" | "references" | "assets",
    limit: number,
  ): string[] => {
    const raw = skill.metadata?.[subdir];
    if (!raw || typeof raw !== "string") {
      return [];
    }

    return raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, limit)
      .map((item) => (skill.skillPath ? path.join(skill.skillPath, subdir, item) : item));
  };

  const buildSkillContentBlock = (
    skillName: string,
    instructions: string,
    toolNames: string[],
    skill?: SkillDefinition,
  ): string => {
    const lines: string[] = [`<skill_content name="${escapeXml(skillName)}">`];

    if (instructions.trim().length > 0) {
      lines.push("<instructions>");
      lines.push(escapeXml(instructions.trim()));
      lines.push("</instructions>");
    } else {
      lines.push("<instructions />");
    }

    lines.push("<tools>");
    if (toolNames.length > 0) {
      for (const toolName of toolNames) {
        lines.push(`  <tool>${escapeXml(toolName)}</tool>`);
      }
    }
    lines.push("</tools>");

    if (skill?.skillPath) {
      const skillPath = skill.skillPath;
      lines.push(`<skill_path>${escapeXml(skillPath)}</skill_path>`);

      const resourceKinds: Array<"scripts" | "references" | "assets"> = [
        "scripts",
        "references",
        "assets",
      ];

      lines.push("<skill_resources>");
      for (const kind of resourceKinds) {
        const files = getMetadataFiles(skill, kind, 12);
        lines.push(`  <${kind}>`);
        for (const file of files) {
          lines.push(`    <file>${escapeXml(file)}</file>`);
        }
        lines.push(`  </${kind}>`);
      }
      lines.push("</skill_resources>");
    }

    lines.push("</skill_content>");
    return lines.join("\n");
  };

  // Build dynamic description based on available skills
  const buildDescription = () => {
    const available = registry.listAvailable();

    if (available.length === 0) {
      return "No skills available to load.";
    }

    const prefix =
      descriptionPrefix ??
      "Load a skill to gain additional capabilities. After loading, new tools and instructions become available.";

    const skillList = available.map((s) => `- ${s.name}: ${s.description}`).join("\n");

    return `${prefix}\n\nAvailable skills:\n${skillList}`;
  };

  return tool({
    description: buildDescription(),
    inputSchema: z.object({
      skill_name: z.string().describe("Name of the skill to load"),
      args: z.string().optional().describe("Optional arguments to pass to the skill"),
    }),
    execute: async ({ skill_name, args }: { skill_name: string; args?: string }) => {
      const result = registry.load(skill_name, args);

      if (!result.success) {
        return {
          success: false,
          error: result.error,
        };
      }

      // Format the response
      const toolNames = Object.keys(result.tools);
      const skill = registry.get(skill_name);
      const content = buildSkillContentBlock(skill_name, result.instructions, toolNames, skill);
      const response: Record<string, unknown> = {
        success: true,
        skill: skill_name,
        newTools: toolNames,
        instructions: result.instructions,
        content,
        skillPath: skill?.skillPath,
      };

      if (toolNames.length === 0) {
        response.message = `Loaded skill '${skill_name}' (provides instructions only, no new tools)`;
      } else {
        response.message = `Loaded skill '${skill_name}'. New tools available: ${toolNames.join(", ")}`;
      }

      return response;
    },
  });
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a new skill registry with the given skills.
 *
 * This is a convenience function for creating a SkillRegistry instance.
 *
 * @param skills - Initial skills to register
 * @param options - Additional options
 * @returns A new SkillRegistry instance
 *
 * @example
 * ```typescript
 * const registry = createSkillRegistry([gitSkill, dockerSkill]);
 * ```
 *
 * @category Tools
 */
export function createSkillRegistry(
  skills: SkillDefinition[],
  options?: Omit<SkillRegistryOptions, "skills">,
): SkillRegistry {
  return new SkillRegistry({
    ...options,
    skills,
  });
}
