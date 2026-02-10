# Agent Session

AgentSession provides an event-driven wrapper around an Agent for interactive, long-running conversations. It handles background task completions, interrupts, and checkpointing automatically.

## When to Use AgentSession

> **Note:** Since v0.0.4, `agent.generate()`, `stream()`, `streamResponse()`, and `streamDataResponse()` automatically wait for background tasks and trigger follow-up generations. You no longer need AgentSession just for background task handling. AgentSession is primarily useful for interactive event loops.

| Scenario | Use AgentSession? |
|----------|-------------------|
| Interactive chat/CLI with user input loop | Yes |
| Approval flows with interrupts | Yes |
| Background tasks in API endpoints | No - `generate()` handles this automatically |
| Simple request/response (API endpoint) | No - use Agent directly |
| Serverless functions | No - use Agent directly |
| One-shot queries | No - use Agent directly |

## Basic Usage

```typescript
import {
  createAgent,
  createAgentSession,
  FilesystemBackend,
} from "@lleverage-ai/agent-sdk";

const backend = new FilesystemBackend({
  rootDir: process.cwd(),
  enableBash: true,
});

const agent = createAgent({
  model: "anthropic/claude-sonnet-4",
  systemPrompt: "You are a helpful assistant.",
  backend,
});

const session = createAgentSession({
  agent,
  threadId: "session-123", // Enable checkpointing
});

// Run the event loop
for await (const output of session.run()) {
  switch (output.type) {
    case "waiting_for_input":
      const input = await getUserInput();
      if (input === "exit") {
        session.stop();
      } else {
        session.sendMessage(input);
      }
      break;

    case "text_delta":
      process.stdout.write(output.text);
      break;

    case "generation_complete":
      console.log("\n");
      break;

    case "interrupt":
      const response = await handleInterrupt(output.interrupt);
      session.respondToInterrupt(output.interrupt.id, response);
      break;

    case "error":
      console.error("Error:", output.error);
      break;
  }
}
```

## Background Task Handling

AgentSession automatically handles background task completions. When a background bash command or subagent completes, the session injects the result and triggers a new generation.

### With AgentSession (Automatic)

```typescript
const session = createAgentSession({ agent });

for await (const output of session.run()) {
  // When a background task completes, the session automatically:
  // 1. Receives the taskCompleted/taskFailed event
  // 2. Formats the result as a message
  // 3. Triggers a new generation
  // 4. Yields text_delta/generation_complete events
}
```

### Without AgentSession (Automatic)

Since v0.0.4, `agent.generate()` automatically waits for background tasks and triggers follow-up generations. No manual polling needed:

```typescript
// generate() will automatically wait for background tasks to complete
// and trigger follow-up generations to process the results
const result = await agent.generate({ prompt: "Run this in background" });

// By the time generate() returns, all background tasks have been processed.
// Set waitForBackgroundTasks: false on the agent for fire-and-forget behavior.
```

## Task Status Types

Background tasks can have these statuses:

| Status | Description |
|--------|-------------|
| `pending` | Task created, not yet started |
| `running` | Task is currently executing |
| `completed` | Task finished successfully |
| `failed` | Task encountered an error |
| `killed` | Task was explicitly terminated by user |

The `killed` status is distinct from `failed`:
- `failed` triggers automatic follow-up generation (something went wrong)
- `killed` does NOT trigger follow-up (user intentionally stopped it)

## Session Options

```typescript
interface AgentSessionOptions {
  /** The agent to wrap */
  agent: Agent;

  /** Thread ID for checkpointing (enables state persistence) */
  threadId?: string;

  /**
   * Whether to auto-process task completions.
   * When true, completed tasks trigger new generations.
   * @default true
   */
  autoProcessTaskCompletions?: boolean;

  /** Custom formatter for task completion messages */
  formatTaskCompletion?: (task: BackgroundTask) => string;

  /** Custom formatter for task failure messages */
  formatTaskFailure?: (task: BackgroundTask) => string;

  /** Initial messages to populate the conversation */
  initialMessages?: ModelMessage[];

  /**
   * Maximum number of turns before stopping.
   * @default Infinity
   */
  maxTurns?: number;
}
```

## Output Events

The session yields these event types:

```typescript
type SessionOutput =
  | { type: "text_delta"; text: string }
  | { type: "generation_complete"; fullText: string }
  | { type: "interrupt"; interrupt: Interrupt }
  | { type: "error"; error: Error }
  | { type: "waiting_for_input" };
```

## Handling Interrupts

Interrupts pause execution to wait for user input (e.g., tool approval):

```typescript
for await (const output of session.run()) {
  if (output.type === "interrupt") {
    const { interrupt } = output;

    if (interrupt.type === "approval") {
      // Tool approval request
      const approved = await askUserForApproval(
        interrupt.toolName,
        interrupt.request.args
      );
      session.respondToInterrupt(interrupt.id, { approved });
    } else {
      // Custom interrupt
      const response = await handleCustomInterrupt(interrupt);
      session.respondToInterrupt(interrupt.id, response);
    }
  }
}
```

## Session Methods

```typescript
class AgentSession {
  /** Send a user message to the session */
  sendMessage(content: string): void;

  /** Respond to a pending interrupt */
  respondToInterrupt(interruptId: string, response: unknown): void;

  /** Stop the session event loop */
  stop(): void;

  /** Get current conversation messages */
  getMessages(): ModelMessage[];

  /** Get current turn count */
  getTurnCount(): number;

  /** Check if session is running */
  isRunning(): boolean;

  /** Run the session event loop (async generator) */
  run(): AsyncGenerator<SessionOutput>;
}
```

## Custom Task Formatters

Customize how task completions appear in the conversation:

```typescript
const session = createAgentSession({
  agent,
  formatTaskCompletion: (task) => {
    return `## Background Task Completed
**Task:** ${task.description}
**Result:**
\`\`\`
${task.result}
\`\`\``;
  },
  formatTaskFailure: (task) => {
    return `## Background Task Failed
**Task:** ${task.description}
**Error:** ${task.error}`;
  },
});
```

## Disabling Auto-Processing

For manual control over task completions:

```typescript
const session = createAgentSession({
  agent,
  autoProcessTaskCompletions: false,
});

// Subscribe to task events manually
agent.taskManager.on("taskCompleted", (task) => {
  // Handle completion yourself
  console.log("Task completed:", task.id);
});
```

## Integration with Checkpointing

When `threadId` is provided, the session integrates with the agent's checkpointer:

```typescript
import { createFileSaver } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  checkpointer: createFileSaver({ directory: ".agent/checkpoints" }),
});

const session = createAgentSession({
  agent,
  threadId: "user-123-session-1", // Enables checkpoint integration
});

// Session state is automatically saved/restored
// Interrupts can be resumed after process restart
```

## Complete CLI Example

```typescript
import * as readline from "node:readline";
import {
  createAgent,
  createAgentSession,
  FilesystemBackend,
} from "@lleverage-ai/agent-sdk";

const backend = new FilesystemBackend({
  rootDir: process.cwd(),
  enableBash: true,
});

const agent = createAgent({
  model: "anthropic/claude-sonnet-4",
  systemPrompt: "You are a helpful assistant.",
  backend,
});

const session = createAgentSession({
  agent,
  threadId: `cli-${Date.now()}`,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("Chat started. Type 'exit' to quit.\n");

async function runSession() {
  for await (const output of session.run()) {
    switch (output.type) {
      case "waiting_for_input":
        rl.question("You: ", (input) => {
          if (input.trim().toLowerCase() === "exit") {
            session.stop();
            rl.close();
            process.exit(0);
          }
          session.sendMessage(input.trim());
        });
        break;

      case "text_delta":
        if (output.text) {
          process.stdout.write(`Assistant: ${output.text}`);
        }
        break;

      case "generation_complete":
        process.stdout.write("\n\n");
        break;

      case "interrupt":
        console.log(`\n[Interrupt: ${output.interrupt.type}]`);
        rl.question("Your response: ", (response) => {
          session.respondToInterrupt(output.interrupt.id, { answer: response });
        });
        break;

      case "error":
        console.error("\nError:", output.error.message);
        break;
    }
  }
}

runSession().catch(console.error);
```
