/**
 * Tool factory for creating all core tools from configuration.
 *
 * This module provides a unified factory function that creates the minimal
 * set of agent tools: read, write, edit, bash, glob, grep, todo_write, task, skill.
 *
 * @packageDocumentation
 */

import type { LanguageModel, Tool, ToolSet } from "ai";
import type { BackendProtocol } from "../backend.js";
import { hasExecuteCapability } from "../backend.js";
import type { AgentState } from "../backends/state.js";
import type { MCPManager } from "../mcp/manager.js";
import type { TaskManager } from "../task-manager.js";
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
  createTaskOutputTool,
  createTaskTool,
  getBackgroundTask,
  listBackgroundTasks,
  type TaskOutputToolOptions,
  type TaskStatus,
  type TaskToolOptions,
} from "./task.js";
import {
  createKillTaskTool,
  createListTasksTool,
  type KillTaskToolOptions,
  type ListTasksToolOptions,
} from "./task-management.js";
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
 *   backend: new FilesystemBackend({ rootDir: process.cwd(), enableBash: true }),
 *   state: createAgentState(),
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
   * Whether to include the bash tool if the backend has execute capability.
   * When true (default), bash tool is automatically included if `hasExecuteCapability(backend)` is true.
   * Set to false to explicitly disable bash even if backend supports it.
   * @defaultValue true
   */
  includeBash?: boolean;

  /** Options for the bash tool (excluding backend) */
  bashOptions?: Omit<BashToolOptions, "backend" | "taskManager">;

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
   * Task manager for background task tracking.
   * If provided, enables background execution for bash and task tools,
   * and includes kill_task and list_tasks tools.
   */
  taskManager?: TaskManager;

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
   * @defaultValue true
   */
  includeGeneralPurpose?: boolean;

  /** Options for the task tool */
  taskOptions?: Partial<Omit<TaskToolOptions, "taskManager">>;

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
 * Core tools created by createCoreTools.
 *
 * This is a clean ToolSet containing only the tools, without registries.
 * Each tool is optional depending on the configuration provided.
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

  /** Shell execution (if backend has execute capability or sandbox provided) */
  bash?: Tool;

  // === Skill Tool ===

  /** Load skill tool (if registry provided) */
  skill?: Tool;

  // === Task Tools ===

  /** Task delegation tool (if subagents provided) */
  task?: Tool;

  /** Task output retrieval tool (if task tool is included) */
  task_output?: Tool;

  /** Kill a running background task (if taskManager provided) */
  kill_task?: Tool;

  /** List background tasks (if taskManager provided) */
  list_tasks?: Tool;

  // === Search Tool ===

  /** Tool search/discovery (if mcpManager provided) */
  search_tools?: Tool;
}

/**
 * Result from createCoreTools containing tools and optional registries.
 *
 * @category Tools
 */
export interface CreateCoreToolsResult {
  /** The created core tools */
  tools: CoreTools;

  /** The skill registry (if skills were provided) */
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
 * - `bash` - shell command execution (if backend has execute capability)
 * - `todo_write` - task tracking (optional)
 * - `task` - subagent delegation (optional, requires subagents)
 * - `skill` - progressive capability loading (optional, requires registry)
 *
 * @param options - Configuration options
 * @returns Object containing tools and optional registries
 *
 * @example
 * ```typescript
 * import { createAgent, createCoreTools, createAgentState } from "@lleverage-ai/agent-sdk";
 * import { FilesystemBackend } from "@lleverage-ai/agent-sdk";
 *
 * const state = createAgentState();
 *
 * // Backend with bash enabled - bash tool is automatically included
 * const backend = new FilesystemBackend({
 *   rootDir: process.cwd(),
 *   enableBash: true,
 * });
 *
 * const { tools } = createCoreTools({
 *   backend,
 *   state,
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
 * // Minimal: just filesystem tools (no bash)
 * const backend = new FilesystemBackend({ rootDir: process.cwd() });
 * const { tools } = createCoreTools({
 *   backend,
 *   state,
 *   includeTodoWrite: false,
 * });
 * ```
 *
 * @category Tools
 */
export function createCoreTools(options: CoreToolsOptions): CreateCoreToolsResult {
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
    includeBash = true,
    bashOptions = {},
    // Skills
    skillRegistry: providedSkillRegistry,
    skills = [],
    skillToolOptions = {},
    // Tasks
    taskManager,
    subagents,
    parentAgent,
    defaultModel,
    includeGeneralPurpose = true,
    taskOptions = {},
    // Search/MCP
    mcpManager,
    searchToolsOptions = {},
  } = options;

  // Create disabled set for efficient lookup
  const disabledSet = new Set(disabled);

  // Helper to check if a tool is disabled
  const isDisabled = (name: CoreToolName): boolean => disabledSet.has(name);

  // Create tools object
  const tools: CoreTools = {};

  // Track skill registry separately
  let resultSkillRegistry: SkillRegistry | undefined;

  // =========================================================================
  // Filesystem Tools
  // =========================================================================

  if (!isDisabled("read")) {
    tools.read = createReadTool(backend);
  }

  if (!isDisabled("glob")) {
    tools.glob = createGlobTool(backend);
  }

  if (!isDisabled("grep")) {
    tools.grep = createGrepTool(backend);
  }

  if (!isDisabled("write") && includeWrite) {
    tools.write = createWriteTool(backend);
  }

  if (!isDisabled("edit") && includeEdit) {
    tools.edit = createEditTool(backend);
  }

  // =========================================================================
  // Todo Tool
  // =========================================================================

  if (!isDisabled("todo_write") && includeTodoWrite) {
    tools.todo_write = createTodoWriteTool({
      state,
      onTodosChanged,
    });
  }

  // =========================================================================
  // Bash Tool
  // =========================================================================

  if (!isDisabled("bash") && includeBash && hasExecuteCapability(backend)) {
    tools.bash = createBashTool({ backend, ...bashOptions, taskManager });
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
      tools.skill = createSkillTool({
        registry: skillRegistry,
        ...skillToolOptions,
      });
      resultSkillRegistry = skillRegistry;
    }
  }

  // =========================================================================
  // Task Tool
  // =========================================================================

  // Task tool requires parentAgent and defaultModel
  // Include when: explicit subagents provided OR includeGeneralPurpose is true
  if (
    !isDisabled("task") &&
    parentAgent &&
    defaultModel &&
    ((subagents && subagents.length > 0) || includeGeneralPurpose)
  ) {
    tools.task = createTaskTool({
      subagents: subagents ?? [],
      defaultModel,
      parentAgent,
      includeGeneralPurpose,
      ...taskOptions,
      taskManager,
    });

    // Include task_output tool alongside task tool for retrieving background task results
    if (!isDisabled("task_output")) {
      tools.task_output = createTaskOutputTool({
        taskStore: taskOptions?.taskStore,
        taskManager,
      });
    }
  }

  // =========================================================================
  // Task Management Tools (kill_task, list_tasks)
  // =========================================================================

  // These tools are included when a taskManager is provided
  if (taskManager) {
    if (!isDisabled("kill_task")) {
      tools.kill_task = createKillTaskTool({ taskManager });
    }

    if (!isDisabled("list_tasks")) {
      tools.list_tasks = createListTasksTool({ taskManager });
    }
  }

  // =========================================================================
  // Search Tools (MCP)
  // =========================================================================

  if (!isDisabled("search_tools") && mcpManager) {
    tools.search_tools = createSearchToolsTool({
      manager: mcpManager,
      ...searchToolsOptions,
    });
  }

  return {
    tools,
    skillRegistry: resultSkillRegistry,
  };
}

/**
 * Converts CoreTools to a ToolSet for direct use with AI SDK.
 *
 * Filters out undefined tools and returns a clean ToolSet.
 *
 * @param coreTools - The core tools object from createCoreTools
 * @returns A ToolSet compatible with AI SDK
 *
 * @example
 * ```typescript
 * const { tools } = createCoreTools({ backend, state });
 * const toolSet = coreToolsToToolSet(tools);
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
  const toolsOnly: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(coreTools)) {
    if (value !== undefined) {
      toolsOnly[key] = value;
    }
  }
  return toolsOnly as ToolSet;
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
  createTaskOutputTool,
  createTaskTool,
  getBackgroundTask,
  listBackgroundTasks,
  clearCompletedTasks,
  // Task Management
  createKillTaskTool,
  createListTasksTool,
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
  TaskOutputToolOptions,
  TaskToolOptions,
  TaskStatus,
  // Task Management
  KillTaskToolOptions,
  ListTasksToolOptions,
  // Search
  SearchToolsOptions,
};
