/**
 * Tool factory for creating all core tools from configuration.
 *
 * This module provides a unified factory function that creates the minimal
 * set of agent tools: read, write, edit, bash, glob, grep, todo_write, task, skill.
 *
 * @packageDocumentation
 */

import type { LanguageModel, Tool, ToolSet } from "ai";
import type { BackendProtocol, SandboxBackendProtocol } from "../backend.js";
import type { AgentState } from "../backends/state.js";
import type { MCPManager } from "../mcp/manager.js";
import type { Agent, CoreToolName, SkillDefinition, SubagentDefinition } from "../types.js";
import { type BashToolOptions, createBashTool } from "./execute.js";
// Tool creators
import {
  createEditTool,
  createFilesystemTools,
  createGlobTool,
  createGrepTool,
  createReadTool,
  createWriteTool,
  type FilesystemTools,
  type FilesystemToolsOptions,
} from "./filesystem.js";
import { createSearchToolsTool, type SearchToolsOptions } from "./search.js";

import {
  createSkillRegistry,
  createSkillTool,
  type LoadableSkillDefinition,
  SkillRegistry,
  type SkillToolOptions,
} from "./skills.js";

import {
  clearCompletedTasks,
  createTaskTool,
  getBackgroundTask,
  listBackgroundTasks,
  type TaskStatus,
  type TaskToolOptions,
} from "./task.js";
import { createTodoWriteTool, type TodoWriteToolOptions } from "./todos.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating core tools.
 *
 * This is the main configuration interface for the tool factory.
 * Only `backend` and `state` are required - all other options enable
 * additional functionality.
 *
 * @example
 * ```typescript
 * const tools = createCoreTools({
 *   backend: new FilesystemBackend({ rootDir: process.cwd() }),
 *   state: createAgentState(),
 *
 *   // Enable shell execution
 *   sandbox: new LocalSandbox({ cwd: process.cwd() }),
 *
 *   // Enable skill loading
 *   skillRegistry: createSkillRegistry([gitSkill, dockerSkill]),
 *
 *   // Enable subagent delegation
 *   subagents: [researcherAgent, coderAgent],
 *   parentAgent: mainAgent,
 *   defaultModel: anthropic("claude-sonnet-4-20250514"),
 * });
 * ```
 *
 * @category Tools
 */
export interface CoreToolsOptions {
  // === Required ===

  /** Storage backend for file operations */
  backend: BackendProtocol;

  /** Agent state containing todos and virtual filesystem */
  state: AgentState;

  // === Disable Tools ===

  /**
   * Array of core tool names to disable.
   * Takes precedence over individual include options.
   *
   * @example
   * ```typescript
   * const tools = createCoreTools({
   *   backend,
   *   state,
   *   disabled: ["bash", "write"], // Disable bash and write tools
   * });
   * ```
   */
  disabled?: CoreToolName[];

  // === Filesystem Options ===

  /**
   * Include write tool.
   * @defaultValue true
   */
  includeWrite?: boolean;

  /**
   * Include edit tool.
   * @defaultValue true
   */
  includeEdit?: boolean;

  // === Todo Options ===

  /**
   * Include todo_write tool.
   * @defaultValue true
   */
  includeTodoWrite?: boolean;

  /**
   * Callback invoked when todos change.
   */
  onTodosChanged?: TodoWriteToolOptions["onTodosChanged"];

  // === Shell Execution Options ===

  /**
   * Sandbox backend for command execution.
   * If provided, bash tool is included.
   */
  sandbox?: SandboxBackendProtocol;

  /** Options for the bash tool */
  bashOptions?: Omit<BashToolOptions, "sandbox">;

  // === Skill Options ===

  /**
   * Skill registry for progressive disclosure.
   * If provided, the skill tool is included.
   * Takes precedence over `skills` if both are provided.
   */
  skillRegistry?: SkillRegistry;

  /**
   * Array of skill definitions to auto-create a registry from.
   * Alternative to providing a skillRegistry directly.
   * Only skills with tools will be included.
   *
   * @example
   * ```typescript
   * const tools = createCoreTools({
   *   backend,
   *   state,
   *   skills: [gitSkill, dockerSkill],
   * });
   * ```
   */
  skills?: SkillDefinition[];

  /** Options for the skill tool */
  skillToolOptions?: Partial<SkillToolOptions>;

  // === Task/Subagent Options ===

  /**
   * Subagent definitions for task delegation.
   * If provided along with parentAgent and defaultModel, task tool is included.
   */
  subagents?: SubagentDefinition[];

  /** Parent agent for creating subagents (required with subagents) */
  parentAgent?: Agent;

  /** Default model for subagents (required with subagents) */
  defaultModel?: LanguageModel;

  /**
   * Include general-purpose subagent automatically.
   * @defaultValue false
   */
  includeGeneralPurpose?: boolean;

  /** Options for the task tool */
  taskOptions?: Partial<TaskToolOptions>;

  // === Search/MCP Options ===

  /**
   * MCP manager for search_tools meta-tool.
   * If provided, search_tools tool is included.
   */
  mcpManager?: MCPManager;

  /** Options for the search_tools tool */
  searchToolsOptions?: Omit<SearchToolsOptions, "manager">;
}

/**
 * Result from createCoreTools containing all created tools and registries.
 *
 * @category Tools
 */
export interface CoreTools {
  // === Filesystem Tools ===

  /** Read file contents */
  read?: Tool;

  /** Write/create files (if enabled) */
  write?: Tool;

  /** Edit files via replacement (if enabled) */
  edit?: Tool;

  /** Find files by glob pattern */
  glob?: Tool;

  /** Search file contents */
  grep?: Tool;

  // === Todo Tool ===

  /** Write/update todo list (if enabled) */
  todo_write?: Tool;

  // === Bash Tool ===

  /** Shell execution (if sandbox provided) */
  bash?: Tool;

  // === Skill Tool ===

  /** Load skill tool (if registry provided) */
  skill?: Tool;

  // === Task Tool ===

  /** Task delegation tool (if subagents provided) */
  task?: Tool;

  // === Search Tool ===

  /** Tool search/discovery (if mcpManager provided) */
  search_tools?: Tool;

  // === Registries ===

  /** The skill registry (if provided) */
  skillRegistry?: SkillRegistry;
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates all core tools from configuration.
 *
 * This is the recommended way to create agent tools. The minimal tool set is:
 * - `read`, `write`, `edit`, `glob`, `grep` - filesystem operations
 * - `bash` - shell command execution (optional, requires sandbox)
 * - `todo_write` - task tracking (optional)
 * - `task` - subagent delegation (optional, requires subagents)
 * - `skill` - progressive capability loading (optional, requires registry)
 *
 * @param options - Configuration options
 * @returns Object containing all created tools and registries
 *
 * @example
 * ```typescript
 * import { createAgent, createCoreTools, createAgentState } from "@lleverage-ai/agent-sdk";
 * import { FilesystemBackend, LocalSandbox } from "@lleverage-ai/agent-sdk";
 *
 * const state = createAgentState();
 * const backend = new FilesystemBackend({ rootDir: process.cwd() });
 * const sandbox = new LocalSandbox({ cwd: process.cwd() });
 *
 * const tools = createCoreTools({
 *   backend,
 *   state,
 *   sandbox,
 * });
 *
 * const agent = createAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   tools,
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Minimal: just filesystem tools
 * const tools = createCoreTools({
 *   backend: new StateBackend(state),
 *   state,
 *   includeTodoWrite: false,
 * });
 * ```
 *
 * @category Tools
 */
export function createCoreTools(options: CoreToolsOptions): CoreTools {
  const {
    backend,
    state,
    // Disable
    disabled = [],
    // Filesystem
    includeWrite = true,
    includeEdit = true,
    // Todos
    includeTodoWrite = true,
    onTodosChanged,
    // Bash
    sandbox,
    bashOptions = {},
    // Skills
    skillRegistry: providedSkillRegistry,
    skills = [],
    skillToolOptions = {},
    // Tasks
    subagents,
    parentAgent,
    defaultModel,
    includeGeneralPurpose = false,
    taskOptions = {},
    // Search/MCP
    mcpManager,
    searchToolsOptions = {},
  } = options;

  // Create disabled set for efficient lookup
  const disabledSet = new Set(disabled);

  // Helper to check if a tool is disabled
  const isDisabled = (name: CoreToolName): boolean => disabledSet.has(name);

  // Create result object
  const result: CoreTools = {};

  // =========================================================================
  // Filesystem Tools
  // =========================================================================

  if (!isDisabled("read")) {
    result.read = createReadTool(backend);
  }

  if (!isDisabled("glob")) {
    result.glob = createGlobTool(backend);
  }

  if (!isDisabled("grep")) {
    result.grep = createGrepTool(backend);
  }

  if (!isDisabled("write") && includeWrite) {
    result.write = createWriteTool(backend);
  }

  if (!isDisabled("edit") && includeEdit) {
    result.edit = createEditTool(backend);
  }

  // =========================================================================
  // Todo Tool
  // =========================================================================

  if (!isDisabled("todo_write") && includeTodoWrite) {
    result.todo_write = createTodoWriteTool({
      state,
      onTodosChanged,
    });
  }

  // =========================================================================
  // Bash Tool
  // =========================================================================

  if (!isDisabled("bash") && sandbox) {
    result.bash = createBashTool({ sandbox, ...bashOptions });
  }

  // =========================================================================
  // Skill Tool
  // =========================================================================

  if (!isDisabled("skill")) {
    // Use provided registry if available, otherwise create from skills array
    let skillRegistry: SkillRegistry | undefined = providedSkillRegistry;

    if (!skillRegistry && skills.length > 0) {
      // Only include skills that have tools defined
      const skillsWithTools = skills.filter((s) => s.tools);
      if (skillsWithTools.length > 0) {
        skillRegistry = createSkillRegistry(
          skillsWithTools.map((s) => ({
            name: s.name,
            description: s.description,
            prompt: s.prompt,
            tools: s.tools!, // Safe due to filter
          })),
        );
      }
    }

    if (skillRegistry) {
      result.skill = createSkillTool({
        registry: skillRegistry,
        ...skillToolOptions,
      });
      result.skillRegistry = skillRegistry;
    }
  }

  // =========================================================================
  // Task Tool
  // =========================================================================

  if (!isDisabled("task") && subagents && subagents.length > 0 && parentAgent && defaultModel) {
    result.task = createTaskTool({
      subagents,
      defaultModel,
      parentAgent,
      includeGeneralPurpose,
      ...taskOptions,
    });
  }

  // =========================================================================
  // Search Tools (MCP)
  // =========================================================================

  if (!isDisabled("search_tools") && mcpManager) {
    result.search_tools = createSearchToolsTool({
      manager: mcpManager,
      ...searchToolsOptions,
    });
  }

  return result;
}

/**
 * Converts CoreTools to a ToolSet for direct use with AI SDK.
 *
 * This extracts only the tool properties (excluding skillRegistry)
 * and filters out undefined tools.
 *
 * @param coreTools - The core tools object from createCoreTools
 * @returns A ToolSet compatible with AI SDK
 *
 * @example
 * ```typescript
 * const coreTools = createCoreTools({ backend, state });
 * const toolSet = coreToolsToToolSet(coreTools);
 *
 * const result = await generateText({
 *   model,
 *   tools: toolSet,
 *   prompt: "...",
 * });
 * ```
 *
 * @category Tools
 */
export function coreToolsToToolSet(coreTools: CoreTools): ToolSet {
  const {
    skillRegistry: _registry, // Exclude non-tool property
    ...tools
  } = coreTools;

  // Filter out undefined tools
  const result: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (tool !== undefined) {
      result[name] = tool;
    }
  }
  return result;
}

// =============================================================================
// Convenience Exports
// =============================================================================

/**
 * Creates filesystem tools only.
 *
 * Use this when you only need file operations without other tools.
 *
 * @param options - Filesystem tools options
 * @returns Object containing filesystem tools
 *
 * @example
 * ```typescript
 * const fsTools = createFilesystemToolsOnly({
 *   backend: new FilesystemBackend({ rootDir: process.cwd() }),
 * });
 * ```
 *
 * @category Tools
 */
export function createFilesystemToolsOnly(options: FilesystemToolsOptions): FilesystemTools {
  return createFilesystemTools(options);
}

// Re-export individual tool creators for maximum flexibility
export {
  // Filesystem
  createReadTool,
  createWriteTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createFilesystemTools,
  // Todos
  createTodoWriteTool,
  // Bash
  createBashTool,
  // Skills
  SkillRegistry,
  createSkillTool,
  createSkillRegistry,
  // Tasks
  createTaskTool,
  getBackgroundTask,
  listBackgroundTasks,
  clearCompletedTasks,
  // Search
  createSearchToolsTool,
};

// Re-export types
export type {
  // Filesystem
  FilesystemTools,
  FilesystemToolsOptions,
  // Todos
  TodoWriteToolOptions,
  // Bash
  BashToolOptions,
  // Skills
  LoadableSkillDefinition,
  SkillToolOptions,
  // Tasks
  TaskToolOptions,
  TaskStatus,
  // Search
  SearchToolsOptions,
};
