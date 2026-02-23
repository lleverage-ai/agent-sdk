/**
 * Filesystem plugin loader.
 *
 * Loads plugin packages from disk and converts them into SDK plugin and subagent
 * definitions.
 *
 * @packageDocumentation
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYamlString } from "yaml";
import { loadSkillsFromDirectories } from "../skills/loader.js";
import { createSubagent } from "../subagents.js";
import type { SkillDefinition } from "../tools/skills.js";
import type {
  Agent,
  AgentPlugin,
  HookRegistration,
  LanguageModel,
  MCPServerConfig,
  PluginSubagent,
  StreamingToolsFactory,
  SubagentDefinition,
  ToolSet,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Filesystem plugin manifest (`plugin.json`).
 *
 * @category Plugins
 */
export interface FilesystemPluginManifest {
  /** Plugin identifier used as `AgentPlugin.name` */
  name: string;

  /** Human-readable description */
  description?: string;

  /** Whether plugin tools should be deferred/proxied by default */
  deferred?: boolean;

  /** Relative path to plugin code entrypoint. @defaultValue "./plugin.js" */
  entrypoint?: string;

  /** Relative path to bundled skills directory. @defaultValue "skills" */
  skillsDir?: string;

  /** Relative path to bundled agent definitions directory. @defaultValue "agents" */
  agentsDir?: string;
}

/**
 * Plugin MCP configuration file (`mcp.json`).
 *
 * @category Plugins
 */
export interface FilesystemPluginMCPConfig {
  /** Named MCP server definitions for this plugin package */
  servers: Record<string, MCPServerConfig>;
}

/**
 * Optional code-entrypoint exports for a filesystem plugin package.
 *
 * @category Plugins
 */
export interface FilesystemPluginEntrypoint {
  /** Plugin tools */
  tools?: ToolSet | StreamingToolsFactory;

  /** Programmatic skills merged with file-based skills */
  skills?: SkillDefinition[];

  /** Plugin hooks */
  hooks?: HookRegistration;

  /** Plugin setup callback */
  setup?: (agent: Agent) => void | Promise<void>;

  /** Deferred/proxy loading preference override */
  deferred?: boolean;

  /** Optional plugin-owned subagent config */
  subagent?: PluginSubagent;

  /** Optional single MCP server definition */
  mcpServer?: MCPServerConfig;

  /** Optional named MCP server definitions */
  mcpServers?: Record<string, MCPServerConfig>;
}

/**
 * Frontmatter for `agents/*.md` files.
 *
 * @category Plugins
 */
export interface FilesystemAgentFrontmatter {
  /** Optional subagent name suffix. Defaults to filename without extension. */
  name?: string;

  /** Required subagent description */
  description: string;

  /**
   * Model identifier:
   * - `"inherit"` to inherit parent/default model
   * - custom string resolved via `LoadPluginsOptions.resolveModel`
   */
  model?: string;

  /** Optional tool allowlist */
  allowedTools?: string[];

  /** Optional plugin refs (`self`, `self:mcp`, or explicit plugin names) */
  plugins?: string[];

  /** Enable streaming output for this subagent */
  streaming?: boolean;
}

/**
 * Parsed filesystem agent definition from `agents/*.md`.
 *
 * Use {@link createSubagentDefinitionsFromFilesystemAgents} to convert these
 * into runtime {@link SubagentDefinition} values.
 *
 * @category Plugins
 */
export interface FilesystemAgentDefinition {
  /** Owning plugin name */
  pluginName: string;

  /** Agent name (filename or frontmatter override) */
  name: string;

  /** Generated subagent type identifier */
  type: string;

  /** Human-readable subagent description */
  description: string;

  /** Subagent system prompt body */
  prompt: string;

  /** Optional model override (`inherit` or resolved model) */
  model?: LanguageModel | "inherit";

  /** Optional tool allowlist */
  allowedTools?: string[];

  /** Optional plugin context for this subagent */
  plugins?: AgentPlugin[];

  /** Whether the subagent should stream custom data */
  streaming?: boolean;

  /** Source markdown file path */
  sourcePath: string;
}

/**
 * Error emitted while loading filesystem plugins.
 *
 * @category Plugins
 */
export interface PluginLoadError {
  /** Path associated with the error */
  path: string;

  /** Human-readable error summary */
  error: string;

  /** Optional details for diagnostics */
  details?: string;
}

/**
 * Options for filesystem plugin loading.
 *
 * @category Plugins
 */
export interface LoadPluginsOptions {
  /**
   * Validate loaded artifacts (manifest + agent frontmatter).
   * @defaultValue true
   */
  validate?: boolean;

  /**
   * Include hidden directories when discovering plugins.
   * @defaultValue false
   */
  includeHidden?: boolean;

  /**
   * Allow importing plugin code entrypoints (`plugin.js`).
   *
   * Disabled by default for safer, declarative loading.
   * @defaultValue false
   */
  allowCodeEntrypoint?: boolean;

  /**
   * Resolve model identifiers found in `agents/*.md` frontmatter.
   *
   * When omitted, only `model: inherit` is accepted.
   */
  resolveModel?: (
    modelId: string,
    context: { pluginName: string; agentPath: string },
  ) => LanguageModel | undefined;

  /**
   * Optional parent-agent getter used to auto-create `subagents` in the result.
   *
   * If omitted, `result.subagents` is empty and callers can create subagents
   * later via {@link createSubagentDefinitionsFromFilesystemAgents}.
   */
  getParentAgent?: () => Agent | undefined;
}

/**
 * Result from loading filesystem plugins.
 *
 * @category Plugins
 */
export interface PluginLoadResult {
  /** Loaded plugins ready for `createAgent({ plugins })` */
  plugins: AgentPlugin[];

  /** Parsed agent definitions from `agents/*.md` */
  agents: FilesystemAgentDefinition[];

  /** Materialized subagent definitions (if `getParentAgent` is provided) */
  subagents: SubagentDefinition[];

  /** Non-fatal load errors */
  errors: PluginLoadError[];
}

// =============================================================================
// Loader APIs
// =============================================================================

/**
 * Load plugin packages from one or more directories.
 *
 * Discovery rules:
 * - Accepts directories that contain `plugin.json`
 * - Also scans one level deeper for namespace-style layouts
 *   (`<root>/<namespace>/<plugin>/plugin.json`)
 *
 * @param directories - Root directories to scan
 * @param options - Load options
 * @returns Loaded plugins, parsed agents, optional subagents, and errors
 *
 * @example
 * ```typescript
 * let agent: Agent;
 *
 * const loaded = await loadPluginsFromDirectories(["./plugins"], {
 *   allowCodeEntrypoint: true,
 *   getParentAgent: () => agent,
 * });
 *
 * agent = createAgent({
 *   model,
 *   plugins: loaded.plugins,
 *   subagents: loaded.subagents,
 * });
 * ```
 *
 * @category Plugins
 */
export async function loadPluginsFromDirectories(
  directories: string[],
  options: LoadPluginsOptions = {},
): Promise<PluginLoadResult> {
  const plugins: AgentPlugin[] = [];
  const agents: FilesystemAgentDefinition[] = [];
  const errors: PluginLoadError[] = [];

  const seenPluginNames = new Set<string>();
  const discovered = new Set<string>();

  for (const directory of directories) {
    try {
      const candidateDirs = await discoverPluginDirectories(directory, options);
      for (const candidate of candidateDirs) {
        if (!discovered.has(candidate)) {
          discovered.add(candidate);
        }
      }
    } catch (error) {
      errors.push({
        path: directory,
        error: `Failed to discover plugins: ${error instanceof Error ? error.message : String(error)}`,
        details: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  const sortedPluginDirs = Array.from(discovered).sort();

  for (const pluginDir of sortedPluginDirs) {
    try {
      const loaded = await loadPluginFromDirectory(pluginDir, options);

      const duplicateNames = loaded.plugins
        .map((p) => p.name)
        .filter((name) => seenPluginNames.has(name));

      if (duplicateNames.length > 0) {
        errors.push({
          path: pluginDir,
          error: `Duplicate plugin names: ${duplicateNames.join(", ")}. Plugin package skipped.`,
        });
        continue;
      }

      for (const plugin of loaded.plugins) {
        seenPluginNames.add(plugin.name);
        plugins.push(plugin);
      }

      agents.push(...loaded.agents);
      errors.push(...loaded.errors);
    } catch (error) {
      errors.push({
        path: pluginDir,
        error: `Failed to load plugin package: ${error instanceof Error ? error.message : String(error)}`,
        details: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  const subagents = options.getParentAgent
    ? createSubagentDefinitionsFromFilesystemAgents({
        agents,
        getParentAgent: options.getParentAgent,
      })
    : [];

  return {
    plugins,
    agents,
    subagents,
    errors,
  };
}

/**
 * Load a single plugin package directory.
 *
 * @param directory - Plugin package directory containing `plugin.json`
 * @param options - Load options
 * @returns Loaded plugin entries, parsed agents, and non-fatal errors
 *
 * @category Plugins
 */
export async function loadPluginFromDirectory(
  directory: string,
  options: LoadPluginsOptions = {},
): Promise<PluginLoadResult> {
  const validate = options.validate ?? true;
  const plugins: AgentPlugin[] = [];
  const agents: FilesystemAgentDefinition[] = [];
  const errors: PluginLoadError[] = [];

  const pluginDir = resolve(directory);
  const manifestPath = join(pluginDir, "plugin.json");
  const manifest = await readManifestFile(manifestPath, validate);

  const codeEntrypoint = await readCodeEntrypoint(pluginDir, manifest, options, errors);

  const skillsDir = join(pluginDir, manifest.skillsDir ?? "skills");
  const fileSkills = await readSkills(skillsDir, options, errors);

  const allSkills = [...fileSkills, ...(codeEntrypoint?.skills ?? [])];

  const basePlugin: AgentPlugin = {
    name: manifest.name,
    description: manifest.description,
    setup: codeEntrypoint?.setup,
    tools: codeEntrypoint?.tools,
    mcpServer: codeEntrypoint?.mcpServer,
    skills: allSkills.length > 0 ? allSkills : undefined,
    hooks: codeEntrypoint?.hooks,
    deferred: codeEntrypoint?.deferred ?? manifest.deferred,
    subagent: codeEntrypoint?.subagent,
  };

  plugins.push(basePlugin);

  const mcpServers = await collectMcpServers(pluginDir, codeEntrypoint, errors);
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    plugins.push({
      name: `${manifest.name}__${serverName}`,
      description: manifest.description
        ? `${manifest.description} (MCP: ${serverName})`
        : `MCP server '${serverName}' from plugin '${manifest.name}'`,
      mcpServer: serverConfig,
    });
  }

  const agentsDir = join(pluginDir, manifest.agentsDir ?? "agents");
  const loadedAgents = await readFilesystemAgents({
    plugin: basePlugin,
    mcpPlugins: plugins.filter((p) => p.name.startsWith(`${manifest.name}__`)),
    agentsDir,
    options,
  });

  agents.push(...loadedAgents.agents);
  errors.push(...loadedAgents.errors);

  return {
    plugins,
    agents,
    subagents: [],
    errors,
  };
}

/**
 * Convert parsed filesystem agents into runtime subagent definitions.
 *
 * @param input - Parsed agents and a getter for the parent agent instance
 * @returns Subagent definitions suitable for `createAgent({ subagents })`
 *
 * @example
 * ```typescript
 * let agent: Agent;
 * const loaded = await loadPluginsFromDirectories(["./plugins"]);
 *
 * const subagents = createSubagentDefinitionsFromFilesystemAgents({
 *   agents: loaded.agents,
 *   getParentAgent: () => agent,
 * });
 *
 * agent = createAgent({ model, plugins: loaded.plugins, subagents });
 * ```
 *
 * @category Plugins
 */
export function createSubagentDefinitionsFromFilesystemAgents(input: {
  agents: FilesystemAgentDefinition[];
  getParentAgent: () => Agent | undefined;
}): SubagentDefinition[] {
  const { agents, getParentAgent } = input;

  return agents.map((agentDef) => ({
    type: agentDef.type,
    description: agentDef.description,
    model: agentDef.model,
    allowedTools: agentDef.allowedTools,
    plugins: agentDef.plugins,
    streaming: agentDef.streaming,
    create: (ctx) => {
      const parentAgent = getParentAgent();
      if (!parentAgent) {
        throw new Error(
          `Parent agent is not available while creating subagent '${agentDef.type}'. ` +
            "Ensure getParentAgent() returns the initialized agent instance.",
        );
      }

      return createSubagent(parentAgent, {
        name: agentDef.name,
        description: agentDef.description,
        model: ctx.model,
        systemPrompt: agentDef.prompt,
        allowedTools: ctx.allowedTools,
        plugins: ctx.plugins,
      });
    },
  }));
}

// =============================================================================
// Internal helpers
// =============================================================================

interface ParsedMarkdownFile<TFrontmatter> {
  frontmatter: TFrontmatter;
  body: string;
}

interface LoadedAgentsResult {
  agents: FilesystemAgentDefinition[];
  errors: PluginLoadError[];
}

async function discoverPluginDirectories(
  rootDirectory: string,
  options: LoadPluginsOptions,
): Promise<string[]> {
  const includeHidden = options.includeHidden ?? false;
  const discovered = new Set<string>();
  const root = resolve(rootDirectory);

  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error("Not a directory");
  }

  if (await isFile(join(root, "plugin.json"))) {
    discovered.add(root);
  }

  const levelOne = await readdir(root, { withFileTypes: true });
  for (const entry of levelOne) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (!includeHidden && entry.name.startsWith(".")) {
      continue;
    }

    const levelOneDir = join(root, entry.name);
    if (await isFile(join(levelOneDir, "plugin.json"))) {
      discovered.add(levelOneDir);
      continue;
    }

    const levelTwo = await readdir(levelOneDir, { withFileTypes: true });
    for (const nested of levelTwo) {
      if (!nested.isDirectory()) {
        continue;
      }
      if (!includeHidden && nested.name.startsWith(".")) {
        continue;
      }

      const levelTwoDir = join(levelOneDir, nested.name);
      if (await isFile(join(levelTwoDir, "plugin.json"))) {
        discovered.add(levelTwoDir);
      }
    }
  }

  return Array.from(discovered);
}

async function readManifestFile(
  manifestPath: string,
  validate: boolean,
): Promise<FilesystemPluginManifest> {
  const parsed = await readJsonFile<unknown>(manifestPath);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("plugin.json must be a JSON object");
  }

  const raw = parsed as Record<string, unknown>;
  const manifest: FilesystemPluginManifest = {
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : undefined,
    deferred: typeof raw.deferred === "boolean" ? raw.deferred : undefined,
    entrypoint: typeof raw.entrypoint === "string" ? raw.entrypoint : undefined,
    skillsDir: typeof raw.skillsDir === "string" ? raw.skillsDir : undefined,
    agentsDir: typeof raw.agentsDir === "string" ? raw.agentsDir : undefined,
  };

  if (validate) {
    validateManifest(manifest, manifestPath);
  }

  return manifest;
}

function validateManifest(manifest: FilesystemPluginManifest, manifestPath: string): void {
  if (!manifest.name) {
    throw new Error(`Invalid plugin manifest at '${manifestPath}': 'name' is required`);
  }

  if (!/^[a-z0-9-]+$/.test(manifest.name)) {
    throw new Error(
      `Invalid plugin manifest at '${manifestPath}': name must contain lowercase letters, numbers, and hyphens`,
    );
  }

  if (
    manifest.name.startsWith("-") ||
    manifest.name.endsWith("-") ||
    manifest.name.includes("--")
  ) {
    throw new Error(
      `Invalid plugin manifest at '${manifestPath}': name cannot start/end with hyphen or contain consecutive hyphens`,
    );
  }
}

async function readCodeEntrypoint(
  pluginDir: string,
  manifest: FilesystemPluginManifest,
  options: LoadPluginsOptions,
  errors: PluginLoadError[],
): Promise<FilesystemPluginEntrypoint | undefined> {
  if (!(options.allowCodeEntrypoint ?? false)) {
    return undefined;
  }

  const entrypointRel = manifest.entrypoint ?? "./plugin.js";
  const entrypointPath = resolve(pluginDir, entrypointRel);

  if (!(await isFile(entrypointPath))) {
    return undefined;
  }

  try {
    const module = (await import(pathToFileURL(entrypointPath).href)) as Record<string, unknown>;
    const exported = (module.plugin ?? module.default) as unknown;

    if (!exported) {
      return undefined;
    }

    if (typeof exported !== "object") {
      throw new Error("Entrypoint export must be an object");
    }

    return exported as FilesystemPluginEntrypoint;
  } catch (error) {
    errors.push({
      path: entrypointPath,
      error: `Failed to load plugin entrypoint: ${error instanceof Error ? error.message : String(error)}`,
      details: error instanceof Error ? error.stack : undefined,
    });
    return undefined;
  }
}

async function readSkills(
  skillsDir: string,
  options: LoadPluginsOptions,
  errors: PluginLoadError[],
): Promise<SkillDefinition[]> {
  if (!(await isDirectory(skillsDir))) {
    return [];
  }

  const loadResult = await loadSkillsFromDirectories([skillsDir], {
    validate: options.validate,
    includeHidden: options.includeHidden,
  });

  for (const error of loadResult.errors) {
    errors.push({
      path: error.path,
      error: `Skill load error: ${error.error}`,
      details: error.details,
    });
  }

  return loadResult.skills;
}

async function collectMcpServers(
  pluginDir: string,
  codeEntrypoint: FilesystemPluginEntrypoint | undefined,
  errors: PluginLoadError[],
): Promise<Record<string, MCPServerConfig>> {
  const servers: Record<string, MCPServerConfig> = {};

  const mcpFilePath = join(pluginDir, "mcp.json");
  if (await isFile(mcpFilePath)) {
    try {
      const parsed = await readJsonFile<unknown>(mcpFilePath);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("mcp.json must be a JSON object");
      }

      const raw = parsed as Record<string, unknown>;
      const rawServers = raw.servers;
      if (!rawServers || typeof rawServers !== "object") {
        throw new Error("mcp.json must contain an object field 'servers'");
      }

      for (const [name, config] of Object.entries(rawServers as Record<string, unknown>)) {
        if (typeof name !== "string" || !name) {
          continue;
        }
        if (!config || typeof config !== "object") {
          continue;
        }
        servers[name] = config as MCPServerConfig;
      }
    } catch (error) {
      errors.push({
        path: mcpFilePath,
        error: `Failed to parse mcp.json: ${error instanceof Error ? error.message : String(error)}`,
        details: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  if (codeEntrypoint?.mcpServers) {
    for (const [name, config] of Object.entries(codeEntrypoint.mcpServers)) {
      servers[name] = config;
    }
  }

  return servers;
}

async function readFilesystemAgents(input: {
  plugin: AgentPlugin;
  mcpPlugins: AgentPlugin[];
  agentsDir: string;
  options: LoadPluginsOptions;
}): Promise<LoadedAgentsResult> {
  const { plugin, mcpPlugins, agentsDir, options } = input;
  const validate = options.validate ?? true;

  if (!(await isDirectory(agentsDir))) {
    return { agents: [], errors: [] };
  }

  const agents: FilesystemAgentDefinition[] = [];
  const errors: PluginLoadError[] = [];

  const entries = await readdir(agentsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".md")
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const file of files) {
    const filePath = join(agentsDir, file.name);
    try {
      const content = await readFile(filePath, "utf-8");
      const { frontmatter, body } = parseMarkdownFrontmatter<FilesystemAgentFrontmatter>(content);

      const fallbackName = basename(file.name, ".md");
      const agentName =
        typeof frontmatter.name === "string" && frontmatter.name.trim().length > 0
          ? frontmatter.name.trim()
          : fallbackName;

      const description =
        typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";

      if (validate && !description) {
        throw new Error("Agent frontmatter requires a non-empty 'description'");
      }

      const resolvedModel = resolveAgentModel(frontmatter.model, {
        pluginName: plugin.name,
        agentPath: filePath,
        resolveModel: options.resolveModel,
      });

      const allowedTools = parseStringArray(frontmatter.allowedTools, "allowedTools", filePath);
      const pluginRefs = parsePluginRefs(frontmatter.plugins);
      const resolvedPlugins = resolveAgentPluginRefs(pluginRefs, {
        plugin,
        mcpPlugins,
      });

      const agent: FilesystemAgentDefinition = {
        pluginName: plugin.name,
        name: agentName,
        type: `plugin:${plugin.name}:${agentName}`,
        description,
        prompt: body.trim(),
        model: resolvedModel,
        allowedTools,
        plugins: resolvedPlugins.length > 0 ? resolvedPlugins : undefined,
        streaming: typeof frontmatter.streaming === "boolean" ? frontmatter.streaming : undefined,
        sourcePath: filePath,
      };

      agents.push(agent);
    } catch (error) {
      errors.push({
        path: filePath,
        error: `Failed to parse agent file: ${error instanceof Error ? error.message : String(error)}`,
        details: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  return { agents, errors };
}

function resolveAgentModel(
  modelValue: unknown,
  context: {
    pluginName: string;
    agentPath: string;
    resolveModel?: (
      modelId: string,
      context: { pluginName: string; agentPath: string },
    ) => LanguageModel | undefined;
  },
): LanguageModel | "inherit" | undefined {
  if (modelValue == null) {
    return undefined;
  }

  if (modelValue === "inherit") {
    return "inherit";
  }

  if (typeof modelValue !== "string" || modelValue.trim().length === 0) {
    throw new Error("Agent frontmatter 'model' must be a string");
  }

  if (!context.resolveModel) {
    throw new Error(
      `Agent model '${modelValue}' requires LoadPluginsOptions.resolveModel to map it to a LanguageModel`,
    );
  }

  const resolved = context.resolveModel(modelValue, {
    pluginName: context.pluginName,
    agentPath: context.agentPath,
  });

  if (!resolved) {
    throw new Error(`Could not resolve model identifier '${modelValue}'`);
  }

  return resolved;
}

function parsePluginRefs(value: unknown): string[] {
  if (value == null) {
    return ["self"];
  }

  return parseStringArray(value, "plugins", "agent frontmatter");
}

function resolveAgentPluginRefs(
  refs: string[],
  context: { plugin: AgentPlugin; mcpPlugins: AgentPlugin[] },
): AgentPlugin[] {
  const resolved: AgentPlugin[] = [];
  const byName = new Map<string, AgentPlugin>();

  byName.set(context.plugin.name, context.plugin);
  for (const plugin of context.mcpPlugins) {
    byName.set(plugin.name, plugin);
  }

  for (const ref of refs) {
    if (ref === "self") {
      resolved.push(context.plugin);
      continue;
    }

    if (ref === "self:mcp") {
      resolved.push(...context.mcpPlugins);
      continue;
    }

    const found = byName.get(ref);
    if (!found) {
      throw new Error(`Unknown plugin reference '${ref}'`);
    }

    resolved.push(found);
  }

  const seen = new Set<string>();
  return resolved.filter((plugin) => {
    if (seen.has(plugin.name)) {
      return false;
    }
    seen.add(plugin.name);
    return true;
  });
}

function parseStringArray(value: unknown, fieldName: string, sourcePath: string): string[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Field '${fieldName}' must be an array in ${sourcePath}`);
  }

  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`Field '${fieldName}' must contain only strings in ${sourcePath}`);
    }
    const trimmed = item.trim();
    if (trimmed.length > 0) {
      result.push(trimmed);
    }
  }

  return result;
}

function parseMarkdownFrontmatter<TFrontmatter>(content: string): ParsedMarkdownFile<TFrontmatter> {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    throw new Error("Missing YAML frontmatter (must start and end with ---)");
  }

  const frontmatterYaml = match[1];
  if (frontmatterYaml == null) {
    throw new Error("Frontmatter is missing");
  }
  const body = match[2] ?? "";

  let parsed: unknown;
  try {
    parsed = parseYamlString(frontmatterYaml);
  } catch (error) {
    throw new Error(
      `Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Frontmatter must be a YAML mapping");
  }

  return {
    frontmatter: parsed as TFrontmatter,
    body,
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as T;
}

async function isFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}
