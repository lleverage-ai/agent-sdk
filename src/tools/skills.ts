/**
 * Skill tool for progressive disclosure of capabilities.
 *
 * The skill tool allows agents to load skills (tools + prompts) on-demand
 * based on conversation context. This keeps the initial context small and
 * focused, expanding capabilities only as needed.
 *
 * @packageDocumentation
 */

import type { ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { MCPManager } from "../mcp/manager.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Definition of a loadable skill for progressive disclosure.
 *
 * Skills bundle tools and prompts that are loaded dynamically by the agent.
 * This extends the basic `SkillDefinition` with support for MCP tools and
 * dependencies, enabling on-demand capability expansion.
 *
 * @example
 * ```typescript
 * const gitSkill: LoadableSkillDefinition = {
 *   name: "git",
 *   description: "Git version control operations",
 *   tools: {
 *     git_status: tool({ ... }),
 *     git_commit: tool({ ... }),
 *   },
 *   prompt: "You now have access to Git tools. Use them to manage version control.",
 * };
 * ```
 *
 * @category Tools
 */
export interface LoadableSkillDefinition {
  /** Unique identifier for the skill */
  name: string;

  /** Description for the agent to decide when to invoke this skill */
  description: string;

  /** Tools this skill provides (inline tools) */
  tools: ToolSet;

  /**
   * MCP tool names to load when this skill is activated.
   *
   * These are tool names from the MCPManager (e.g., "mcp__github__list_issues").
   * They will be loaded via MCPManager.loadTools() when the skill is activated.
   *
   * @example
   * ```typescript
   * const githubSkill: LoadableSkillDefinition = {
   *   name: "github",
   *   description: "GitHub operations",
   *   tools: {},  // No inline tools
   *   mcpTools: [
   *     "mcp__github__list_issues",
   *     "mcp__github__create_pr",
   *   ],
   *   prompt: "You can now work with GitHub issues and PRs.",
   * };
   * ```
   */
  mcpTools?: string[];

  /**
   * Prompt to inject when the skill is loaded.
   * Can be a string or a function that receives optional arguments.
   */
  prompt: string | ((args?: string) => string);

  /**
   * Optional skills this skill depends on.
   * Dependencies are loaded first when this skill is loaded.
   */
  dependencies?: string[];
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

  /** Prompt from the loaded skill (empty if failed) */
  prompt: string;

  /** Error message if loading failed */
  error?: string;

  /** Skills that were loaded as dependencies */
  loadedDependencies?: string[];

  /** MCP tools that were loaded (via MCPManager) */
  loadedMcpTools?: string[];

  /** MCP tools that were requested but not found */
  notFoundMcpTools?: string[];
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
  skills?: LoadableSkillDefinition[];

  /**
   * MCP manager for loading MCP tools referenced by skills.
   *
   * When provided, skills can specify `mcpTools` to load MCP tools
   * when the skill is activated.
   */
  mcpManager?: MCPManager;

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
  private skills = new Map<string, LoadableSkillDefinition>();

  /** Currently loaded skills */
  private loadedSkills = new Set<string>();

  /** Callback for skill load events */
  private onSkillLoaded?: (skillName: string, result: SkillLoadResult) => void;

  /** MCP manager for loading MCP tools */
  private mcpManager?: MCPManager;

  /**
   * Creates a new skill registry.
   *
   * @param options - Configuration options
   */
  constructor(options: SkillRegistryOptions = {}) {
    this.onSkillLoaded = options.onSkillLoaded;
    this.mcpManager = options.mcpManager;

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
  register(skill: LoadableSkillDefinition): void {
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
  get(name: string): LoadableSkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * Load a skill, making its tools and prompt available.
   *
   * This method handles dependencies, loading them first if specified.
   * Already-loaded skills are skipped (no duplicate loading).
   *
   * @param name - The name of the skill to load
   * @param args - Optional arguments to pass to the skill's prompt function
   * @returns The load result with tools, prompt, and status
   *
   * @example
   * ```typescript
   * const result = registry.load("git");
   * if (result.success) {
   *   // Inject result.tools into agent
   *   // Inject result.prompt into context
   * }
   * ```
   */
  load(name: string, args?: string): SkillLoadResult {
    // Check if already loaded
    if (this.loadedSkills.has(name)) {
      return {
        success: true,
        tools: {},
        prompt: "",
        error: `Skill '${name}' is already loaded`,
      };
    }

    // Check if skill exists
    const skill = this.skills.get(name);
    if (!skill) {
      return {
        success: false,
        tools: {},
        prompt: "",
        error: `Skill '${name}' not found. Available: ${this.listAvailable()
          .map((s) => s.name)
          .join(", ")}`,
      };
    }

    // Load dependencies first
    const loadedDependencies: string[] = [];
    const aggregatedTools: ToolSet = {};
    let aggregatedPrompt = "";

    if (skill.dependencies && skill.dependencies.length > 0) {
      for (const depName of skill.dependencies) {
        if (this.loadedSkills.has(depName)) {
          continue; // Skip already loaded dependencies
        }

        const depResult = this.load(depName);
        if (!depResult.success) {
          return {
            success: false,
            tools: {},
            prompt: "",
            error: `Failed to load dependency '${depName}': ${depResult.error}`,
          };
        }

        // Aggregate dependency tools and prompts
        Object.assign(aggregatedTools, depResult.tools);
        if (depResult.prompt) {
          aggregatedPrompt += `${depResult.prompt}\n\n`;
        }
        loadedDependencies.push(depName);
      }
    }

    // Mark as loaded
    this.loadedSkills.add(name);

    // Track MCP tool loading results
    let loadedMcpTools: string[] | undefined;
    let notFoundMcpTools: string[] | undefined;

    // Load MCP tools if specified
    if (skill.mcpTools && skill.mcpTools.length > 0 && this.mcpManager) {
      const mcpLoadResult = this.mcpManager.loadTools(skill.mcpTools);

      if (mcpLoadResult.loaded.length > 0 || mcpLoadResult.alreadyLoaded.length > 0) {
        loadedMcpTools = [...mcpLoadResult.loaded, ...mcpLoadResult.alreadyLoaded];
      }

      if (mcpLoadResult.notFound.length > 0) {
        notFoundMcpTools = mcpLoadResult.notFound;
        // Log warning but continue - some MCP tools may be unavailable
        console.warn(
          `Skill '${name}': Some MCP tools not found: ${mcpLoadResult.notFound.join(", ")}`,
        );
      }
    }

    // Get the prompt
    const prompt = typeof skill.prompt === "function" ? skill.prompt(args) : skill.prompt;

    // Build result - MCP tools are loaded via MCPManager, not returned directly
    const result: SkillLoadResult = {
      success: true,
      tools: { ...aggregatedTools, ...skill.tools },
      prompt: aggregatedPrompt + prompt,
      loadedDependencies: loadedDependencies.length > 0 ? loadedDependencies : undefined,
      loadedMcpTools,
      notFoundMcpTools,
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
      const response: Record<string, unknown> = {
        success: true,
        skill: skill_name,
        newTools: toolNames,
        instructions: result.prompt,
      };

      if (result.loadedDependencies && result.loadedDependencies.length > 0) {
        response.dependencies = result.loadedDependencies;
      }

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
  skills: LoadableSkillDefinition[],
  options?: Omit<SkillRegistryOptions, "skills">,
): SkillRegistry {
  return new SkillRegistry({
    ...options,
    skills,
  });
}

/**
 * Creates a skill definition.
 *
 * This is a helper function for creating LoadableSkillDefinition objects
 * with proper typing.
 *
 * @param options - Skill configuration
 * @returns A LoadableSkillDefinition object
 *
 * @example
 * ```typescript
 * const gitSkill = defineLoadableSkill({
 *   name: "git",
 *   description: "Git version control operations",
 *   tools: {
 *     git_status: tool({ ... }),
 *     git_commit: tool({ ... }),
 *   },
 *   prompt: "You now have access to Git tools.",
 * });
 * ```
 *
 * @category Tools
 */
export function defineLoadableSkill(options: LoadableSkillDefinition): LoadableSkillDefinition {
  return options;
}
