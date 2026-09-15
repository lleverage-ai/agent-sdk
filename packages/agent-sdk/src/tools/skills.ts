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
import type { Schema, ToolSet } from "ai";
import { type Tool, tool, zodSchema } from "ai";
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
   * Whether the skill is included in model-facing discovery catalogues.
   *
   * Non-discoverable skills remain registered and can still be loaded by name
   * (for example when the user invokes them explicitly), but they are omitted
   * from {@link SkillRegistry.listAvailable} and from the `skill` tool's
   * description. Use this to keep rarely-needed or user-triggered skills out of
   * the agent's context budget.
   *
   * @defaultValue true
   */
  discoverable?: boolean;

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
 * Metadata retained for a skill after it has been loaded.
 *
 * This preserves the resolved instruction text so later prompt-building passes
 * can reflect the exact activated skill behavior.
 *
 * @category Tools
 */
export interface LoadedSkillInfo {
  /** Skill name */
  name: string;

  /** Skill description */
  description: string;

  /** Resolved instruction text returned when the skill was loaded */
  instructions: string;
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
// Skill Runtime Names
// =============================================================================

/**
 * A short, stable, dependency-free digest of a display name (FNV-1a 32-bit).
 * Only ever used to keep distinct un-sluggable names distinct — never for
 * anything security bearing.
 */
function fingerprintSkillName(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Normalise a skill display name into its runtime name.
 *
 * The Agent Skills specification requires skill names to be 1-64 lowercase
 * alphanumeric characters and hyphens. Skills authored with a human-friendly
 * display name ("Email Summariser") are addressed at runtime by the slug this
 * function produces ("email-summariser"). {@link SkillRegistry.get} and
 * {@link SkillRegistry.load} accept either form, so a model that echoes the
 * slug still resolves the registered skill.
 *
 * Names with no ASCII alphanumerics fall back to `skill--<fnv1a>` so two
 * different un-sluggable names never collapse into one skill. A run of
 * separators always collapses to a single dash, so no ordinary display name
 * can normalise into that double-dash shape and alias a fallback.
 *
 * @param name - The skill name as registered or as requested by the model
 * @returns The normalised runtime name
 *
 * @example
 * ```typescript
 * toSkillRuntimeName("Email Summariser"); // "email-summariser"
 * toSkillRuntimeName("pdf-processing");   // "pdf-processing"
 * ```
 *
 * @category Tools
 */
export function toSkillRuntimeName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    // Truncation can land on a separator; the slug never ends in one.
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : `skill--${fingerprintSkillName(name)}`;
}

function matchesRuntimeName(registeredName: string, requestedRuntimeName: string): boolean {
  return (
    registeredName === requestedRuntimeName ||
    toSkillRuntimeName(registeredName) === requestedRuntimeName
  );
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
  private loadedSkills = new Map<string, LoadedSkillInfo>();

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
   * Resolve a requested name to a registered skill.
   *
   * Exact matches win. Otherwise the request is normalised with
   * {@link toSkillRuntimeName} and matched against the normalised registered
   * names; the match is only accepted when it is unambiguous.
   */
  private resolve(name: string): [string, SkillDefinition] | undefined {
    const exact = this.skills.get(name);
    if (exact) {
      return [name, exact];
    }

    const requestedRuntimeName = toSkillRuntimeName(name);
    const matches = Array.from(this.skills.entries()).filter(([registeredName]) =>
      matchesRuntimeName(registeredName, requestedRuntimeName),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  /**
   * Get a registered skill definition.
   *
   * Accepts either the registered name or its runtime slug (see
   * {@link toSkillRuntimeName}). Slug matches must be unambiguous.
   *
   * @param name - The name of the skill
   * @returns The skill definition or undefined if not found
   */
  get(name: string): SkillDefinition | undefined {
    return this.resolve(name)?.[1];
  }

  /**
   * Get metadata for a loaded skill.
   *
   * @param name - The name of the skill
   * @returns The retained loaded skill metadata, or undefined if not loaded
   */
  getLoaded(name: string): LoadedSkillInfo | undefined {
    const loaded = this.loadedSkills.get(name);
    return loaded ? { ...loaded } : undefined;
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
    // Check if skill exists (accepting either the registered name or its slug)
    const resolved = this.resolve(name);
    if (!resolved) {
      return {
        success: false,
        tools: {},
        instructions: "",
        error: `Skill '${name}' not found. Available: ${this.listAvailable()
          .map((s) => s.name)
          .join(", ")}`,
      };
    }

    const [resolvedName, skill] = resolved;

    // Check if already loaded
    if (this.loadedSkills.has(resolvedName)) {
      return {
        success: true,
        tools: {},
        instructions: "",
        error: `Skill '${resolvedName}' is already loaded`,
      };
    }

    // Get the instructions (may be undefined for file-based skills)
    const instructions = skill.instructions
      ? typeof skill.instructions === "function"
        ? skill.instructions(args)
        : skill.instructions
      : "";

    this.loadedSkills.set(resolvedName, {
      name: resolvedName,
      description: skill.description,
      instructions,
    });

    // Build result
    const result: SkillLoadResult = {
      success: true,
      tools: skill.tools ?? {},
      instructions,
    };

    // Notify callback
    if (this.onSkillLoaded) {
      this.onSkillLoaded(resolvedName, result);
    }

    return result;
  }

  /**
   * List skills that are available for discovery but not yet loaded.
   *
   * Skills registered with `discoverable: false` are omitted even when
   * unloaded; they can still be loaded by name.
   *
   * @returns Array of skill summaries (name and description)
   */
  listAvailable(): Array<{ name: string; description: string }> {
    const available: Array<{ name: string; description: string }> = [];

    for (const [name, skill] of this.skills) {
      if (!this.loadedSkills.has(name) && skill.discoverable !== false) {
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
    return Array.from(this.loadedSkills.keys());
  }

  /**
   * List all loaded skills with retained instruction text.
   *
   * @returns Array of loaded skill metadata
   */
  listLoadedDetails(): LoadedSkillInfo[] {
    return Array.from(this.loadedSkills.values(), (loaded) => ({ ...loaded }));
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
   * Whether any registered skill is hidden from discovery and not yet loaded.
   *
   * Used by the skill tool to explain, when the discoverable catalogue is
   * empty, that explicitly named skills may still be loadable.
   *
   * @returns True if at least one unloaded skill has `discoverable: false`
   */
  hasUnloadedExplicitOnlySkills(): boolean {
    for (const [name, skill] of this.skills) {
      if (!this.loadedSkills.has(name) && skill.discoverable === false) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether any registered skill has function-backed instructions that can
   * consume a caller-supplied argument string.
   *
   * @returns True if at least one skill's `instructions` is a function
   */
  anySkillConsumesArgs(): boolean {
    for (const skill of this.skills.values()) {
      if (typeof skill.instructions === "function") {
        return true;
      }
    }
    return false;
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

/** Input accepted by the `skill` tool. `args` is only advertised when a skill consumes it. */
interface SkillToolInput {
  skill_name: string;
  args?: string;
}

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

  /**
   * Instruction appended to every successful load result's `message`, telling
   * the model to keep working on the original request rather than stopping at
   * an acknowledgement that the skill loaded.
   *
   * Some models treat a successful `skill` tool result as a natural end of
   * turn and reply with "I've loaded the skill, I'll do X next" without doing
   * X. Appending an explicit continuation instruction to the result reliably
   * keeps them going.
   *
   * Pass `false` to omit the instruction entirely.
   *
   * @defaultValue {@link DEFAULT_SKILL_CONTINUATION_INSTRUCTION}
   */
  continuationInstruction?: string | false;
}

/**
 * Default continuation instruction appended to successful skill load results.
 *
 * @see {@link SkillToolOptions.continuationInstruction}
 * @category Tools
 */
export const DEFAULT_SKILL_CONTINUATION_INSTRUCTION =
  "Treat this result as internal execution context, not as completion or a user-visible answer. Continue the original request now. Your next response must do one of the following: take the next concrete action; provide the complete answer if no action remains; ask only for genuinely missing input, access, approval, or a user choice; state a real blocker; or preserve a safety refusal. Never stop at an acknowledgement, readiness statement, or plan.";

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
export function createSkillTool(options: SkillToolOptions): Tool {
  const { registry, descriptionPrefix } = options;
  const continuationInstruction =
    options.continuationInstruction === undefined
      ? DEFAULT_SKILL_CONTINUATION_INSTRUCTION
      : options.continuationInstruction;
  const withContinuation = (message: string): string =>
    continuationInstruction ? `${message}. ${continuationInstruction}` : message;

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

    const prefix =
      descriptionPrefix ??
      "Load a skill to gain additional capabilities. After loading, new tools and instructions become available.";

    if (available.length === 0) {
      // Non-discoverable skills are hidden from the catalogue but still
      // loadable by name, so tell the model the tool is not a dead end.
      return registry.hasUnloadedExplicitOnlySkills()
        ? `${prefix}\n\nNo skills are listed for automatic discovery. Skills explicitly invoked by the user can still be loaded by name.`
        : "No skills available to load.";
    }

    const skillList = available.map((s) => `- ${s.name}: ${s.description}`).join("\n");

    return `${prefix}\n\nAvailable skills:\n${skillList}`;
  };

  // Only advertise `args` when a registered skill can actually consume it.
  // `load()` forwards args to `instructions` only when that is a function;
  // skills authored with static instructions discard it silently. Advertising
  // a field that does nothing still costs something: it invites the model to
  // commit to a framing of the task in the same call that loads the
  // instructions, so the framing lands in context before the instructions it
  // is supposed to follow.
  //
  // The schema is a lazy `() => Schema` rather than a fixed zod object so the
  // AI SDK re-evaluates it on every request (both when preparing the tool
  // list for the model and when validating a tool call). `registry.register()`
  // can add a function-instruction skill after this tool is created, and a
  // schema captured at creation time would then strip the `args` the model
  // supplies for it.
  const inputSchema = (): Schema<SkillToolInput> =>
    zodSchema<SkillToolInput>(
      registry.anySkillConsumesArgs()
        ? z.object({
            skill_name: z.string().describe("Name of the skill to load"),
            args: z.string().optional().describe("Optional arguments to pass to the skill"),
          })
        : z.object({
            skill_name: z.string().describe("Name of the skill to load"),
          }),
    );

  return tool({
    description: buildDescription(),
    inputSchema,
    execute: async ({ skill_name, args }: SkillToolInput) => {
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
        response.message = withContinuation(
          `Loaded skill '${skill_name}' (provides instructions only, no new tools)`,
        );
      } else {
        response.message = withContinuation(
          `Loaded skill '${skill_name}'. New tools available: ${toolNames.join(", ")}`,
        );
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
