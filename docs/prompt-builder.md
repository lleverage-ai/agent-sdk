# Prompt Builder

The Prompt Builder system creates dynamic system prompts from composable components. Instead of maintaining one large static prompt string, you can assemble a prompt from small sections that react to the agent's tools, plugins, backend, permissions, and runtime context.

## Overview

The SDK now uses a goal-directed, behavior-first default prompt builder.

The default builder is designed around three ideas:

- the agent should focus on helping the user achieve their goal
- the default prompt should define operating behavior before it advertises capabilities
- verbose capability inventories should be opt-in, not forced into every prompt

That means the default builder emphasizes:

- identity and interaction contract
- action and verification policy
- explicit instruction layers with precedence
- compact capability summaries
- skill-loading guidance
- delegation guidance
- compact recalled memory separate from standing instructions
- memory guidance when durable memory is actually available
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

# Instruction Layers
...

# Capability Summary
- You can use the configured tools to inspect information or take actions when needed.
...
```

### Using a Custom Builder

You can replace the default builder entirely:

```typescript
import { PromptBuilder, createAgent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";

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
import { createAgent, createDefaultPromptBuilder } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";

const builder = createDefaultPromptBuilder().register({
  name: "project-context",
  priority: 92,
  render: () => "# Project Context\n\nYou are working in a regulated environment.",
});

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  promptBuilder: builder,
});
```

## Default Components

The default builder registers these components:

- `identity`
- `interaction-contract`
- `action-policy`
- `instruction-layers`
- `capability-summary`
- `skill-loading-policy`
- `delegation-instructions` when subagents are available
- `recalled-memory` when `PromptContext.memory?.recall` contains non-empty entries
- `memory-policy` unless `PromptContext.memoryAvailable` is explicitly `false`
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
  capabilitiesComponent,
  createDefaultPromptBuilder,
  pluginsComponent,
  skillsComponent,
  toolsComponent,
} from "@lleverage-ai/agent-sdk";

const builder = createDefaultPromptBuilder().registerMany([
  capabilitiesComponent,
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
  instructionLayers?: PromptInstructionLayer[];
  memory?: PromptMemoryContext;
  loadedSkills?: PromptLoadedSkill[];
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
  memoryAvailable?: boolean;
  custom?: Record<string, unknown>;
}
```

Related prompt-builder types:

```typescript
interface PromptInstructionLayer {
  label: string;
  instructions: string;
  precedence?: number; // higher value = higher priority
  source?: string;
}

interface PromptMemoryContext {
  standingInstructions?: PromptMemoryEntry[];
  recall?: PromptMemoryEntry[];
}

interface PromptMemoryEntry {
  label: string;
  content: string;
  source?: string;
}

interface PromptLoadedSkill {
  name: string;
  summary?: string;
  instructions?: string;
}
```

When using `createAgent()`, `memoryAvailable` is controlled by `AgentOptions.memoryAvailable`. It defaults to `false` because the SDK does not wire durable memory into the agent automatically.

When using `PromptBuilder` directly, `memoryAvailable` remains opt-out for backward compatibility. The default memory component renders unless `memoryAvailable` is explicitly set to `false`.

Supplying structured `memory` through `createAgent()` or `generate()` populates `PromptContext.memory`, but it does not implicitly enable `memoryAvailable`. That means the default builder can render instruction layers and recalled memory from structured inputs while still keeping the general persistent-memory policy opt-in.

When using `createAgent()`, the prompt context is populated from three sources:

- agent configuration such as `instructionLayers`, `memory`, tools, plugins, and permissions
- generation-time overrides passed to `generate()` / `stream()` via `instructionLayers` and `memory`
- activated skill state retained by the skill registry and exposed as `loadedSkills`

The default builder renders instruction layers in descending `precedence` order. Activated skills are injected as a high-priority layer with precedence `80`, while `memory.standingInstructions` is treated as a lower-priority layer with precedence `40`. `memory.recall` is rendered separately under `# Recalled Memory` rather than being merged into the instruction-layer stack.

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
import { createDefaultPromptBuilder } from "@lleverage-ai/agent-sdk";

const builder = createDefaultPromptBuilder().unregister("memory-policy");
```

### Replace a Default Component

```typescript
import { createDefaultPromptBuilder } from "@lleverage-ai/agent-sdk";

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
import { createDefaultPromptBuilder } from "@lleverage-ai/agent-sdk";

const builder = createDefaultPromptBuilder().register({
  name: "final-reminder",
  priority: 10,
  render: () => "Prefer concise final answers.",
});
```

### Inspect Context Without Changing Output

```typescript
import { createDefaultPromptBuilder } from "@lleverage-ai/agent-sdk";

const builder = createDefaultPromptBuilder().register({
  name: "debug",
  priority: 0,
  render: (ctx) => {
    console.log(ctx.tools);
    return "";
  },
});
```

### Advertise Memory Only When It Exists

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  memoryAvailable: true,
});
```

### Pass Structured Memory and Instruction Layers

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  instructionLayers: [
    {
      label: "App Policy",
      instructions: "Prefer short status updates.",
      precedence: 70,
    },
  ],
});

await agent.generate({
  prompt: "Continue the task",
  memory: {
    standingInstructions: [
      { label: "Project Memory", content: "Use Bun workspace commands." },
    ],
    recall: [
      { label: "Recent Recall", content: "The user is editing the prompt builder." },
    ],
  },
});
```

## Migration Notes

If you relied on the previous default builder behavior, the main change is that default prompts no longer include:

- `# Available Tools`
- `# Available Skills`
- `# Loaded Plugins`

To restore those sections, register the verbose inventory components explicitly.

`buildMemorySection()` and `buildPathMemoryContext()` remain available for compatibility helpers, but the preferred default path is now structured memory via `PromptContext.memory`.

If you only used the default builder as-is, no API migration is required.

## Backward Compatibility

The prompt builder remains backward compatible:

- existing `systemPrompt` strings still work
- existing custom `PromptBuilder` instances still work
- existing component APIs still work
- verbose inventory components are still exported

Only the composition of `createDefaultPromptBuilder()` has changed.
