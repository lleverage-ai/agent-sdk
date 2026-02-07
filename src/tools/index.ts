/**
 * Core tools for agent operations.
 *
 * This module provides factory functions for creating the minimal tool set:
 * - `read`, `write`, `edit`, `glob`, `grep` - filesystem operations
 * - `bash` - shell command execution
 * - `todo_write` - task tracking
 * - `task` - subagent delegation
 * - `skill` - progressive capability loading
 *
 * @packageDocumentation
 */

export type { BashResult, BashToolOptions } from "./execute.js";
// Bash tool
export { createBashTool } from "./execute.js";
// Tool factory - internal exports for agent.ts
// Note: createCoreTools is intentionally NOT exported publicly.
// Users should use createAgent() which handles tool creation automatically.
export {
  coreToolsToToolSet,
  createCoreTools,
  createFilesystemToolsOnly,
  type CoreTools,
  type CoreToolsOptions,
  type CreateCoreToolsResult,
} from "./factory.js";
export type { FilesystemTools, FilesystemToolsOptions } from "./filesystem.js";
// Filesystem tools
export {
  createEditTool,
  createFilesystemTools,
  createGlobTool,
  createGrepTool,
  createReadTool,
  createWriteTool,
} from "./filesystem.js";
export type { SearchToolsOptions } from "./search.js";
// Search tools (MCP integration)
export { createSearchToolsTool } from "./search.js";
export type {
  SkillDefinition,
  SkillLoadResult,
  SkillRegistryOptions,
  SkillToolOptions,
} from "./skills.js";
// Skill tool (progressive disclosure)
export {
  createSkillRegistry,
  createSkillTool,
  SkillRegistry,
} from "./skills.js";
export type {
  TaskOutputToolOptions,
  TaskStatus,
  TaskToolOptions,
} from "./task.js";
// Task tool (subagent delegation)
export {
  cleanupStaleTasks,
  clearCompletedTasks,
  createTaskOutputTool,
  createTaskTool,
  getBackgroundTask,
  listBackgroundTasks,
  recoverFailedTasks,
  recoverRunningTasks,
} from "./task.js";
export type { KillTaskToolOptions, ListTasksToolOptions } from "./task-management.js";
// Task management tools (kill/list background tasks)
export { createKillTaskTool, createListTasksTool } from "./task-management.js";
export type {
  OnTodosChanged,
  TodoChangeType,
  TodoInput,
  TodosChangedData,
  TodoWriteToolOptions,
} from "./todos.js";
// Todo tool
export { createTodoWriteTool } from "./todos.js";
export type {
  ToolLoadResult,
  ToolMetadata,
  ToolRegistryOptions,
  ToolSearchOptions,
  UseToolsToolOptions,
} from "./tool-registry.js";
// Tool registry (deferred tool loading)
export {
  createToolRegistry,
  createUseToolsTool,
  ToolRegistry,
} from "./tool-registry.js";
export type { ToolReference } from "./utils.js";
// Tool utilities (DX helpers)
export { mcpTools, mcpToolsFor, toolsFrom, toolsFromPlugin } from "./utils.js";
