# Prompt Builder

The Prompt Builder system creates dynamic system prompts from composable components. Instead of maintaining one large static prompt string, you can assemble a prompt from small sections that react to the agent's tools, backend, permissions, and runtime context.

## Overview

The SDK now uses a goal-directed, behavior-first default prompt builder.

The default builder is designed around three ideas:

- the agent should focus on helping the user achieve their goal
- the default prompt should define operating behavior before it advertises capabilities
- verbose capability inventories should be opt-in, not forced into every prompt

That means the default builder now emphasizes:

- identity and interaction contract
- action and verification policy
- compact capability summaries
- skill-loading guidance
- delegation guidance
- memory guidance
- permission mode

It no longer dumps full tool, skill, and plugin inventories by default.

## Quick Start

### Using the Default Builder

If you omit both `systemPrompt` and `promptBuilder`, the agent automatically uses the default builder:

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";
import { tool } from "ai";
import { z } from "zod";

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: {
    read: tool({
      description: "Read a file from disk",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => `Contents of ${path}`,
    }),
  },
});
```

Example shape of the generated system prompt:

```text
You are an interactive agent. Your job is to help the user achieve their goal using the instructions below and the tools available to you.

# Interaction Contract
...

# Action Policy
...

# Capability Summary
- You can use tools to inspect, modify, and act on the user's environment when needed.
...
```

### Using a Custom Builder

You can replace the default builder entirely:

```typescript
import { PromptBuilder } from "@lleverage-ai/agent-sdk";

const builder = new PromptBuilder()
  .register({
    name: "identity",
    priority: 100,
    render: () => "You are a planning assistant.",
  })
  .register({
    name: "policy",
    priority: 90,
    render: () => "Prefer concise plans with explicit tradeoffs.",
  });

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  promptBuilder: builder,
});
```

### Customizing the Default Builder

The default builder is still fully composable:

```typescript
import { createDefaultPromptBuilder } from "@lleverage-ai/agent-sdk";

const builder = createDefaultPromptBuilder().register({
  name: "project-context",
  priority: 92,
  render: () => "# Project Context\n\nYou are working in a regulated environment.",
});

const agent = createAgent({
  model,
  promptBuilder: builder,
});
```

## Default Components

The default builder registers these components:

- `identity`
- `interaction-contract`
- `action-policy`
- `capability-summary`
- `skill-loading-policy`
- `delegation-instructions` when subagents are available
- `memory-policy`
- `permission-mode` when a permission mode is set

These components are exported individually, so you can remove or replace any of them.

## Opt-In Inventory Components

Verbose inventory sections still exist, but they are no longer part of the default builder:

- `toolsComponent`
- `skillsComponent`
- `pluginsComponent`
- `capabilitiesComponent`
- `contextComponent`

If you want the old-style explicit listings, add them yourself:

```typescript
import {
  createDefaultPromptBuilder,
  toolsComponent,
  skillsComponent,
  pluginsComponent,
} from "@lleverage-ai/agent-sdk";

const builder = createDefaultPromptBuilder().registerMany([
  toolsComponent,
  skillsComponent,
  pluginsComponent,
]);
```

## Core Concepts

### PromptContext

Each component receives the current `PromptContext`:

```typescript
interface PromptContext {
  tools?: Array<{ name: string; description: string }>;
  skills?: Array<{ name: string; description: string }>;
  plugins?: Array<{ name: string; description: string }>;
  backend?: {
    type: string;
    hasExecuteCapability: boolean;
    rootDir?: string;
  };
  state?: AgentState;
  model?: string;
  maxSteps?: number;
  permissionMode?: PermissionMode;
  currentMessages?: ModelMessage[];
  threadId?: string;
  custom?: Record<string, unknown>;
}
```

### PromptComponent

Each component contributes one section to the final prompt:

```typescript
interface PromptComponent {
  name: string;
  priority?: number;
  condition?: (ctx: PromptContext) => boolean;
  render: (ctx: PromptContext) => string;
}
```

### PromptBuilder

The builder:

1. collects all registered components
2. filters them by `condition`
3. sorts them by priority
4. renders them
5. joins non-empty output with blank lines

## Customization Patterns

### Remove a Default Component

```typescript
const builder = createDefaultPromptBuilder().unregister("memory-policy");
```

### Replace a Default Component

```typescript
const builder = createDefaultPromptBuilder()
  .unregister("identity")
  .register({
    name: "identity",
    priority: 100,
    render: () => "You are a triage assistant.",
  });
```

### Add a Low-Priority Reminder

```typescript
const builder = createDefaultPromptBuilder().register({
  name: "final-reminder",
  priority: 10,
  render: () => "Prefer concise final answers.",
});
```

### Inspect Context Without Changing Output

```typescript
const builder = createDefaultPromptBuilder().register({
  name: "debug",
  priority: 0,
  render: (ctx) => {
    console.log(ctx.tools);
    return "";
  },
});
```

## Migration Notes

If you relied on the previous default builder behavior, the main change is that default prompts no longer include:

- `# Available Tools`
- `# Available Skills`
- `# Loaded Plugins`

To restore those sections, register the verbose inventory components explicitly.

If you only used the default builder as-is, no API migration is required.

## Backward Compatibility

The prompt builder remains backward compatible:

- existing `systemPrompt` strings still work
- existing custom `PromptBuilder` instances still work
- existing component APIs still work
- verbose inventory components are still exported

Only the composition of `createDefaultPromptBuilder()` has changed.
