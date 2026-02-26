/**
 * Context management for agent execution.
 *
 * @packageDocumentation
 */

import type { AgentContext } from "./types.js";

/**
 * Creates a new context for managing state during agent execution.
 *
 * Contexts provide a type-safe key-value store for sharing data between
 * tools, hooks, and other parts of the agent execution pipeline.
 *
 * @returns A new context instance
 *
 * @example
 * ```typescript
 * import { createContext } from "@lleverage-ai/agent-sdk";
 *
 * const ctx = createContext();
 *
 * // Store user information
 * ctx.set("user", { id: 123, name: "Alice" });
 *
 * // Retrieve with type safety
 * const user = ctx.get<{ id: number; name: string }>("user");
 * console.log(user?.name); // "Alice"
 *
 * // Check if key exists
 * if (ctx.has("user")) {
 *   console.log("User is set");
 * }
 *
 * // Remove a value
 * ctx.delete("user");
 *
 * // Clear all values
 * ctx.clear();
 * ```
 *
 * @example
 * ```typescript
 * // Using context in a tool
 * const myTool = defineTool({
 *   name: "my-tool",
 *   description: "A tool that uses context",
 *   parameters: z.object({ key: z.string() }),
 *   execute: async ({ key }, { agent }) => {
 *     // Tools can access shared context via agent options or custom setup
 *     return `Processing ${key}`;
 *   },
 * });
 * ```
 *
 * @category Context
 */
export function createContext(): AgentContext {
  const data = new Map<string, unknown>();

  return {
    data,

    get<T>(key: string): T | undefined {
      return data.get(key) as T | undefined;
    },

    set<T>(key: string, value: T): void {
      data.set(key, value);
    },

    has(key: string): boolean {
      return data.has(key);
    },

    delete(key: string): boolean {
      return data.delete(key);
    },

    clear(): void {
      data.clear();
    },
  };
}
