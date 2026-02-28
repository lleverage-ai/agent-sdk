/**
 * Advanced subagent system with context isolation and parallel execution.
 *
 * This module provides:
 * - Enhanced subagent definitions with output schemas and interrupt support
 * - Context isolation (files shared, todos isolated)
 * - Parallel execution of multiple subagents
 * - Event streaming for subagent lifecycle
 *
 * @packageDocumentation
 */

export type {
  // Re-export existing types
  SubagentDefinition,
  SubagentOptions,
  TaskToolOptions,
} from "../types.js";
export {
  // Functions
  createSubagentContext,
  createSubagentEventEmitter,
  // Types
  type EnhancedSubagentDefinition,
  executeSubagent,
  executeSubagentsParallel,
  mergeSubagentContext,
  type ParallelExecutionResult,
  type ParallelTask,
  type SubagentContext,
  type SubagentContextOptions,
  type SubagentErrorEvent,
  type SubagentEvent,
  type SubagentEventEmitter,
  type SubagentExecutionOptions,
  type SubagentExecutionResult,
  type SubagentFinishEvent,
  type SubagentStartEvent,
  type SubagentStepEvent,
} from "./advanced.js";
