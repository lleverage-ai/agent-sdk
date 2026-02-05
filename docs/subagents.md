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

For interactive agents that should automatically respond when background tasks complete, use `AgentSession`. See [Agent Session](./agent-session.md) for details.

```typescript
import { createAgentSession } from "@lleverage-ai/agent-sdk";

const session = createAgentSession({
  agent,
  threadId: "session-123",
});

// Session automatically handles task completions
for await (const output of session.run()) {
  switch (output.type) {
    case "text_delta":
      // Includes responses to background task completions
      process.stdout.write(output.text);
      break;
    case "waiting_for_input":
      session.sendMessage(await getUserInput());
      break;
  }
}
```

Without AgentSession, you must poll for task status or subscribe to TaskManager events manually:

```typescript
// Manual approach (without AgentSession)
agent.taskManager.on("taskCompleted", async (task) => {
  // Manually trigger follow-up generation
  await agent.generate({
    prompt: `Background task completed: ${task.result}`,
    messages: currentMessages,
  });
});
```
