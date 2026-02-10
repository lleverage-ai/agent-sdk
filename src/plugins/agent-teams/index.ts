/**
 * Agent Teams plugin for multi-agent coordination.
 *
 * Enables dynamic agent team coordination via runtime tools.
 * When `start_team` is called, team management tools are added to the
 * primary agent at runtime. Independent teammates communicate via mailboxes,
 * share a task list with dependencies, and self-organize work.
 * When `end_team` is called, the team tools are removed.
 *
 * @packageDocumentation
 */

import { tool } from "ai";
import { z } from "zod";
import { createAgent } from "../../agent.js";
import { invokeCustomHook } from "../../hooks.js";
import { definePlugin } from "../../plugins.js";
import type { Agent, AgentPlugin, HookRegistration } from "../../types.js";
import { InMemoryTeamCoordinator } from "./coordinator.js";
import { TEAM_HOOKS } from "./hooks.js";
import { HeadlessSessionRunner } from "./session-runner.js";
import { createLeadTools, createTeammateTools } from "./tools.js";
import type { AgentRef, AgentTeamsPluginOptions, TeammateDefinition, TeammateInfo } from "./types.js";

// Re-exports
export { InMemoryTeamCoordinator } from "./coordinator.js";
export { TEAM_HOOKS } from "./hooks.js";
export { tasksToMermaid } from "./mermaid.js";
export { HeadlessSessionRunner } from "./session-runner.js";
export type {
  AgentRef,
  AgentTeamsPluginOptions,
  TeamCoordinator,
  TeamMessage,
  TeamTask,
  TeamTaskStatus,
  TeammateDefinition,
  TeammateInfo,
  TeammateStatus,
} from "./types.js";

/** System prompt augmentation for teammates */
function buildTeammateSystemPrompt(
  basePrompt: string | undefined,
  role: string,
): string {
  const teammateInstructions = `
## Team Context

You are a teammate with role "${role}".

### Workflow
1. Check available tasks: team_task_list
2. Claim a task: team_task_claim
3. Do the work using your tools and capabilities
4. Mark the task as completed: team_task_complete
5. Check for messages: team_read_messages
6. Communicate with the lead or other teammates: team_message

### Guidelines
- Always claim a task before starting work
- Complete tasks thoroughly before claiming the next one
- Send a message to the lead when you finish important work
- Check for messages regularly in case the lead has updates
`;

  return basePrompt
    ? `${basePrompt}\n\n${teammateInstructions}`
    : teammateInstructions;
}

/**
 * Build the activation message returned as the `start_team` tool result.
 * This replaces the old leader system prompt augmentation — the information
 * is delivered as a tool result so the primary agent knows what to do.
 */
function buildTeamActivationMessage(
  reason: string,
  teammates: TeammateDefinition[],
  initialTasks?: Array<{ subject: string; description: string; blocked_by?: string[] }>,
): string {
  const roleList = teammates
    .map((t) => `- **${t.role}**: ${t.description}`)
    .join("\n");

  let message = `Team mode activated. Reason: ${reason}

## Available Teammate Roles
${roleList}

## Team Management Tools Now Available
You now have team management tools. Use them to coordinate work:

### Workflow
1. Break the work into clear tasks (team_task_create)
2. Spawn teammates for the roles needed (team_spawn)
3. Monitor progress (team_task_list, team_read_messages)
4. Communicate with teammates (team_message)
5. When all work is done, summarize results and end the team (end_team)

### Guidelines
- Create tasks before spawning teammates so they can immediately claim work
- Use task dependencies (blocked_by) to order dependent work
- Periodically check messages from teammates for questions or results
- When all tasks are completed, synthesize results and call end_team
`;

  if (initialTasks && initialTasks.length > 0) {
    message += "\n## Initial Tasks Created\n";
    for (const task of initialTasks) {
      message += `- ${task.subject}: ${task.description}\n`;
    }
  }

  return message;
}

/**
 * Creates the Agent Teams plugin.
 *
 * This plugin adds a `start_team` tool to the primary agent. When called,
 * team management tools are dynamically added to the agent via runtime tools.
 * No agent handoff occurs — the primary agent itself becomes the team leader.
 *
 * @param options - Plugin configuration
 * @returns An AgentPlugin that enables team coordination
 *
 * @example
 * ```typescript
 * import { createAgent } from "@lleverage-ai/agent-sdk";
 * import { createAgentTeamsPlugin } from "@lleverage-ai/agent-sdk/plugins/agent-teams";
 *
 * const agent = createAgent({
 *   model: "anthropic/claude-sonnet-4",
 *   systemPrompt: "You are a helpful assistant.",
 *   plugins: [
 *     createAgentTeamsPlugin({
 *       teammates: [
 *         {
 *           role: "researcher",
 *           description: "Researches topics thoroughly",
 *           agentOptions: { systemPrompt: "You are a thorough researcher..." },
 *         },
 *         {
 *           role: "coder",
 *           description: "Writes clean, tested code",
 *           agentOptions: { systemPrompt: "You are a senior developer..." },
 *         },
 *       ],
 *     }),
 *   ],
 * });
 * ```
 *
 * @category Agent Teams
 */
export function createAgentTeamsPlugin(
  options: AgentTeamsPluginOptions,
): AgentPlugin {
  const maxConcurrent = options.maxConcurrentTeammates ?? Infinity;
  let primaryAgent: Agent | undefined;

  // Active team session state (undefined when no team is active)
  let coordinator: InMemoryTeamCoordinator | import("./types.js").TeamCoordinator | undefined;
  let runners: Map<string, HeadlessSessionRunner> | undefined;
  let activeToolNames: string[] | undefined;

  return definePlugin({
    name: "agent-teams",
    description: "Enables dynamic agent team coordination via runtime tools",

    hooks: options.hooks,

    setup: async (agent) => {
      primaryAgent = agent;
    },

    tools: {
      start_team: tool({
        description:
          "Start a team of specialized agents to work on a complex task in parallel. " +
          "Use this when the task benefits from multiple agents working concurrently.",
        inputSchema: z.object({
          reason: z.string().describe("Why a team is needed for this task"),
          initial_tasks: z
            .array(
              z.object({
                subject: z.string().describe("Brief task title"),
                description: z.string().describe("Detailed task description"),
                blocked_by: z.array(z.string()).optional().describe("Task subjects this depends on"),
              }),
            )
            .optional()
            .describe("Initial tasks to create for the team"),
        }),
        execute: async ({ reason, initial_tasks }) => {
          if (!primaryAgent) {
            throw new Error("Plugin not initialized");
          }
          if (coordinator) {
            return "Team already active. Use end_team first.";
          }

          // Create a fresh coordinator for this team session
          coordinator = options.coordinator ?? new InMemoryTeamCoordinator();
          runners = new Map<string, HeadlessSessionRunner>();

          // Create initial tasks if provided
          const taskIdMap = new Map<string, string>();
          if (initial_tasks) {
            for (const task of initial_tasks) {
              const blockedByIds = (task.blocked_by ?? [])
                .map((subject) => taskIdMap.get(subject))
                .filter((id): id is string => id !== undefined);

              const created = coordinator.createTask({
                subject: task.subject,
                description: task.description,
                status: "pending",
                createdBy: "lead",
                blockedBy: blockedByIds,
              });
              taskIdMap.set(task.subject, created.id);
            }
          }

          // Capture refs for closures
          const currentCoordinator = coordinator;
          const currentRunners = runners;
          const agent = primaryAgent;

          // Shared mutable ref for teammate tools (teammate agent created after tools)
          const agentRef: AgentRef = { current: undefined };

          // Function to spawn a teammate
          const spawnTeammate = async (
            role: string,
            initialPrompt: string,
          ): Promise<string> => {
            const def = options.teammates.find((t) => t.role === role);
            if (!def) {
              throw new Error(`Unknown teammate role: ${role}`);
            }

            const teammateId = `${role}-${Date.now().toString(36)}`;
            const model = def.model ?? agent.options?.model;
            if (!model) {
              throw new Error(
                "No model available for teammate. Provide a model in TeammateDefinition or the primary agent.",
              );
            }

            // Create teammate tools (uses agentRef since teammate agent is created after)
            const teammateToolSet = createTeammateTools({
              teammateId,
              coordinator: currentCoordinator,
              hooks: options.hooks,
              agentRef,
            });

            // Create teammate agent
            const teammateAgent = createAgent({
              ...def.agentOptions,
              model,
              systemPrompt: buildTeammateSystemPrompt(
                def.agentOptions.systemPrompt,
                role,
              ),
              tools: {
                ...(def.agentOptions.tools ?? {}),
                ...teammateToolSet,
              },
              permissionMode: "bypassPermissions",
            });

            // Set the ref so teammate tools can access the agent
            agentRef.current = teammateAgent;

            // Register teammate
            const info: TeammateInfo = {
              id: teammateId,
              role,
              description: def.description,
              status: "idle",
              spawnedAt: new Date().toISOString(),
            };
            currentCoordinator.registerTeammate(info);

            // Create and start runner
            const runner = new HeadlessSessionRunner({
              agent: teammateAgent,
              teammateId,
              coordinator: currentCoordinator,
              initialPrompt,
              hooks: options.hooks,
              maxTurns: def.maxTurns,
              onError: options.onError,
              idleTimeoutMs: options.idleTimeoutMs,
            });

            currentRunners.set(teammateId, runner);

            // Start the runner in the background
            runner.start().catch(async (err) => {
              const error = err instanceof Error ? err : new Error(String(err));
              if (options.onError) {
                options.onError(teammateId, error);
              } else {
                console.error(`[team:${teammateId}] Runner error:`, err);
              }
              // Fire TeammateStopped hook
              await invokeCustomHook(
                options.hooks,
                TEAM_HOOKS.TeammateStopped,
                { teammateId, error: error.message },
                agent,
              );
            });

            return teammateId;
          };

          // Create lead tools (pass agent directly — no AgentRef needed)
          const leadTools = createLeadTools({
            coordinator: currentCoordinator,
            runners: currentRunners,
            teammates: options.teammates,
            hooks: options.hooks,
            agent,
            spawnTeammate,
            maxConcurrentTeammates: maxConcurrent,
          });

          // Create end_team tool
          const endTeamTool = tool({
            description:
              "End the team session. Shuts down all active teammates and removes team tools. " +
              "Call this when all team work is complete.",
            inputSchema: z.object({
              summary: z.string().describe("Summary of team results"),
            }),
            execute: async ({ summary }) => {
              // Check for incomplete tasks before shutting down
              const allTasks = currentCoordinator.listTasks();
              const incomplete = allTasks.filter((t) => t.status !== "completed");

              // Stop all active teammates
              for (const [id, runner] of currentRunners) {
                if (runner.isRunning()) {
                  runner.stop();
                }
                await invokeCustomHook(
                  options.hooks,
                  TEAM_HOOKS.TeammateStopped,
                  { teammateId: id },
                  agent,
                );
              }
              currentRunners.clear();

              // Dispose the coordinator
              currentCoordinator.dispose();

              // Remove team tools from the primary agent
              if (activeToolNames) {
                agent.removeRuntimeTools(activeToolNames);
              }

              // Reset state
              coordinator = undefined;
              runners = undefined;
              activeToolNames = undefined;

              if (incomplete.length > 0) {
                const warning = `Warning: ${incomplete.length} task(s) not completed:\n${incomplete.map((t) => `- ${t.id}: [${t.status}] ${t.subject}`).join("\n")}\n\n`;
                return warning + summary;
              }
              return summary;
            },
          });

          const teamTools = { ...leadTools, end_team: endTeamTool };
          activeToolNames = Object.keys(teamTools);

          // Add team tools to the primary agent at runtime
          agent.addRuntimeTools(teamTools);

          // Return team context as tool result
          return buildTeamActivationMessage(reason, options.teammates, initial_tasks);
        },
      }),
    },
  });
}
