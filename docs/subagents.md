# Subagents

Subagents enable task delegation to specialized agents. Define subagents with their own system prompts and tools.

## Basic Usage

```typescript
import { createAgent, createSubagent } from "@lleverage-ai/agent-sdk";

const researcherSubagent = createSubagent({
  id: "researcher",
  name: "Researcher",
  description: "Researches topics and gathers information",
  systemPrompt: "You are a research specialist. Gather comprehensive information.",
  plugins: [webSearchPlugin],
});

const writerSubagent = createSubagent({
  id: "writer",
  name: "Writer",
  description: "Writes content based on research",
  systemPrompt: "You are a content writer. Create clear, engaging content.",
});

// Provide subagents to the parent agent
const agent = createAgent({
  model,
  systemPrompt: "Coordinate research and writing tasks.",
  subagents: [researcherSubagent, writerSubagent],
});
```

The parent agent receives a `task` tool to delegate work:

```typescript
// Agent can call: task({ subagent: "researcher", prompt: "Research AI trends" })
```

## Advanced Subagent Execution

For programmatic control over subagent execution:

```typescript
import {
  createSubagentContext,
  executeSubagent,
  executeSubagentsParallel,
} from "@lleverage-ai/agent-sdk";

// Create isolated context for subagent
const context = createSubagentContext({
  parentMessages: messages,
  subagentSystemPrompt: "You are a specialist.",
});

// Execute single subagent
const result = await executeSubagent({
  subagent: researcherSubagent,
  model,
  context,
  prompt: "Research this topic",
});

// Execute multiple subagents in parallel
const results = await executeSubagentsParallel({
  subagents: [researcherSubagent, analyzerSubagent],
  model,
  contexts: [context1, context2],
  prompts: ["Research...", "Analyze..."],
});
```

## Background Tasks

Background tasks allow subagents to run asynchronously without blocking the parent agent. When persistence is configured, tasks survive process restarts and can be recovered.

### Task Store Configuration

```typescript
import { FileTaskStore } from "@lleverage-ai/agent-sdk/task-store";

// Configure persistent task storage
const taskStore = new FileTaskStore({
  directory: "./task-data",
  expirationMs: 86400000, // 24 hours
});

// Create agent with task store
const agent = createAgent({
  model,
  subagents: [researcherSubagent],
  taskStore, // Tasks now persist across restarts
});
```

### Task Lifecycle

Background tasks progress through these states:

1. **pending**: Task created, not yet started
2. **running**: Task is currently executing
3. **completed**: Task finished successfully
4. **failed**: Task encountered an error
5. **killed**: Task was explicitly terminated by user

The `killed` status is distinct from `failed` - it indicates intentional termination via `kill_task`, not an error condition.

```typescript
import {
  listBackgroundTasks,
  getBackgroundTask,
  clearCompletedTasks,
} from "@lleverage-ai/agent-sdk";

// List all running tasks
const runningTasks = await listBackgroundTasks({ status: "running" });

// Get a specific task
const task = await getBackgroundTask("task-123");
console.log(task.status, task.result, task.error);

// Clean up old completed tasks
const cleaned = await clearCompletedTasks();
```

## Recovery Patterns

The SDK provides utilities for automatic task recovery on agent restart.

### Recover Interrupted Tasks

When your agent restarts, running tasks are interrupted. Mark them as failed:

```typescript
import { recoverRunningTasks } from "@lleverage-ai/agent-sdk";

// On agent startup
const recovered = await recoverRunningTasks(taskStore);
console.log(`Recovered ${recovered} interrupted tasks`);
```

### Recover Failed Tasks for Retry

Load failed tasks and retry those with transient errors:

```typescript
import {
  recoverFailedTasks,
  updateBackgroundTask,
} from "@lleverage-ai/agent-sdk";

// Load failed tasks
const failedTasks = await recoverFailedTasks(taskStore, {
  errorPattern: /timeout|network|ECONNREFUSED/,
  minCreatedAt: new Date(Date.now() - 86400000), // Last 24 hours
});

// Retry transient failures
for (const task of failedTasks) {
  const retryTask = updateBackgroundTask(task, {
    status: "pending",
    error: undefined,
  });
  await taskStore.save(retryTask);
  // Process retryTask through your task execution logic
}
```

### Clean Up Stale Tasks

Prevent unbounded storage growth by removing old tasks:

```typescript
import { cleanupStaleTasks } from "@lleverage-ai/agent-sdk";

// Clean up tasks older than 7 days
const sevenDays = 7 * 24 * 60 * 60 * 1000;
const cleaned = await cleanupStaleTasks(taskStore, sevenDays);
console.log(`Cleaned up ${cleaned} stale tasks`);

// Schedule periodic cleanup
setInterval(async () => {
  await cleanupStaleTasks(taskStore, sevenDays);
}, 86400000); // Once per day
```

### Complete Recovery Pattern

Combine all recovery utilities on agent startup:

```typescript
async function initializeAgent() {
  const taskStore = new FileTaskStore({ directory: "./task-data" });

  // 1. Recover interrupted tasks
  await recoverRunningTasks(taskStore);

  // 2. Retry failed tasks with transient errors
  const failedTasks = await recoverFailedTasks(taskStore, {
    errorPattern: /timeout|network/,
  });
  for (const task of failedTasks) {
    const retryTask = updateBackgroundTask(task, {
      status: "pending",
      error: undefined,
    });
    await taskStore.save(retryTask);
  }

  // 3. Clean up old tasks
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  await cleanupStaleTasks(taskStore, sevenDays);

  // 4. Create agent
  return createAgent({
    model,
    subagents: [researcherSubagent],
    taskStore,
  });
}
```

## Automatic Task Completion Handling

By default, `agent.generate()`, `stream()`, `streamResponse()`, and `streamDataResponse()` automatically wait for background tasks to complete and trigger follow-up generations. No manual polling or AgentSession required.

```typescript
const agent = createAgent({
  model,
  subagents: [researcherSubagent],
});

// Background tasks are automatically drained after generation completes.
// If the agent spawns a background task, generate() will:
// 1. Wait for the task to complete
// 2. Format the result as a follow-up prompt
// 3. Trigger another generation so the agent can process the result
// 4. Repeat until no active tasks remain
const result = await agent.generate({ prompt: "Research AI trends in the background" });
```

### Configuring Background Task Behavior

```typescript
const agent = createAgent({
  model,
  subagents: [researcherSubagent],

  // Disable automatic waiting (fire-and-forget)
  waitForBackgroundTasks: false,

  // Custom formatters for task completion follow-up prompts
  formatTaskCompletion: (task) =>
    `Task ${task.id} completed:\n${task.result}`,
  formatTaskFailure: (task) =>
    `Task ${task.id} failed:\n${task.error}`,
});
```

**Note:** Killed tasks (via `kill_task`) do NOT trigger follow-up generations — only completed and failed tasks do.

### AgentSession (Interactive Use)

For interactive CLI agents that need an event loop with user input, use `AgentSession`. See [Agent Session](./agent-session.md) for details.

```typescript
import { createAgentSession } from "@lleverage-ai/agent-sdk";

const session = createAgentSession({
  agent,
  threadId: "session-123",
});

for await (const output of session.run()) {
  switch (output.type) {
    case "text_delta":
      process.stdout.write(output.text);
      break;
    case "waiting_for_input":
      session.sendMessage(await getUserInput());
      break;
  }
}
```

## Agent Teams

The agent-teams plugin enables multi-agent team coordination where the primary agent becomes a team lead that can spawn and manage teammate agents.

```typescript
import {
  createAgent,
  createAgentTeamsPlugin,
  InMemoryTeamCoordinator,
} from "@lleverage-ai/agent-sdk";

const teamsPlugin = createAgentTeamsPlugin({
  teammates: [
    {
      id: "researcher",
      name: "Researcher",
      description: "Researches topics and gathers information",
      create: ({ model }) =>
        createAgent({
          model,
          systemPrompt: "You are a research specialist.",
        }),
    },
    {
      id: "writer",
      name: "Writer",
      description: "Writes content based on research",
      create: ({ model }) =>
        createAgent({
          model,
          systemPrompt: "You are a content writer.",
        }),
    },
  ],
  coordinator: new InMemoryTeamCoordinator(),
});

const agent = createAgent({
  model,
  systemPrompt: "You are a team lead. Coordinate research and writing.",
  plugins: [teamsPlugin],
});
```

### How Teams Work

1. The agent receives a `start_team` tool. When called, team management tools are added dynamically at runtime.
2. The primary agent becomes the **team lead** — no handoff occurs.
3. Teammates run independently in background sessions via `HeadlessSessionRunner`.
4. Communication happens through **mailboxes** — the lead and teammates exchange messages via the `TeamCoordinator`.
5. A **shared task list** with dependencies coordinates work across the team.
6. When `end_team` is called, team tools are removed and teammates are shut down.

### Team Tools

**Lead tools** (added when `start_team` is called):
- `team_spawn` — Spawn a new teammate
- `team_message` — Send a message to a teammate
- `team_read_messages` — Read messages from teammates
- `team_list_teammates` — List active teammates
- `team_task_create` — Create a task in the shared task list
- `team_task_list` — List all team tasks
- `team_task_get` — Get details of a specific task
- `team_shutdown` — Shut down a specific teammate
- `end_team` — End team mode and shut down all teammates

**Teammate tools** (available to each teammate):
- `team_message` — Send a message to the lead or other teammates
- `team_read_messages` — Read messages from the mailbox
- `team_list_teammates` — List other teammates
- `team_task_list` — List all team tasks
- `team_task_claim` — Claim a task from the shared list
- `team_task_complete` — Mark a claimed task as completed

### Team Hooks

Subscribe to team lifecycle events via custom hooks:

```typescript
import { TEAM_HOOKS } from "@lleverage-ai/agent-sdk";

const teamsPlugin = createAgentTeamsPlugin({
  teammates: [...],
  coordinator: new InMemoryTeamCoordinator(),
  hooks: {
    Custom: {
      [TEAM_HOOKS.TeammateSpawned]: [async (input) => {
        console.log("Teammate spawned:", input.payload);
      }],
      [TEAM_HOOKS.TeamTaskCompleted]: [async (input) => {
        console.log("Task completed:", input.payload);
      }],
    },
  },
});
```

Available team hook events:
- `TEAM_HOOKS.TeammateSpawned` — A teammate was created
- `TEAM_HOOKS.TeammateIdle` — A teammate has no more work
- `TEAM_HOOKS.TeammateStopped` — A teammate was shut down
- `TEAM_HOOKS.TeamTaskCreated` — A task was added to the shared list
- `TEAM_HOOKS.TeamTaskClaimed` — A teammate claimed a task
- `TEAM_HOOKS.TeamTaskCompleted` — A task was completed
- `TEAM_HOOKS.TeamMessageSent` — A message was sent between agents
