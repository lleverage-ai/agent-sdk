/**
 * Task tool for delegating work to specialized subagents.
 *
 * Provides a single `task` tool for spawning subagents, similar to Claude Code's
 * Task tool. Supports both foreground and background execution, as well as
 * streaming subagents that can write to the parent's data stream.
 *
 * @packageDocumentation
 */

import type { LanguageModel, Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import { createSubagent } from "../subagents.js";
import type { BackgroundTask, BaseTaskStore } from "../task-store/index.js";
import { createBackgroundTask, updateBackgroundTask } from "../task-store/index.js";
import type {
  Agent,
  StreamingContext,
  StreamingMetadata,
  SubagentCreateContext,
  SubagentDefinition,
} from "../types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Status of a background task.
 *
 * @category Subagents
 */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "killed";

/**
 * Options for creating the task tool.
 *
 * @category Subagents
 */
export interface TaskToolOptions {
  /** Available subagent definitions */
  subagents: SubagentDefinition[];
  /** Default model for subagents that don't specify one */
  defaultModel: LanguageModel;
  /** Parent agent for creating subagents */
  parentAgent: Agent;
  /** Custom tool description */
  description?: string;
  /** Default max turns for subagents */
  defaultMaxTurns?: number;
  /**
   * Include a general-purpose subagent automatically.
   * @defaultValue true
   */
  includeGeneralPurpose?: boolean;
  /** Model to use for general-purpose subagent */
  generalPurposeModel?: LanguageModel;
  /** System prompt for general-purpose subagent */
  generalPurposePrompt?: string;

  /**
   * Streaming context from the parent agent.
   *
   * When provided, streaming subagents (those with `streaming: true`) can
   * write custom data directly to the parent's data stream. This enables
   * progressive rendering, real-time updates, and structured data streaming.
   *
   * Typically set when the parent agent is using `streamDataResponse()`.
   *
   * @example
   * ```typescript
   * // In agent.ts streamDataResponse
   * const streamingContext: StreamingContext = { writer };
   * const task = createTaskTool({
   *   subagents,
   *   defaultModel,
   *   parentAgent,
   *   streamingContext, // Pass to enable streaming subagents
   * });
   * ```
   */
  streamingContext?: StreamingContext;

  /**
   * Task store for persisting background task state.
   *
   * When provided, background tasks will be persisted and can be recovered
   * across process restarts. Without a task store, tasks are kept in memory
   * only and lost when the process exits.
   *
   * @example
   * ```typescript
   * import { FileTaskStore } from "@lleverage-ai/agent-sdk/task-store";
   *
   * const taskStore = new FileTaskStore({
   *   directory: "./task-data",
   *   expirationMs: 86400000, // 24 hours
   * });
   *
   * const task = createTaskTool({
   *   subagents,
   *   defaultModel,
   *   parentAgent,
   *   taskStore, // Tasks now persist across restarts
   * });
   * ```
   */
  taskStore?: BaseTaskStore;

  /**
   * Task manager for unified background task tracking.
   *
   * When provided, background subagent tasks are registered with the task manager,
   * enabling unified listing and killing of tasks (both bash commands and subagents).
   */
  taskManager?: import("../task-manager.js").TaskManager;

  /**
   * Parent span context for distributed tracing.
   *
   * When provided, subagents will create child spans linked to this parent
   * span, enabling cross-agent trace correlation. This allows full request
   * tracing across parent and child agents in distributed tracing systems.
   *
   * @example
   * ```typescript
   * import { createTracer } from "@lleverage-ai/agent-sdk";
   *
   * const tracer = createTracer({ name: "parent-agent" });
   * const span = tracer.startSpan("handle-request");
   *
   * const task = createTaskTool({
   *   subagents,
   *   defaultModel,
   *   parentAgent,
   *   parentSpanContext: {
   *     traceId: span.traceId,
   *     spanId: span.spanId,
   *   },
   * });
   * ```
   */
  parentSpanContext?: import("../observability/tracing.js").SpanContext;
}

// =============================================================================
// Internal Task Tracking
// =============================================================================

/** Task ID counter for uniqueness */
let taskIdCounter = 0;

/** Internal storage for background tasks (fallback when no task store) */
const backgroundTasks = new Map<string, BackgroundTask>();

/** Task store instance (if configured) */
let globalTaskStore: BaseTaskStore | undefined;

/**
 * Set the global task store for background task persistence.
 *
 * @param store - The task store to use
 * @internal
 */
function setGlobalTaskStore(store: BaseTaskStore | undefined): void {
  globalTaskStore = store;
}

/**
 * Get a background task by ID.
 *
 * @param taskId - The task ID
 * @returns The tracked task or undefined
 *
 * @category Subagents
 */
export async function getBackgroundTask(taskId: string): Promise<BackgroundTask | undefined> {
  if (globalTaskStore) {
    return globalTaskStore.load(taskId);
  }
  return backgroundTasks.get(taskId);
}

/**
 * List all background tasks.
 *
 * @param filter - Optional filter by status
 * @returns Array of all tracked tasks
 *
 * @category Subagents
 */
export async function listBackgroundTasks(filter?: {
  status?: TaskStatus | TaskStatus[];
}): Promise<BackgroundTask[]> {
  if (globalTaskStore) {
    return globalTaskStore.listTasks(filter);
  }

  // In-memory fallback
  const tasks = Array.from(backgroundTasks.values());
  if (!filter?.status) {
    return tasks;
  }

  const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
  return tasks.filter((t) => statuses.includes(t.status));
}

/**
 * Clear completed/failed background tasks.
 *
 * Removes tasks older than the expiration time (if using task store)
 * or all completed/failed tasks (if using in-memory storage).
 *
 * @returns Number of tasks cleared
 *
 * @category Subagents
 */
export async function clearCompletedTasks(): Promise<number> {
  if (globalTaskStore) {
    return globalTaskStore.cleanup();
  }

  // In-memory fallback
  let cleared = 0;
  for (const [id, task] of backgroundTasks) {
    if (task.status === "completed" || task.status === "failed" || task.status === "killed") {
      backgroundTasks.delete(id);
      cleared++;
    }
  }
  return cleared;
}

/**
 * Recover running tasks on agent restart.
 *
 * When using a task store, this function loads all "running" tasks
 * and marks them as "failed" since they were interrupted by the restart.
 *
 * Call this function when initializing your agent to handle crashed tasks.
 *
 * @param store - Optional task store to use. If not provided, uses the global task store.
 * @returns Number of tasks recovered
 *
 * @category Subagents
 * @example
 * ```typescript
 * // On agent startup
 * const recovered = await recoverRunningTasks();
 * console.log(`Recovered ${recovered} interrupted tasks`);
 * ```
 */
export async function recoverRunningTasks(store?: BaseTaskStore): Promise<number> {
  const taskStore = store ?? globalTaskStore;
  if (!taskStore) {
    return 0; // No recovery needed for in-memory tasks
  }

  const runningTasks = await taskStore.listTasks({ status: "running" });
  let recovered = 0;

  for (const task of runningTasks) {
    const updated = updateBackgroundTask(task, {
      status: "failed",
      error: "Task interrupted by agent restart",
      completedAt: new Date().toISOString(),
    });
    await taskStore.save(updated);
    recovered++;
  }

  return recovered;
}

/**
 * Recover failed tasks for retry.
 *
 * Loads all "failed" tasks from the store and returns them for inspection
 * or automatic retry. Applications can decide which tasks to retry based
 * on error type, retry count, or other criteria.
 *
 * To retry a task, update its status back to "pending" and process it
 * through your task execution logic.
 *
 * @param store - The task store to query
 * @param options - Optional filter options
 * @returns Array of failed tasks
 *
 * @category Subagents
 * @example
 * ```typescript
 * // Load failed tasks and retry those with transient errors
 * const failedTasks = await recoverFailedTasks(taskStore);
 *
 * for (const task of failedTasks) {
 *   // Check if error is retryable
 *   if (task.error?.includes("timeout") || task.error?.includes("network")) {
 *     // Mark for retry
 *     const retryTask = updateBackgroundTask(task, {
 *       status: "pending",
 *       error: undefined,
 *     });
 *     await taskStore.save(retryTask);
 *   }
 * }
 * ```
 */
export async function recoverFailedTasks(
  store: BaseTaskStore,
  options?: {
    /** Only return tasks with errors matching this pattern */
    errorPattern?: RegExp;
    /** Only return tasks newer than this timestamp */
    minCreatedAt?: Date;
    /** Only return tasks older than this timestamp */
    maxCreatedAt?: Date;
  },
): Promise<BackgroundTask[]> {
  const failedTasks = await store.listTasks({ status: "failed" });

  let filtered = failedTasks;

  // Apply error pattern filter
  if (options?.errorPattern) {
    filtered = filtered.filter((task) => task.error && options.errorPattern!.test(task.error));
  }

  // Apply date range filters
  if (options?.minCreatedAt) {
    const minTime = options.minCreatedAt.getTime();
    filtered = filtered.filter((task) => new Date(task.createdAt).getTime() >= minTime);
  }

  if (options?.maxCreatedAt) {
    const maxTime = options.maxCreatedAt.getTime();
    filtered = filtered.filter((task) => new Date(task.createdAt).getTime() <= maxTime);
  }

  return filtered;
}

/**
 * Clean up stale tasks from the task store.
 *
 * Removes tasks that have been in a terminal state (completed or failed)
 * for longer than the specified age. This prevents unbounded storage growth
 * and maintains system health.
 *
 * @param store - The task store to clean
 * @param maxAge - Maximum age in milliseconds for terminal tasks
 * @returns Number of tasks cleaned up
 *
 * @category Subagents
 * @example
 * ```typescript
 * // Clean up tasks older than 7 days
 * const sevenDays = 7 * 24 * 60 * 60 * 1000;
 * const cleaned = await cleanupStaleTasks(taskStore, sevenDays);
 * console.log(`Cleaned up ${cleaned} stale tasks`);
 *
 * // Or use a shorter retention for testing
 * const oneHour = 60 * 60 * 1000;
 * await cleanupStaleTasks(taskStore, oneHour);
 * ```
 */
export async function cleanupStaleTasks(store: BaseTaskStore, maxAge: number): Promise<number> {
  const terminalTasks = await store.listTasks({
    status: ["completed", "failed"],
  });

  let cleaned = 0;
  const now = Date.now();

  for (const task of terminalTasks) {
    // Use completedAt if available, otherwise use updatedAt
    const timestampStr = task.completedAt ?? task.updatedAt;
    const taskTime = new Date(timestampStr).getTime();
    const age = now - taskTime;

    if (age > maxAge) {
      await store.delete(task.id);
      cleaned++;
    }
  }

  return cleaned;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Default general-purpose subagent definition.
 * @internal
 */
function createGeneralPurposeSubagent(
  parentAgent: Agent,
  model?: LanguageModel,
  systemPrompt?: string,
): SubagentDefinition {
  return {
    type: "general-purpose",
    description: "General-purpose agent for diverse tasks. Use when no specialized agent fits.",
    model: model, // Will use context.model if not specified
    create: (ctx) =>
      createSubagent(parentAgent, {
        name: "general-purpose",
        description: "General-purpose subagent",
        model: ctx.model,
        allowedTools: ctx.allowedTools,
        systemPrompt:
          systemPrompt ??
          `You are a general-purpose assistant. Complete the requested task thoroughly and return a clear summary of what was accomplished.`,
      }),
  };
}

// =============================================================================
// Task Tool
// =============================================================================

/**
 * Creates the task tool for delegating work to specialized subagents.
 *
 * This tool delegates tasks to subagents with isolated context. It supports
 * both foreground (blocking) and background execution.
 *
 * @param options - Configuration options
 * @returns An AI SDK tool for task delegation
 *
 * @example
 * ```typescript
 * import { createTaskTool } from "@lleverage-ai/agent-sdk";
 *
 * const task = createTaskTool({
 *   subagents: [
 *     {
 *       type: "researcher",
 *       description: "Searches for information",
 *       create: () => createSubagent(parentAgent, { ... }),
 *     },
 *     {
 *       type: "coder",
 *       description: "Writes and modifies code",
 *       create: () => createSubagent(parentAgent, { ... }),
 *     },
 *   ],
 *   defaultModel: anthropic("claude-sonnet-4-20250514"),
 *   parentAgent,
 *   includeGeneralPurpose: true,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   tools: { task },
 * });
 * ```
 *
 * @category Subagents
 */
export function createTaskTool(options: TaskToolOptions): Tool {
  const {
    subagents: userSubagents,
    defaultModel,
    parentAgent,
    defaultMaxTurns = 10,
    includeGeneralPurpose = true,
    generalPurposeModel,
    generalPurposePrompt,
    streamingContext,
    taskStore,
    parentSpanContext,
    taskManager,
  } = options;

  // Set the global task store for persistence
  setGlobalTaskStore(taskStore);

  // Build subagent list (optionally include general-purpose)
  const subagents = [...userSubagents];
  if (includeGeneralPurpose) {
    subagents.push(
      createGeneralPurposeSubagent(parentAgent, generalPurposeModel, generalPurposePrompt),
    );
  }

  // Build subagent type enum and descriptions
  const subagentTypes = subagents.map((s) => s.type);
  const subagentDescriptions = subagents.map((s) => `- ${s.type}: ${s.description}`).join("\n");

  const toolDescription =
    options.description ??
    `Delegate a task to a specialized subagent. Each subagent runs with isolated context.

When you call this tool multiple times in the same step (without run_in_background), the AI SDK automatically executes them in parallel via Promise.all. This is the preferred way to run concurrent tasks — no special flags needed.

Use run_in_background ONLY for true fire-and-forget tasks where you want to continue the conversation immediately and be notified later when the task completes.

Available subagent types:
${subagentDescriptions}`;

  return tool({
    description: toolDescription,
    inputSchema: z.object({
      description: z.string().describe("The task description for the subagent"),
      subagent_type: z
        .enum(subagentTypes as [string, ...string[]])
        .describe("The type of subagent to use"),
      max_turns: z
        .number()
        .optional()
        .describe(`Maximum turns for the subagent (default: ${defaultMaxTurns})`),
      run_in_background: z
        .boolean()
        .optional()
        .describe(
          "Fire-and-forget: start the task in the background and continue the conversation immediately. The session will notify you when it completes. Only use this for tasks you don't need to wait on — for parallel execution, simply call the task tool multiple times in the same step (they run concurrently automatically).",
        ),
    }),
    execute: async (params) => {
      const { description, subagent_type, max_turns, run_in_background } = params;

      // Find the subagent definition
      const subagentDef = subagents.find((s) => s.type === subagent_type);
      if (!subagentDef) {
        return { error: `Unknown subagent type: ${subagent_type}` };
      }

      // Create task entry
      const taskId = `task-${++taskIdCounter}-${Date.now()}`;
      const task: BackgroundTask = createBackgroundTask({
        id: taskId,
        subagentType: subagent_type,
        description,
      });

      // Check if this is a streaming subagent
      const isStreamingSubagent =
        subagentDef.streaming === true && streamingContext?.writer != null;

      // Execute task function
      const executeTask = async (): Promise<string> => {
        const startTime = Date.now();

        // Update task status to running
        const runningTask = updateBackgroundTask(task, { status: "running" });
        if (taskStore) {
          await taskStore.save(runningTask);
        } else {
          backgroundTasks.set(taskId, runningTask);
        }
        Object.assign(task, runningTask);

        // Determine the model to use
        // Priority: subagentDef.model > defaultModel > parentAgent.model
        let subagentModel = defaultModel;
        if (subagentDef.model && subagentDef.model !== "inherit") {
          subagentModel = subagentDef.model;
        }

        // Build streaming metadata for this subagent
        const subagentMetadata: StreamingMetadata = {
          agentType: subagent_type,
          agentId: taskId,
          parentAgentId: streamingContext?.metadata?.agentId,
        };

        // Build context for the subagent factory
        const createContext: SubagentCreateContext = {
          model: subagentModel,
          allowedTools: subagentDef.allowedTools,
          plugins: subagentDef.plugins,
          // Only pass streaming context if this is a streaming subagent
          streamingContext: isStreamingSubagent
            ? {
                writer: streamingContext!.writer,
                metadata: subagentMetadata,
              }
            : undefined,
          // Pass parent span context for distributed tracing
          parentSpanContext,
        };

        // Create the subagent with resolved context
        const subagent = await subagentDef.create(createContext);

        // Wait for subagent's async initialization (MCP connections, plugin setup)
        await subagent.ready;

        let resultText: string;

        if (isStreamingSubagent) {
          // Streaming execution - send subagent output as data chunks
          // This keeps the output separate from the assistant message content
          // Signal subagent start to client
          streamingContext!.writer!.write({
            type: "data-subagent-stream",
            data: {
              event: "start",
              ...subagentMetadata,
              prompt: description,
            },
          });

          // Stream the subagent's response
          const streamResult = await subagent.streamRaw({
            prompt: description,
            maxTokens: (max_turns ?? defaultMaxTurns) * 4096,
          });

          // Stream text chunks as data instead of merging into message
          // This allows the client to handle them separately from assistant text
          let fullText = "";
          for await (const chunk of streamResult.textStream) {
            fullText += chunk;
            // Send each chunk as a data annotation
            streamingContext!.writer!.write({
              type: "data-subagent-stream",
              data: {
                event: "chunk",
                ...subagentMetadata,
                chunk,
              },
            });
          }

          resultText = fullText;

          // Signal subagent completion to client
          streamingContext!.writer!.write({
            type: "data-subagent-stream",
            data: {
              event: "complete",
              ...subagentMetadata,
              text: resultText,
              duration: Date.now() - startTime,
            },
          });
        } else {
          // Non-streaming execution - use generate() as before
          const result = await subagent.generate({
            prompt: description,
            maxTokens: (max_turns ?? defaultMaxTurns) * 4096,
          });
          if (result.status === "complete") {
            resultText = result.text;
          } else {
            resultText = `Interrupted: ${result.interrupt.type}`;
          }
        }

        return resultText;
      };

      // Background execution
      if (run_in_background) {
        // Streaming subagents cannot run in background
        if (isStreamingSubagent) {
          return {
            error: true,
            taskId,
            message: `Streaming subagent "${subagent_type}" cannot run in background. Remove run_in_background or use a non-streaming subagent.`,
          };
        }

        // Create abort controller for cancellation
        const abortController = new AbortController();

        // Register with task manager if available
        if (taskManager) {
          taskManager.registerTask(task, { abortController });
        } else if (taskStore) {
          await taskStore.save(task);
        } else {
          backgroundTasks.set(taskId, task);
        }

        // Start execution without awaiting
        executeTask()
          .then(async (resultText) => {
            const updates = {
              status: "completed" as const,
              result: resultText,
              completedAt: new Date().toISOString(),
            };

            if (taskManager) {
              taskManager.updateTask(taskId, updates);
            } else {
              const completedTask = updateBackgroundTask(task, updates);
              if (taskStore) {
                await taskStore.save(completedTask);
              } else {
                backgroundTasks.set(taskId, completedTask);
              }
              Object.assign(task, completedTask);
            }
          })
          .catch(async (error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const updates = {
              status: "failed" as const,
              error: errorMessage,
              completedAt: new Date().toISOString(),
            };

            if (taskManager) {
              taskManager.updateTask(taskId, updates);
            } else {
              const failedTask = updateBackgroundTask(task, updates);
              if (taskStore) {
                await taskStore.save(failedTask);
              } else {
                backgroundTasks.set(taskId, failedTask);
              }
              Object.assign(task, failedTask);
            }
          });

        return {
          taskId,
          status: "running",
          message: `Task started in background. Use the task_output tool with task_id "${taskId}" to check status or retrieve the result.`,
        };
      }

      // Foreground execution (blocking)
      try {
        const resultText = await executeTask();
        const completedTask = updateBackgroundTask(task, {
          status: "completed",
          result: resultText,
          completedAt: new Date().toISOString(),
        });

        // Optional persistence for foreground tasks
        if (taskStore) {
          await taskStore.save(completedTask);
        }

        return {
          success: true,
          taskId,
          text: resultText,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        const failedTask = updateBackgroundTask(task, {
          status: "failed",
          error: errorMessage,
          completedAt: new Date().toISOString(),
        });

        // Optional persistence for foreground tasks
        if (taskStore) {
          await taskStore.save(failedTask);
        }

        return {
          error: true,
          taskId,
          message: errorMessage,
        };
      }
    },
  });
}

// =============================================================================
// TaskOutput Tool Options
// =============================================================================

/**
 * Options for creating the task_output tool.
 *
 * @category Subagents
 */
export interface TaskOutputToolOptions {
  /** Custom tool description */
  description?: string;

  /**
   * Default timeout in milliseconds for blocking requests.
   * @defaultValue 30000 (30 seconds)
   */
  defaultTimeout?: number;

  /**
   * Task store for loading persisted tasks.
   * If not provided, uses the global task store set by createTaskTool.
   */
  taskStore?: BaseTaskStore;

  /**
   * Task manager for accessing running tasks.
   * When provided, enables live output inspection for running tasks.
   */
  taskManager?: import("../task-manager.js").TaskManager;

  /**
   * Default number of output lines to show for running tasks.
   * @defaultValue 50
   */
  defaultOutputLines?: number;
}

// =============================================================================
// TaskOutput Tool
// =============================================================================

/**
 * Creates the task_output tool for retrieving background task results.
 *
 * This tool retrieves output from running or completed background tasks.
 * It supports both blocking (wait for completion) and non-blocking (check status)
 * modes.
 *
 * @param options - Configuration options
 * @returns An AI SDK tool for retrieving task output
 *
 * @example
 * ```typescript
 * import { createTaskTool, createTaskOutputTool } from "@lleverage-ai/agent-sdk";
 *
 * const task = createTaskTool({ ... });
 * const taskOutput = createTaskOutputTool();
 *
 * const agent = createAgent({
 *   model,
 *   tools: { task, task_output: taskOutput },
 * });
 * ```
 *
 * @category Subagents
 */
export function createTaskOutputTool(options: TaskOutputToolOptions = {}): Tool {
  const {
    defaultTimeout = 30000,
    taskStore: providedTaskStore,
    taskManager,
    defaultOutputLines = 50,
  } = options;

  const toolDescription =
    options.description ??
    `Inspect a fire-and-forget background task's current state or wait for completion.

This tool is for tasks started with run_in_background=true. You do NOT need this for parallel foreground tasks — those return results directly.

For running tasks, shows:
- Current status and progress
- Recent output (last N lines of stdout/stderr for bash commands)
- Recent streamed text (for subagents)

For completed/failed tasks, shows the full result.

Parameters:
- task_id: The ID of the task to check (returned when task was started with run_in_background)
- block: If true, wait for task completion. If false (default), return current status immediately.
- timeout: Maximum wait time in milliseconds (only used when block=true, default: ${defaultTimeout}ms)
- output_lines: Number of recent output lines to show for running tasks (default: ${defaultOutputLines})`;

  return tool({
    description: toolDescription,
    inputSchema: z.object({
      task_id: z.string().describe("The task ID to get output from"),
      block: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to wait for task completion (default: false)"),
      timeout: z
        .number()
        .optional()
        .describe(`Maximum wait time in milliseconds (default: ${defaultTimeout})`),
      output_lines: z
        .number()
        .optional()
        .describe(
          `Number of recent output lines to show for running tasks (default: ${defaultOutputLines})`,
        ),
    }),
    execute: async (params) => {
      const {
        task_id,
        block = false,
        timeout = defaultTimeout,
        output_lines = defaultOutputLines,
      } = params;

      // Use provided task store or fall back to global
      const taskStore = providedTaskStore ?? globalTaskStore;

      // Helper to load task from store, task manager, or in-memory map
      const loadTask = async (): Promise<BackgroundTask | undefined> => {
        // First try task manager (for running tasks with live output)
        if (taskManager) {
          const task = taskManager.getTask(task_id);
          if (task) return task;
        }
        // Then try task store
        if (taskStore) {
          return taskStore.load(task_id);
        }
        // Fall back to in-memory map
        return backgroundTasks.get(task_id);
      };

      // Helper to format task response with live output support
      const formatTaskResponse = (task: BackgroundTask) => {
        const response: Record<string, unknown> = {
          taskId: task.id,
          type: task.subagentType,
          status: task.status,
          description: task.description,
          createdAt: task.createdAt,
        };

        if (task.completedAt) {
          response.completedAt = task.completedAt;
        }

        // For running/pending tasks, show live output preview
        if (task.status === "running" || task.status === "pending") {
          const currentOutput = task.metadata?.currentOutput as string | undefined;
          if (currentOutput) {
            const lines = currentOutput.split("\n");
            const recentLines = lines.slice(-output_lines);
            response.recentOutput = recentLines.join("\n");
            response.totalLines = lines.length;
            response.outputTruncated = task.metadata?.truncated as boolean | undefined;
          }
        }

        // For completed tasks, show full result
        if (task.status === "completed" && task.result) {
          response.result = task.result;
        }

        // For failed tasks, show error
        if (task.status === "failed" && task.error) {
          response.error = task.error;
        }

        // For killed tasks, indicate it was terminated
        if (task.status === "killed") {
          response.message = "Task was terminated by user";
        }

        // Include exit code for bash tasks
        if (task.metadata?.exitCode !== undefined) {
          response.exitCode = task.metadata.exitCode;
        }

        return response;
      };

      // Load the task
      let task = await loadTask();

      if (!task) {
        return {
          error: true,
          message: `Task not found: ${task_id}`,
        };
      }

      // Helper to cleanup task after observation
      const cleanupIfTerminal = (t: BackgroundTask) => {
        if (
          taskManager &&
          (t.status === "completed" || t.status === "failed" || t.status === "killed")
        ) {
          taskManager.removeTask(t.id);
        }
      };

      // Non-blocking: return current status immediately
      if (!block) {
        const response = formatTaskResponse(task);
        cleanupIfTerminal(task);
        return response;
      }

      // Blocking: wait for task completion
      const startTime = Date.now();
      const pollInterval = 100; // Check every 100ms

      while (task.status === "pending" || task.status === "running") {
        // Check timeout
        if (Date.now() - startTime > timeout) {
          return {
            ...formatTaskResponse(task),
            timedOut: true,
            message: `Timed out waiting for task completion after ${timeout}ms`,
          };
        }

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        // Reload task status
        task = await loadTask();
        if (!task) {
          return {
            error: true,
            message: `Task disappeared: ${task_id}`,
          };
        }
      }

      // Task reached terminal state - cleanup and return
      const response = formatTaskResponse(task);
      cleanupIfTerminal(task);
      return response;
    },
  });
}
