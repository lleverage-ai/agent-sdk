/**
 * Context management for agent execution.
 *
 * @packageDocumentation
 */

import type { AgentContext } from "./types.js";

/**
 * Creates a new context for managing state during agent execution.
 *
 * @internal
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
