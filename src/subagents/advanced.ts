/**
 * Advanced subagent system with context isolation and parallel execution.
 *
 * @packageDocumentation
 */

import type { LanguageModel, ToolSet } from "ai";
import type { AgentState, TodoItem } from "../backends/state.js";
import { createSubagent } from "../subagents.js";
import type { Agent, GenerateResult } from "../types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Enhanced subagent definition with additional capabilities.
 *
 * Extends the basic SubagentDefinition with:
 * - Structured output schemas
 * - Tool specification (subset or custom)
 * - Interrupt conditions for human-in-the-loop
 * - Model override
 * - Maximum steps
 *
 * @category Subagents
 */
export interface EnhancedSubagentDefinition {
  /** Unique type identifier for this subagent */
  type: string;

  /** Description of what this subagent specializes in */
  description: string;

  /** System prompt for this subagent */
  systemPrompt: string;

  /**
   * Tools available to this subagent.
   * - If ToolSet: use these specific tools
   * - If string[]: subset of parent tools by name
   * - If undefined: inherit all parent tools
   */
  tools?: ToolSet | string[];

  /**
   * Model to use for this subagent.
   * If not specified, inherits from parent.
   */
  model?: LanguageModel;

  /** Maximum steps/turns for this subagent */
  maxSteps?: number;
}

/**
 * Options for creating an isolated subagent context.
 *
 * @category Subagents
 */
export interface SubagentContextOptions {
  /** Parent agent state to derive from */
  parentState: AgentState;

  /**
   * Whether to share files with parent.
   * @defaultValue true
   */
  shareFiles?: boolean;

  /**
   * Whether to isolate todos (give subagent empty todos).
   * @defaultValue true
   */
  isolateTodos?: boolean;

  /**
   * Initial todos for the subagent (only used if isolateTodos is true).
   */
  initialTodos?: TodoItem[];
}

/**
 * Isolated context for a subagent execution.
 *
 * @category Subagents
 */
export interface SubagentContext {
  /** The subagent's isolated state */
  state: AgentState;

  /** Reference to the parent state (for merging back) */
  parentState: AgentState;

  /** Whether files are shared with parent */
  filesShared: boolean;

  /** Whether todos are isolated */
  todosIsolated: boolean;
}

/**
 * Options for executing a subagent.
 *
 * @category Subagents
 */
export interface SubagentExecutionOptions {
  /** The subagent definition to execute */
  definition: EnhancedSubagentDefinition;

  /** The task/prompt for the subagent */
  prompt: string;

  /** Parent agent for inheriting configuration */
  parentAgent: Agent;

  /**
   * Isolated context for the subagent.
   * If not provided, context is created automatically.
   */
  context?: SubagentContext;

  /**
   * Maximum tokens for generation.
   * If not specified, uses definition.maxSteps * 4096.
   */
  maxTokens?: number;

  /**
   * Abort signal for cancellation.
   */
  signal?: AbortSignal;

  /**
   * Callback when the subagent starts.
   */
  onStart?: (event: SubagentStartEvent) => void;

  /**
   * Callback for each step the subagent takes.
   */
  onStep?: (event: SubagentStepEvent) => void;

  /**
   * Callback when the subagent finishes.
   */
  onFinish?: (event: SubagentFinishEvent) => void;

  /**
   * Callback when an error occurs.
   */
  onError?: (event: SubagentErrorEvent) => void;
}

/**
 * Result from executing a subagent.
 *
 * @category Subagents
 */
export interface SubagentExecutionResult {
  /** Whether execution succeeded */
  success: boolean;

  /** The generated text response */
  text: string;

  /** Structured output if schema was provided */
  output?: unknown;

  /** Number of steps taken */
  steps: number;

  /** Why generation finished */
  finishReason: string;

  /** Execution duration in milliseconds */
  duration: number;

  /** Error message if failed */
  error?: string;

  /** The subagent's final context (for merging back) */
  context: SubagentContext;

  /** Full generation result */
  result?: GenerateResult;
}

/**
 * Result from parallel subagent execution.
 *
 * @category Subagents
 */
export interface ParallelExecutionResult {
  /** Individual results for each subagent */
  results: SubagentExecutionResult[];

  /** Number of successful executions */
  successCount: number;

  /** Number of failed executions */
  failureCount: number;

  /** Total duration (max of individual durations) */
  totalDuration: number;

  /** Whether all executions succeeded */
  allSucceeded: boolean;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Base event for subagent lifecycle.
 *
 * @category Subagents
 */
export interface SubagentEvent {
  /** Unique identifier for this execution */
  executionId: string;

  /** The subagent type */
  subagentType: string;

  /** Timestamp of the event */
  timestamp: string;
}

/**
 * Event emitted when a subagent starts.
 *
 * @category Subagents
 */
export interface SubagentStartEvent extends SubagentEvent {
  type: "subagent-start";

  /** The task prompt */
  prompt: string;
}

/**
 * Event emitted for each subagent step.
 *
 * @category Subagents
 */
export interface SubagentStepEvent extends SubagentEvent {
  type: "subagent-step";

  /** Step number (1-indexed) */
  stepNumber: number;

  /** Tool calls made in this step */
  toolCalls: Array<{
    toolName: string;
    args: unknown;
    result: unknown;
  }>;

  /** Text generated in this step */
  text: string;
}

/**
 * Event emitted when a subagent finishes.
 *
 * @category Subagents
 */
export interface SubagentFinishEvent extends SubagentEvent {
  type: "subagent-finish";

  /** Whether execution succeeded */
  success: boolean;

  /** Summary of the result */
  summary: string;

  /** Total steps taken */
  steps: number;

  /** Execution duration in milliseconds */
  duration: number;

  /** Finish reason */
  finishReason: string;
}

/**
 * Event emitted when an error occurs.
 *
 * @category Subagents
 */
export interface SubagentErrorEvent extends SubagentEvent {
  type: "subagent-error";

  /** The error that occurred */
  error: Error;

  /** Step number where error occurred (if applicable) */
  stepNumber?: number;
}

/**
 * Event emitter interface for subagent events.
 *
 * @category Subagents
 */
export interface SubagentEventEmitter {
  /** Register a listener for start events */
  onStart(handler: (event: SubagentStartEvent) => void): void;

  /** Register a listener for step events */
  onStep(handler: (event: SubagentStepEvent) => void): void;

  /** Register a listener for finish events */
  onFinish(handler: (event: SubagentFinishEvent) => void): void;

  /** Register a listener for error events */
  onError(handler: (event: SubagentErrorEvent) => void): void;

  /** Remove all listeners */
  removeAllListeners(): void;
}

// =============================================================================
// Context Management
// =============================================================================

let executionIdCounter = 0;

/**
 * Creates an isolated context for subagent execution.
 *
 * By default:
 * - Files are shared (subagent sees parent's files)
 * - Todos are isolated (subagent gets empty todos)
 *
 * This follows the DeepAgentSDK pattern where files represent shared
 * work product but todos represent the agent's internal planning.
 *
 * @param options - Context creation options
 * @returns Isolated subagent context
 *
 * @example
 * ```typescript
 * const context = createSubagentContext({
 *   parentState: parentAgent.state,
 *   shareFiles: true,
 *   isolateTodos: true,
 * });
 *
 * // Subagent can see parent's files
 * // Subagent has empty todos
 * ```
 *
 * @category Subagents
 */
export function createSubagentContext(options: SubagentContextOptions): SubagentContext {
  const { parentState, shareFiles = true, isolateTodos = true, initialTodos = [] } = options;

  // Create isolated state
  const state: AgentState = {
    // Share or copy files based on option
    files: shareFiles ? parentState.files : { ...parentState.files },
    // Isolate or inherit todos based on option
    todos: isolateTodos ? [...initialTodos] : [...parentState.todos],
  };

  return {
    state,
    parentState,
    filesShared: shareFiles,
    todosIsolated: isolateTodos,
  };
}

/**
 * Merges subagent context changes back to parent.
 *
 * Only file changes are merged back (if files were shared).
 * Todo changes are NOT merged (todos are isolated by design).
 *
 * @param context - The subagent context to merge
 *
 * @example
 * ```typescript
 * // After subagent completes
 * mergeSubagentContext(result.context);
 *
 * // Parent now has any files the subagent created/modified
 * ```
 *
 * @category Subagents
 */
export function mergeSubagentContext(context: SubagentContext): void {
  // Only merge files if they were shared (meaning mutations affect parent)
  // If files weren't shared, we need to copy changes back
  if (!context.filesShared) {
    // Merge file changes back to parent
    Object.assign(context.parentState.files, context.state.files);
  }
  // Note: If filesShared is true, the state.files is the same object as
  // parentState.files, so changes are already reflected.

  // Todos are intentionally NOT merged - they represent the subagent's
  // internal planning and are discarded after execution.
}

// =============================================================================
// Subagent Execution
// =============================================================================

/**
 * Executes a subagent with isolated context.
 *
 * Creates a subagent from the definition, executes the prompt,
 * and returns the result with the final context for merging.
 *
 * @param options - Execution options
 * @returns Execution result with context
 *
 * @example
 * ```typescript
 * const result = await executeSubagent({
 *   definition: {
 *     type: "researcher",
 *     description: "Researches topics",
 *     systemPrompt: "You are a research assistant.",
 *   },
 *   prompt: "Research the history of TypeScript",
 *   parentAgent,
 *   hooks,
 *   onStep: (event) => console.log(`Step ${event.stepNumber}`),
 * });
 *
 * if (result.success) {
 *   mergeSubagentContext(result.context);
 *   console.log(result.text);
 * }
 * ```
 *
 * @category Subagents
 */
export async function executeSubagent(
  options: SubagentExecutionOptions,
): Promise<SubagentExecutionResult> {
  const { definition, prompt, parentAgent, maxTokens, signal, onStart, onStep, onFinish, onError } =
    options;

  // Generate execution ID
  const executionId = `subagent-${++executionIdCounter}-${Date.now()}`;
  const startTime = Date.now();

  // Create or use provided context
  const context =
    options.context ??
    createSubagentContext({
      parentState: parentAgent.state,
      shareFiles: true,
      isolateTodos: true,
    });

  // Emit start event
  const startEvent: SubagentStartEvent = {
    type: "subagent-start",
    executionId,
    subagentType: definition.type,
    timestamp: new Date().toISOString(),
    prompt,
  };

  onStart?.(startEvent);

  try {
    // Resolve tools for subagent
    let subagentTools: ToolSet | undefined;
    if (definition.tools) {
      if (Array.isArray(definition.tools)) {
        // Subset of parent tools by name
        const parentTools = parentAgent.options.tools ?? {};
        subagentTools = {};
        for (const toolName of definition.tools) {
          const tool = parentTools[toolName];
          if (tool) {
            subagentTools[toolName] = tool;
          }
        }
      } else {
        // Use provided tools directly
        subagentTools = definition.tools;
      }
    } else {
      // Inherit parent tools
      subagentTools = parentAgent.options.tools;
    }

    // Create the subagent
    const subagent = createSubagent(parentAgent, {
      name: definition.type,
      description: definition.description,
      model: definition.model,
      systemPrompt: definition.systemPrompt,
      maxSteps: definition.maxSteps,
      tools: subagentTools,
    });

    // Execute generation
    const effectiveMaxTokens = maxTokens ?? (definition.maxSteps ?? 10) * 4096;

    const result = await subagent.generate({
      prompt,
      maxTokens: effectiveMaxTokens,
      signal,
    });

    // Handle interrupted results
    if (result.status === "interrupted") {
      const duration = Date.now() - startTime;
      return {
        success: false,
        text: result.partial?.text ?? "",
        output: undefined,
        steps: result.partial?.steps?.length ?? 0,
        finishReason: "interrupted" as const,
        duration,
        context,
        result,
        error: `Subagent was interrupted: ${result.interrupt.type}`,
      };
    }

    // Handle handoff results
    if (result.status === "handoff") {
      const duration = Date.now() - startTime;
      return {
        success: false,
        text: result.partial?.text ?? "",
        output: undefined,
        steps: result.partial?.steps?.length ?? 0,
        finishReason: "other" as const,
        duration,
        context,
        result,
        error: `Subagent requested handoff: ${result.context ?? "agent handoff"}`,
      };
    }

    // Emit step events for each step
    let stepNumber = 0;
    for (const step of result.steps) {
      stepNumber++;
      const stepEvent: SubagentStepEvent = {
        type: "subagent-step",
        executionId,
        subagentType: definition.type,
        timestamp: new Date().toISOString(),
        stepNumber,
        toolCalls: step.toolCalls.map(
          (tc: { toolName: string; toolCallId: string; input: unknown }) => ({
            toolName: tc.toolName,
            args: tc.input,
            result: step.toolResults.find(
              (tr: { toolCallId: string; output: unknown }) => tr.toolCallId === tc.toolCallId,
            )?.output,
          }),
        ),
        text: step.text,
      };
      onStep?.(stepEvent);
    }

    const duration = Date.now() - startTime;

    // Emit finish event
    const finishEvent: SubagentFinishEvent = {
      type: "subagent-finish",
      executionId,
      subagentType: definition.type,
      timestamp: new Date().toISOString(),
      success: true,
      summary: result.text.slice(0, 200) + (result.text.length > 200 ? "..." : ""),
      steps: result.steps.length,
      duration,
      finishReason: result.finishReason,
    };

    onFinish?.(finishEvent);

    return {
      success: true,
      text: result.text,
      output: result.output,
      steps: result.steps.length,
      finishReason: result.finishReason,
      duration,
      context,
      result,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorObj = error instanceof Error ? error : new Error(String(error));

    // Emit error event
    const errorEvent: SubagentErrorEvent = {
      type: "subagent-error",
      executionId,
      subagentType: definition.type,
      timestamp: new Date().toISOString(),
      error: errorObj,
    };

    onError?.(errorEvent);

    return {
      success: false,
      text: "",
      steps: 0,
      finishReason: "error",
      duration,
      error: errorObj.message,
      context,
    };
  }
}

// =============================================================================
// Parallel Execution
// =============================================================================

/**
 * Options for a single parallel execution task.
 *
 * @category Subagents
 */
export interface ParallelTask {
  /** The subagent definition */
  definition: EnhancedSubagentDefinition;
  /** The prompt for this task */
  prompt: string;
}

/**
 * Executes multiple subagents in parallel.
 *
 * All subagents share the same parent context initially.
 * After completion, file changes from all subagents are merged back.
 *
 * Note: If multiple subagents modify the same file, the last one wins.
 * For better conflict handling, consider using different file paths.
 *
 * @param tasks - Array of tasks to execute
 * @param parentAgent - Parent agent for configuration
 * @param onResult - Optional callback for each completed task
 * @returns Combined results from all executions
 *
 * @example
 * ```typescript
 * const results = await executeSubagentsParallel(
 *   [
 *     {
 *       definition: researcherDef,
 *       prompt: "Research TypeScript history",
 *     },
 *     {
 *       definition: coderDef,
 *       prompt: "Write a utility function",
 *     },
 *   ],
 *   parentAgent,
 *   (result, index) => console.log(`Task ${index} completed`),
 * );
 *
 * console.log(`${results.successCount}/${results.results.length} succeeded`);
 * ```
 *
 * @category Subagents
 */
export async function executeSubagentsParallel(
  tasks: ParallelTask[],
  parentAgent: Agent,
  onResult?: (result: SubagentExecutionResult, index: number) => void,
): Promise<ParallelExecutionResult> {
  const startTime = Date.now();

  // Create isolated contexts for each task
  // Note: Files are shared via reference, so changes from one subagent
  // are visible to others. This is intentional for collaboration.
  const contexts = tasks.map(() =>
    createSubagentContext({
      parentState: parentAgent.state,
      shareFiles: true,
      isolateTodos: true,
    }),
  );

  // Execute all tasks in parallel
  const results = await Promise.all(
    tasks.map(async (task, index) => {
      const result = await executeSubagent({
        definition: task.definition,
        prompt: task.prompt,
        parentAgent,
        context: contexts[index],
      });

      onResult?.(result, index);
      return result;
    }),
  );

  // Merge contexts (file changes already reflected due to shared reference)
  // Just ensure any non-shared contexts are merged
  for (const result of results) {
    if (!result.context.filesShared) {
      mergeSubagentContext(result.context);
    }
  }

  const totalDuration = Date.now() - startTime;
  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.length - successCount;

  return {
    results,
    successCount,
    failureCount,
    totalDuration,
    allSucceeded: failureCount === 0,
  };
}

// =============================================================================
// Event Emitter
// =============================================================================

/**
 * Creates an event emitter for subagent lifecycle events.
 *
 * Provides a convenient way to handle all subagent events
 * without passing individual callbacks.
 *
 * @returns Event emitter instance
 *
 * @example
 * ```typescript
 * const emitter = createSubagentEventEmitter();
 *
 * emitter.onStart((event) => {
 *   console.log(`Starting ${event.subagentType}: ${event.prompt}`);
 * });
 *
 * emitter.onStep((event) => {
 *   console.log(`Step ${event.stepNumber}: ${event.toolCalls.length} tool calls`);
 * });
 *
 * emitter.onFinish((event) => {
 *   console.log(`Finished in ${event.duration}ms: ${event.summary}`);
 * });
 *
 * emitter.onError((event) => {
 *   console.error(`Error: ${event.error.message}`);
 * });
 * ```
 *
 * @category Subagents
 */
export function createSubagentEventEmitter(): SubagentEventEmitter {
  const startHandlers: Array<(event: SubagentStartEvent) => void> = [];
  const stepHandlers: Array<(event: SubagentStepEvent) => void> = [];
  const finishHandlers: Array<(event: SubagentFinishEvent) => void> = [];
  const errorHandlers: Array<(event: SubagentErrorEvent) => void> = [];

  return {
    onStart(handler) {
      startHandlers.push(handler);
    },

    onStep(handler) {
      stepHandlers.push(handler);
    },

    onFinish(handler) {
      finishHandlers.push(handler);
    },

    onError(handler) {
      errorHandlers.push(handler);
    },

    removeAllListeners() {
      startHandlers.length = 0;
      stepHandlers.length = 0;
      finishHandlers.length = 0;
      errorHandlers.length = 0;
    },
  };
}
