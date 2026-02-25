# Prompt Builder

The Prompt Builder system enables creating dynamic, context-aware system prompts from composable components. Instead of static strings, prompts can automatically include information about the agent's tools, skills, backend capabilities, and configuration.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Default Components](#default-components)
- [Customization](#customization)
- [Advanced Usage](#advanced-usage)
- [Migration Guide](#migration-guide)
- [API Reference](#api-reference)

## Overview

### Why Use Prompt Builder?

**Problems with Static Prompts:**
- Tools and skills aren't mentioned in the system prompt
- Agent capabilities aren't communicated to the model
- Changes to tools require manual prompt updates
- No way to conditionally include information

**Benefits of Dynamic Prompts:**
- ✅ Automatically lists available tools and their descriptions
- ✅ Includes skills and plugins when present
- ✅ Communicates backend capabilities (bash, filesystem access)
- ✅ Shows permission mode information
- ✅ Composable components with priorities
- ✅ Conditional sections based on agent configuration
- ✅ Easy to customize or extend

### Backward Compatibility

The Prompt Builder is fully backward compatible:
- Existing `systemPrompt` strings continue to work unchanged
- No breaking changes to the API
- Opt-in: use the builder only when you need dynamic prompts

## Quick Start

### Using the Default Builder

The simplest way to use the Prompt Builder is to omit both `systemPrompt` and `promptBuilder` - the agent will automatically use the default builder:

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";
import { tool } from "ai";
import { z } from "zod";

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  // No systemPrompt = uses default prompt builder
  tools: {
    read: tool({
      description: "Read a file from disk",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => readFileSync(path, "utf-8"),
    }),
    write: tool({
      description: "Write content to a file",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path, content }) => writeFileSync(path, content),
    }),
  },
});
```

**Generated System Prompt:**
```
You are a helpful AI assistant.

# Available Tools

You have access to the following tools:
- **read**: Read a file from disk
- **write**: Write content to a file

# Capabilities

- Read and write files to the filesystem
```

### Customizing the Default Builder

Clone the default builder and add your own components:

```typescript
import { createDefaultPromptBuilder } from "@lleverage-ai/agent-sdk";

const builder = createDefaultPromptBuilder()
  .register({
    name: "project-context",
    priority: 95, // Lower than identity (100), higher than tools (70)
    render: (ctx) => {
      return `# Project Context\n\nYou are working on a TypeScript project.`;
    },
  });

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  promptBuilder: builder,
  tools: myTools,
});
```

### Building from Scratch

Create a completely custom prompt:

```typescript
import { PromptBuilder } from "@lleverage-ai/agent-sdk";

const builder = new PromptBuilder()
  .register({
    name: "role",
    priority: 100,
    render: () => "You are a code review assistant.",
  })
  .register({
    name: "tools",
    priority: 80,
    condition: (ctx) => ctx.tools && ctx.tools.length > 0,
    render: (ctx) => {
      const toolList = ctx.tools!.map(t => `- ${t.name}`).join("\n");
      return `Available tools:\n${toolList}`;
    },
  });

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  promptBuilder: builder,
  tools: myTools,
});
```

## Core Concepts

### PromptContext

The context object passed to all components contains the agent's current state:

```typescript
interface PromptContext {
  // Tools available to the agent
  tools?: Array<{ name: string; description: string }>;

  // Skills registered with the agent
  skills?: Array<{ name: string; description: string }>;

  // Plugins loaded by the agent
  plugins?: Array<{ name: string; description: string }>;

  // Backend information
  backend?: {
    type: string;                    // "filesystem", "state", etc.
    hasExecuteCapability: boolean;   // Can run bash commands
    rootDir?: string;                // Working directory
  };

  // Agent state
  state?: AgentState;

  // Configuration
  model?: string;
  maxSteps?: number;
  permissionMode?: PermissionMode;

  // Runtime context (during generation)
  currentMessages?: ModelMessage[];
  threadId?: string;
}
```

### PromptComponent

Components are the building blocks of prompts:

```typescript
interface PromptComponent {
  name: string;              // Unique identifier
  priority?: number;         // Higher = rendered first (default: 50)
  condition?: (ctx: PromptContext) => boolean;  // Optional filter
  render: (ctx: PromptContext) => string;       // Generate content
}
```

**Component Lifecycle:**
1. All registered components are collected
2. Filtered by their `condition` functions
3. Sorted by `priority` (higher first)
4. `render` functions called with current context
5. Results joined with double newlines

### PromptBuilder

The builder manages and composes components:

```typescript
class PromptBuilder {
  register(component: PromptComponent): this;
  registerMany(components: PromptComponent[]): this;
  unregister(name: string): this;
  build(context: PromptContext): string;
  clone(): PromptBuilder;
  getComponentNames(): string[];
}
```

## Default Components

The default builder includes 7 components:

### 1. Identity Component (Priority: 100)

```typescript
{
  name: "identity",
  priority: 100,
  render: () => "You are a helpful AI assistant."
}
```

### 2. Tools Component (Priority: 70)

Lists available tools with descriptions. Only shown when tools are present.

```typescript
{
  name: "tools-listing",
  priority: 70,
  condition: (ctx) => ctx.tools && ctx.tools.length > 0,
  render: (ctx) => {
    const toolLines = ctx.tools!.map(t => `- **${t.name}**: ${t.description}`);
    return `# Available Tools\n\nYou have access to the following tools:\n${toolLines.join("\n")}`;
  }
}
```

### 3. Skills Component (Priority: 65)

Lists available skills. Only shown when skills are present.

```typescript
{
  name: "skills-listing",
  priority: 65,
  condition: (ctx) => ctx.skills && ctx.skills.length > 0,
  render: (ctx) => {
    const skillLines = ctx.skills!.map(s => `- **${s.name}**: ${s.description}`);
    return `# Available Skills\n\nYou can activate these skills on-demand:\n${skillLines.join("\n")}`;
  }
}
```

### 4. Plugins Component (Priority: 68)

Lists loaded plugins. Only shown when plugins are present.

### 5. Delegation Component (Priority: 75)

Shows subagent delegation guidance when subagents are configured.

### 6. Capabilities Component (Priority: 60)

Shows what the agent can do based on backend configuration:

```typescript
{
  name: "capabilities",
  priority: 60,
  render: (ctx) => {
    const capabilities = [];
    if (ctx.backend?.hasExecuteCapability) {
      capabilities.push("- Execute shell commands (bash)");
    }
    if (ctx.backend?.type === "filesystem") {
      capabilities.push("- Read and write files to the filesystem");
    }
    // ... more capabilities
    return `# Capabilities\n\n${capabilities.join("\n")}`;
  }
}
```

### 7. Permission Mode Component (Priority: 55)

Explains the current permission mode. Only shown when set.

## Customization

### Adding Components

```typescript
const builder = createDefaultPromptBuilder()
  .register({
    name: "coding-standards",
    priority: 85,  // Between tools and capabilities
    render: () => {
      return `# Coding Standards

- Use TypeScript strict mode
- Write tests for all new features
- Follow the existing code style`;
    },
  });
```

### Removing Components

```typescript
const builder = createDefaultPromptBuilder()
  .unregister("identity")  // Remove default identity
  .unregister("permission-mode");  // Remove permission mode section
```

### Replacing Components

```typescript
const builder = createDefaultPromptBuilder()
  .unregister("identity")
  .register({
    name: "custom-identity",
    priority: 100,  // Same priority as original
    render: () => "You are a specialized Python coding assistant.",
  });
```

### Conditional Components

Only include a component when certain conditions are met:

```typescript
const builder = createDefaultPromptBuilder()
  .register({
    name: "production-warning",
    priority: 110,  // Show before everything else
    condition: (ctx) => process.env.NODE_ENV === "production",
    render: () => {
      return `⚠️ **PRODUCTION MODE** - Exercise caution with file operations!`;
    },
  });
```

### Context-Aware Components

Access the full agent context:

```typescript
const builder = createDefaultPromptBuilder()
  .register({
    name: "dynamic-instructions",
    priority: 90,
    render: (ctx) => {
      const hasFileTools = ctx.tools?.some(t =>
        ["read", "write", "edit"].includes(t.name)
      );

      if (hasFileTools) {
        return `# File Operations

When working with files:
- Always use relative paths
- Validate file paths before operations
- Handle errors gracefully`;
      }

      return "";  // Don't show if no file tools
    },
  });
```

## Advanced Usage

### Component Priorities

Components are rendered in priority order (highest first):

```typescript
const builder = new PromptBuilder()
  .register({ name: "header", priority: 100, render: () => "# Header" })
  .register({ name: "body", priority: 50, render: () => "Body content" })
  .register({ name: "footer", priority: 10, render: () => "Footer" });

// Output order: Header → Body content → Footer
```

**Recommended Priority Ranges:**
- **100+**: Critical instructions (identity, warnings)
- **80-99**: Important context (custom instructions)
- **60-79**: Capabilities and tools
- **40-59**: Secondary information
- **1-39**: Footer content

### Cloning for Variants

Create multiple agent variants from a base builder:

```typescript
const baseBuilder = createDefaultPromptBuilder()
  .register({
    name: "company-policy",
    priority: 95,
    render: () => "Follow company security policies at all times.",
  });

// Create specialized variants
const codeReviewAgent = createAgent({
  model,
  promptBuilder: baseBuilder.clone()
    .unregister("identity")
    .register({
      name: "reviewer-role",
      priority: 100,
      render: () => "You are a code review assistant.",
    }),
});

const documentationAgent = createAgent({
  model,
  promptBuilder: baseBuilder.clone()
    .unregister("identity")
    .register({
      name: "docs-role",
      priority: 100,
      render: () => "You are a documentation expert.",
    }),
});
```

### Dynamic Components Based on Tools

Provide tool-specific instructions:

```typescript
const builder = createDefaultPromptBuilder()
  .register({
    name: "tool-instructions",
    priority: 75,
    condition: (ctx) => !!ctx.tools,
    render: (ctx) => {
      const instructions = [];

      if (ctx.tools?.some(t => t.name === "bash")) {
        instructions.push("- Use bash for system operations");
      }

      if (ctx.tools?.some(t => t.name === "read")) {
        instructions.push("- Always read files before editing them");
      }

      if (instructions.length === 0) return "";

      return `# Tool Usage Guidelines\n\n${instructions.join("\n")}`;
    },
  });
```

### Access Agent State

Use the agent's internal state in prompts:

```typescript
const builder = createDefaultPromptBuilder()
  .register({
    name: "todo-summary",
    priority: 65,
    condition: (ctx) => ctx.state?.todos && ctx.state.todos.length > 0,
    render: (ctx) => {
      const todos = ctx.state!.todos;
      const pending = todos.filter(t => t.status === "pending").length;
      const completed = todos.filter(t => t.status === "completed").length;

      return `# Current Tasks

- ${pending} pending task(s)
- ${completed} completed task(s)`;
    },
  });
```

## Migration Guide

### From Static Prompts

**Before:**
```typescript
const agent = createAgent({
  model,
  systemPrompt: `You are a helpful assistant with access to:
- read: Read files
- write: Write files
- bash: Execute commands`,
  tools: { read, write, bash },
});
```

**After:**
```typescript
const agent = createAgent({
  model,
  // Tools are automatically listed by default builder
  tools: { read, write, bash },
});
```

### Keeping Static Prompts

If you prefer static prompts, they still work:

```typescript
const agent = createAgent({
  model,
  systemPrompt: "You are a specialized assistant.",
  tools,
});
```

### Gradual Migration

Start with the default builder and customize incrementally:

```typescript
// Step 1: Remove systemPrompt, use default
const agent = createAgent({
  model,
  tools,
});

// Step 2: Add one custom component
const builder = createDefaultPromptBuilder()
  .register({
    name: "my-instructions",
    priority: 90,
    render: () => "Follow project coding standards.",
  });

const agent = createAgent({
  model,
  promptBuilder: builder,
  tools,
});

// Step 3: Build entirely custom prompts as needed
```

## API Reference

### Types

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
}

interface PromptComponent {
  name: string;
  priority?: number;
  condition?: (ctx: PromptContext) => boolean;
  render: (ctx: PromptContext) => string;
}
```

### PromptBuilder Class

```typescript
class PromptBuilder {
  // Register a component
  register(component: PromptComponent): this;

  // Register multiple components
  registerMany(components: PromptComponent[]): this;

  // Remove a component by name
  unregister(name: string): this;

  // Build the final prompt
  build(context: PromptContext): string;

  // Clone this builder
  clone(): PromptBuilder;

  // Get component names (for debugging)
  getComponentNames(): string[];
}
```

### Factory Functions

```typescript
// Create a builder with default components
function createDefaultPromptBuilder(): PromptBuilder;
```

### Default Components

```typescript
// Available for direct use or as examples
export const identityComponent: PromptComponent;
export const toolsComponent: PromptComponent;
export const skillsComponent: PromptComponent;
export const pluginsComponent: PromptComponent;
export const capabilitiesComponent: PromptComponent;
export const permissionModeComponent: PromptComponent;
export const contextComponent: PromptComponent;
```

### AgentOptions

```typescript
interface AgentOptions {
  // ... other options

  // Static prompt (mutually exclusive with promptBuilder)
  systemPrompt?: string;

  // Dynamic prompt builder (mutually exclusive with systemPrompt)
  promptBuilder?: PromptBuilder;
}
```

## Best Practices

### 1. Start Simple

Begin with the default builder and only customize when needed:

```typescript
// Good: Let the builder handle it
const agent = createAgent({ model, tools });

// Avoid: Prematurely building custom prompts
```

### 2. Use Appropriate Priorities

Keep related components together in the prompt:

```typescript
const builder = createDefaultPromptBuilder()
  .register({
    name: "safety-warning",
    priority: 105,  // Before everything
    render: () => "⚠️ Exercise caution with all operations.",
  })
  .register({
    name: "tool-tips",
    priority: 75,   // After tools (70)
    render: () => "Always validate inputs before using tools.",
  });
```

### 3. Make Components Conditional

Only show information when relevant:

```typescript
// Good
{
  condition: (ctx) => ctx.backend?.hasExecuteCapability,
  render: () => "You can execute bash commands."
}

// Avoid: Always showing information that might not be relevant
{
  render: () => "You might be able to execute bash commands."
}
```

### 4. Keep Components Focused

Each component should have a single responsibility:

```typescript
// Good: Focused components
const toolsComponent = { /* lists tools */ };
const toolInstructions = { /* tool usage guidelines */ };

// Avoid: Kitchen sink components
const everythingComponent = { /* tools + instructions + tips + ... */ };
```

### 5. Use Descriptive Names

Component names should clearly indicate their purpose:

```typescript
// Good
{ name: "security-policy" }
{ name: "coding-standards" }
{ name: "file-operation-rules" }

// Avoid
{ name: "comp1" }
{ name: "instructions" }
{ name: "stuff" }
```

## Examples

### Example 1: Code Review Assistant

```typescript
import { createDefaultPromptBuilder } from "@lleverage-ai/agent-sdk";

const builder = createDefaultPromptBuilder()
  .unregister("identity")
  .register({
    name: "reviewer-identity",
    priority: 100,
    render: () => "You are an expert code reviewer.",
  })
  .register({
    name: "review-guidelines",
    priority: 90,
    render: () => `# Review Guidelines

- Check for security vulnerabilities
- Verify error handling
- Assess code clarity and maintainability
- Suggest improvements constructively`,
  });

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  promptBuilder: builder,
  tools: { read, write },
});
```

### Example 2: Documentation Generator

```typescript
const builder = createDefaultPromptBuilder()
  .unregister("identity")
  .register({
    name: "docs-expert",
    priority: 100,
    render: () => "You are a documentation expert.",
  })
  .register({
    name: "documentation-style",
    priority: 85,
    render: () => `# Documentation Style

- Use clear, concise language
- Include code examples
- Explain the "why", not just the "what"
- Keep sections focused`,
  });
```

### Example 3: Environment-Aware Agent

```typescript
const builder = createDefaultPromptBuilder()
  .register({
    name: "environment-notice",
    priority: 110,
    condition: () => process.env.NODE_ENV === "production",
    render: () => `⚠️ **PRODUCTION ENVIRONMENT**

Exercise extreme caution. All changes affect live systems.`,
  })
  .register({
    name: "debug-mode",
    priority: 110,
    condition: () => process.env.DEBUG === "true",
    render: () => `🔧 **DEBUG MODE ENABLED**

Provide detailed explanations of all operations.`,
  });
```

## Troubleshooting

### Component Not Appearing

1. Check the condition function:
   ```typescript
   condition: (ctx) => {
     console.log("Context:", ctx);
     return ctx.tools && ctx.tools.length > 0;
   }
   ```

2. Verify priority isn't being overridden by another component

3. Ensure the render function returns a non-empty string

### Unexpected Component Order

Check component priorities:
```typescript
const names = builder.getComponentNames();
console.log("Components:", names);
```

### Prompt Too Long

Remove unnecessary components or make them more concise:

```typescript
const builder = createDefaultPromptBuilder()
  .unregister("delegation-instructions") // Remove if no subagents
  .unregister("permission-mode")   // Remove if static
  // Keep only essential components
```

## See Also

- [Agent Session](./agent-session.md) - Event-driven agent interactions
- [Skills](./skills.md) - Progressive disclosure system
- [Backends](./backends.md) - File operations and bash execution
- [API Reference](./api-reference.md) - Complete API documentation
