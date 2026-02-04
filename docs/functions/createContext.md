[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createContext

# Function: createContext()

> **createContext**(): [`AgentContext`](../interfaces/AgentContext.md)

Defined in: [packages/agent-sdk/src/context.ts:58](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context.ts#L58)

Creates a new context for managing state during agent execution.

Contexts provide a type-safe key-value store for sharing data between
tools, hooks, and other parts of the agent execution pipeline.

## Returns

[`AgentContext`](../interfaces/AgentContext.md)

A new context instance

## Examples

```typescript
import { createContext } from "@lleverage-ai/agent-sdk";

const ctx = createContext();

// Store user information
ctx.set("user", { id: 123, name: "Alice" });

// Retrieve with type safety
const user = ctx.get<{ id: number; name: string }>("user");
console.log(user?.name); // "Alice"

// Check if key exists
if (ctx.has("user")) {
  console.log("User is set");
}

// Remove a value
ctx.delete("user");

// Clear all values
ctx.clear();
```

```typescript
// Using context in a tool
const myTool = defineTool({
  name: "my-tool",
  description: "A tool that uses context",
  parameters: z.object({ key: z.string() }),
  execute: async ({ key }, { agent }) => {
    // Tools can access shared context via agent options or custom setup
    return `Processing ${key}`;
  },
});
```
