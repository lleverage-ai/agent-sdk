/**
 * File-based skill loader for Agent Skills specification.
 *
 * Loads skills from directories containing SKILL.md files according to the
 * Agent Skills specification (https://agentskills.io/specification).
 *
 * @packageDocumentation
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SkillDefinition } from "../tools/skills.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Error that occurred while loading a skill.
 *
 * @category Skills
 */
export interface SkillLoadError {
  /** Path to the skill directory that failed to load */
  path: string;
  /** Error message describing what went wrong */
  error: string;
  /** Optional details for debugging */
  details?: string;
}

/**
 * Result from loading skills from directories.
 *
 * @category Skills
 */
export interface SkillLoadResult {
  /** Successfully loaded skills */
  skills: SkillDefinition[];
  /** Errors encountered during loading */
  errors: SkillLoadError[];
}

/**
 * Parsed frontmatter from a SKILL.md file.
 *
 * @category Skills
 */
interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
}

/**
 * Options for loading skills.
 *
 * @category Skills
 */
export interface LoadSkillsOptions {
  /**
   * Whether to validate skill metadata against the spec.
   * @defaultValue true
   */
  validate?: boolean;

  /**
   * Whether to include hidden directories (starting with .)
   * @defaultValue false
   */
  includeHidden?: boolean;
}

// =============================================================================
// Main Loading Functions
// =============================================================================

/**
 * Load skills from multiple directories.
 *
 * Scans the given directories for subdirectories containing SKILL.md files.
 * Each subdirectory with a SKILL.md is treated as a skill.
 *
 * @param directories - Array of directory paths to scan
 * @param options - Loading options
 * @returns Promise resolving to loaded skills and any errors
 *
 * @example
 * ```typescript
 * const result = await loadSkillsFromDirectories([
 *   "/path/to/skills",
 *   "/home/user/.skills",
 * ]);
 *
 * console.log(`Loaded ${result.skills.length} skills`);
 * for (const error of result.errors) {
 *   console.error(`Failed to load ${error.path}: ${error.error}`);
 * }
 * ```
 *
 * @category Skills
 */
export async function loadSkillsFromDirectories(
  directories: string[],
  options: LoadSkillsOptions = {},
): Promise<SkillLoadResult> {
  const skills: SkillDefinition[] = [];
  const errors: SkillLoadError[] = [];

  for (const dir of directories) {
    try {
      // Check if directory exists
      const dirStat = await stat(dir);
      if (!dirStat.isDirectory()) {
        errors.push({
          path: dir,
          error: "Not a directory",
        });
        continue;
      }

      // Read directory contents
      const entries = await readdir(dir, { withFileTypes: true });

      // Filter for directories (potential skills)
      const subdirs = entries.filter((entry) => {
        if (!entry.isDirectory()) return false;
        if (!options.includeHidden && entry.name.startsWith(".")) return false;
        return true;
      });

      // Try to load each subdirectory as a skill
      for (const subdir of subdirs) {
        const skillPath = join(dir, subdir.name);
        try {
          const skill = await loadSkillFromDirectory(skillPath, options);
          skills.push(skill);
        } catch (error) {
          errors.push({
            path: skillPath,
            error: error instanceof Error ? error.message : String(error),
            details: error instanceof Error ? error.stack : undefined,
          });
        }
      }
    } catch (error) {
      errors.push({
        path: dir,
        error: `Failed to scan directory: ${error instanceof Error ? error.message : String(error)}`,
        details: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  return { skills, errors };
}

/**
 * Load a single skill from a directory.
 *
 * The directory must contain a SKILL.md file with valid frontmatter.
 *
 * @param directory - Path to skill directory
 * @param options - Loading options
 * @returns Promise resolving to the loaded skill
 * @throws Error if SKILL.md is missing or invalid
 *
 * @example
 * ```typescript
 * const skill = await loadSkillFromDirectory("/path/to/skills/git");
 *
 * console.log(`Loaded skill: ${skill.name}`);
 * console.log(`Instructions: ${skill.instructions}`);
 * console.log(`Scripts: ${skill.scripts?.join(", ")}`);
 * ```
 *
 * @category Skills
 */
export async function loadSkillFromDirectory(
  directory: string,
  options: LoadSkillsOptions = {},
): Promise<SkillDefinition> {
  const validate = options.validate ?? true;

  // Read SKILL.md
  const skillMdPath = join(directory, "SKILL.md");
  let skillMdContent: string;
  try {
    skillMdContent = await readFile(skillMdPath, "utf-8");
  } catch (error) {
    throw new Error(
      `SKILL.md not found or not readable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Parse frontmatter and body
  const { frontmatter, body } = parseSkillMd(skillMdContent);

  // Validate frontmatter (skip validation for hidden skills starting with .)
  const isHidden = frontmatter.name.startsWith(".");
  if (validate && !isHidden) {
    validateSkillFrontmatter(frontmatter, directory);
  }

  // Verify name matches directory
  const dirName = basename(directory);
  if (frontmatter.name !== dirName) {
    throw new Error(`Skill name '${frontmatter.name}' does not match directory name '${dirName}'`);
  }

  // Discover optional directories
  const scripts = await discoverFiles(directory, "scripts");
  const references = await discoverFiles(directory, "references");
  const assets = await discoverFiles(directory, "assets");

  // Build skill definition
  const skill: SkillDefinition = {
    name: frontmatter.name,
    description: frontmatter.description,
    license: frontmatter.license,
    compatibility: frontmatter.compatibility,
    metadata: frontmatter.metadata,
    instructions: body.trim() || undefined,
    skillPath: directory,
  };

  // Add discovered resources if present
  if (scripts.length > 0) {
    skill.metadata = {
      ...skill.metadata,
      scripts: scripts.join(","),
    };
  }
  if (references.length > 0) {
    skill.metadata = {
      ...skill.metadata,
      references: references.join(","),
    };
  }
  if (assets.length > 0) {
    skill.metadata = {
      ...skill.metadata,
      assets: assets.join(","),
    };
  }

  return skill;
}

// =============================================================================
// Parsing Functions
// =============================================================================

/**
 * Parse SKILL.md file into frontmatter and body.
 *
 * @param content - Content of SKILL.md file
 * @returns Parsed frontmatter and markdown body
 * @throws Error if frontmatter is invalid
 */
function parseSkillMd(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  // Check for frontmatter delimiters
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    throw new Error(
      "Invalid SKILL.md format: missing YAML frontmatter (must start with --- and end with ---)",
    );
  }

  const frontmatterYaml = match[1];
  const body = match[2];

  if (!frontmatterYaml || !body) {
    throw new Error("Invalid SKILL.md format: malformed frontmatter structure");
  }

  // Parse YAML frontmatter
  let frontmatter: SkillFrontmatter;
  try {
    frontmatter = parseYaml(frontmatterYaml);
  } catch (error) {
    throw new Error(
      `Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Validate required fields
  if (!frontmatter.name || typeof frontmatter.name !== "string") {
    throw new Error("Frontmatter missing required field: name");
  }
  if (!frontmatter.description || typeof frontmatter.description !== "string") {
    throw new Error("Frontmatter missing required field: description");
  }

  return { frontmatter, body };
}

/**
 * Simple YAML parser for frontmatter.
 *
 * This is a lightweight parser that handles the subset of YAML used in
 * Agent Skills frontmatter. For more complex YAML, consider using a library.
 *
 * @param yaml - YAML string to parse
 * @returns Parsed object
 */
function parseYaml(yaml: string): SkillFrontmatter {
  const result: Record<string, unknown> = {};
  let _currentKey = "";
  let inMetadata = false;
  const metadataObj: Record<string, string> = {};

  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Check for metadata section
    if (trimmed === "metadata:") {
      inMetadata = true;
      continue;
    }

    // Parse key-value pairs
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();

    if (inMetadata) {
      // Metadata sub-key
      if (line.startsWith("  ") && key && value) {
        metadataObj[key] = value.replace(/^["']|["']$/g, ""); // Remove quotes
      } else {
        // End of metadata section
        inMetadata = false;
        result.metadata = metadataObj;
      }
    }

    if (!inMetadata && value) {
      _currentKey = key;
      result[key] = value.replace(/^["']|["']$/g, ""); // Remove quotes
    }
  }

  // Add metadata if we ended while in metadata section
  if (inMetadata && Object.keys(metadataObj).length > 0) {
    result.metadata = metadataObj;
  }

  // Ensure required fields are present
  if (!result.name || typeof result.name !== "string") {
    throw new Error("YAML frontmatter missing required field: name");
  }
  if (!result.description || typeof result.description !== "string") {
    throw new Error("YAML frontmatter missing required field: description");
  }

  return result as unknown as SkillFrontmatter;
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate skill frontmatter against the Agent Skills specification.
 *
 * @param frontmatter - Parsed frontmatter to validate
 * @param directory - Directory path (for error messages)
 * @throws Error if validation fails
 */
function validateSkillFrontmatter(frontmatter: SkillFrontmatter, directory: string): void {
  // Validate name
  if (frontmatter.name.length < 1 || frontmatter.name.length > 64) {
    throw new Error(`Skill name must be 1-64 characters, got ${frontmatter.name.length}`);
  }

  // Name must be lowercase alphanumeric and hyphens only
  if (!/^[a-z0-9-]+$/.test(frontmatter.name)) {
    throw new Error(
      `Skill name must only contain lowercase letters, numbers, and hyphens, got: ${frontmatter.name}`,
    );
  }

  // Must not start or end with hyphen
  if (frontmatter.name.startsWith("-") || frontmatter.name.endsWith("-")) {
    throw new Error(`Skill name must not start or end with hyphen: ${frontmatter.name}`);
  }

  // Must not contain consecutive hyphens
  if (frontmatter.name.includes("--")) {
    throw new Error(`Skill name must not contain consecutive hyphens: ${frontmatter.name}`);
  }

  // Validate description
  if (frontmatter.description.length < 1 || frontmatter.description.length > 1024) {
    throw new Error(
      `Skill description must be 1-1024 characters, got ${frontmatter.description.length}`,
    );
  }

  // Validate compatibility if present
  if (frontmatter.compatibility && frontmatter.compatibility.length > 500) {
    throw new Error(
      `Compatibility field must be max 500 characters, got ${frontmatter.compatibility.length}`,
    );
  }

  // Validate metadata if present
  if (frontmatter.metadata) {
    if (typeof frontmatter.metadata !== "object") {
      throw new Error("Metadata must be an object");
    }
    for (const [key, value] of Object.entries(frontmatter.metadata)) {
      if (typeof key !== "string" || typeof value !== "string") {
        throw new Error(
          `Metadata must contain string key-value pairs, got ${key}: ${typeof value}`,
        );
      }
    }
  }
}

// =============================================================================
// Discovery Functions
// =============================================================================

/**
 * Discover files in a subdirectory of the skill directory.
 *
 * @param skillDir - Path to skill directory
 * @param subdir - Subdirectory name (e.g., "scripts", "references", "assets")
 * @returns Array of relative file paths (sorted alphabetically)
 */
async function discoverFiles(skillDir: string, subdir: string): Promise<string[]> {
  const subdirPath = join(skillDir, subdir);

  try {
    const subdirStat = await stat(subdirPath);
    if (!subdirStat.isDirectory()) {
      return [];
    }

    const entries = await readdir(subdirPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort(); // Sort alphabetically for consistent ordering

    return files;
  } catch {
    // Directory doesn't exist or not readable
    return [];
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Get list of scripts from a loaded skill.
 *
 * @param skill - Loaded skill definition
 * @returns Array of script filenames
 *
 * @example
 * ```typescript
 * const skill = await loadSkillFromDirectory("/path/to/git");
 * const scripts = getSkillScripts(skill);
 * // ["status.sh", "commit.py"]
 * ```
 *
 * @category Skills
 */
export function getSkillScripts(skill: SkillDefinition): string[] {
  const scripts = skill.metadata?.scripts;
  return scripts && typeof scripts === "string" ? scripts.split(",") : [];
}

/**
 * Get list of references from a loaded skill.
 *
 * @param skill - Loaded skill definition
 * @returns Array of reference filenames
 *
 * @category Skills
 */
export function getSkillReferences(skill: SkillDefinition): string[] {
  const references = skill.metadata?.references;
  return references && typeof references === "string" ? references.split(",") : [];
}

/**
 * Get list of assets from a loaded skill.
 *
 * @param skill - Loaded skill definition
 * @returns Array of asset filenames
 *
 * @category Skills
 */
export function getSkillAssets(skill: SkillDefinition): string[] {
  const assets = skill.metadata?.assets;
  return assets && typeof assets === "string" ? assets.split(",") : [];
}

/**
 * Get full path to a skill resource.
 *
 * @param skill - Loaded skill definition
 * @param type - Resource type (scripts, references, assets)
 * @param filename - Filename within the resource directory
 * @returns Full path to the resource
 * @throws Error if skill doesn't have a skillPath
 *
 * @example
 * ```typescript
 * const skill = await loadSkillFromDirectory("/path/to/git");
 * const scriptPath = getSkillResourcePath(skill, "scripts", "status.sh");
 * // "/path/to/git/scripts/status.sh"
 * ```
 *
 * @category Skills
 */
export function getSkillResourcePath(
  skill: SkillDefinition,
  type: "scripts" | "references" | "assets",
  filename: string,
): string {
  if (!skill.skillPath) {
    throw new Error(`Skill '${skill.name}' does not have a skillPath`);
  }
  return join(skill.skillPath, type, filename);
}
