/**
 * Prompt builder system for creating dynamic, context-aware system prompts.
 *
 * @packageDocumentation
 */

import type { ModelMessage } from "ai";
import type { AgentState } from "../backends/state.js";
import type { PermissionMode } from "../types.js";

/**
 * Context available to prompt components when building prompts.
 * Contains all relevant agent state and configuration.
 *
 * @category Prompt Builder
 */
export interface PromptContext {
  /**
   * Tools available to the agent.
   * Each entry includes the tool name and description.
   */
  tools?: Array<{ name: string; description: string }>;

  /**
   * Skills available to the agent.
   * Each entry includes the skill name and description.
   */
  skills?: Array<{ name: string; description: string }>;

  /**
   * Plugins loaded by the agent.
   * Each entry includes the plugin name and description.
   */
  plugins?: Array<{ name: string; description: string }>;

  /**
   * Information about the backend being used.
   */
  backend?: {
    /** Type of backend (e.g., 'filesystem', 'state') */
    type: string;
    /** Whether the backend supports command execution */
    hasExecuteCapability: boolean;
    /** Root directory for filesystem backends */
    rootDir?: string;
  };

  /**
   * Agent state for accessing todos and other state.
   */
  state?: AgentState;

  /**
   * Model identifier being used.
   */
  model?: string;

  /**
   * Maximum number of tool call steps allowed.
   */
  maxSteps?: number;

  /**
   * Permission mode for the agent.
   */
  permissionMode?: PermissionMode;

  /**
   * Current conversation messages (available during generation).
   */
  currentMessages?: ModelMessage[];

  /**
   * Thread ID for the current conversation (if any).
   */
  threadId?: string;

  /**
   * Custom user-defined data that can be passed to components.
   */
  custom?: Record<string, unknown>;
}

/**
 * A component that contributes to the system prompt.
 *
 * Components are sorted by priority (higher = rendered earlier in prompt)
 * and can conditionally include themselves based on context.
 *
 * @example
 * ```typescript
 * const toolsComponent: PromptComponent = {
 *   name: 'tools-listing',
 *   priority: 70,
 *   condition: (ctx) => ctx.tools !== undefined && ctx.tools.length > 0,
 *   render: (ctx) => {
 *     const toolLines = ctx.tools!.map((t) => `- **${t.name}**: ${t.description}`);
 *     return `# Available Tools\n\n${toolLines.join('\n')}`;
 *   },
 * };
 * ```
 *
 * @category Prompt Builder
 */
export interface PromptComponent {
  /**
   * Unique identifier for this component.
   * Used for unregistering components.
   */
  name: string;

  /**
   * Priority for ordering components in the final prompt.
   * Higher priority components are rendered first.
   * @defaultValue 50
   */
  priority?: number;

  /**
   * Optional condition to determine if this component should be included.
   * If not provided or returns true, the component is included.
   * @param ctx - The prompt context
   * @returns true to include this component, false to skip it
   */
  condition?: (ctx: PromptContext) => boolean;

  /**
   * Render the component's contribution to the prompt.
   * @param ctx - The prompt context
   * @returns The text to include in the system prompt
   */
  render: (ctx: PromptContext) => string;
}

/**
 * Builder for constructing dynamic system prompts from components.
 *
 * The PromptBuilder manages a collection of components that are combined
 * to create the final system prompt. Components are sorted by priority
 * and can conditionally include themselves.
 *
 * @example
 * ```typescript
 * const builder = new PromptBuilder()
 *   .register({
 *     name: 'identity',
 *     priority: 100,
 *     render: () => 'You are a helpful assistant.',
 *   })
 *   .register({
 *     name: 'tools',
 *     priority: 70,
 *     condition: (ctx) => ctx.tools && ctx.tools.length > 0,
 *     render: (ctx) => `Tools: ${ctx.tools!.map(t => t.name).join(', ')}`,
 *   });
 *
 * const prompt = builder.build({ tools: [{ name: 'read', description: 'Read files' }] });
 * ```
 *
 * @category Prompt Builder
 */
export class PromptBuilder {
  private components: PromptComponent[] = [];

  /**
   * Register a single component.
   *
   * If a component with the same name already exists, it will be replaced.
   *
   * @param component - The component to register
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.register({
   *   name: 'custom',
   *   priority: 80,
   *   render: () => 'Custom instructions',
   * });
   * ```
   */
  register(component: PromptComponent): this {
    // Remove existing component with same name
    this.components = this.components.filter((c) => c.name !== component.name);
    // Add new component
    this.components.push(component);
    return this;
  }

  /**
   * Register multiple components at once.
   *
   * @param components - Array of components to register
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.registerMany([
   *   identityComponent,
   *   toolsComponent,
   *   skillsComponent,
   * ]);
   * ```
   */
  registerMany(components: PromptComponent[]): this {
    for (const component of components) {
      this.register(component);
    }
    return this;
  }

  /**
   * Remove a component by name.
   *
   * @param name - The name of the component to remove
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * builder.unregister('identity');
   * ```
   */
  unregister(name: string): this {
    this.components = this.components.filter((c) => c.name !== name);
    return this;
  }

  /**
   * Build the final prompt from the registered components.
   *
   * Components are:
   * 1. Filtered by their condition functions (if present)
   * 2. Sorted by priority (higher priority first)
   * 3. Rendered and joined with double newlines
   *
   * @param context - The context to pass to components
   * @returns The final system prompt string
   *
   * @example
   * ```typescript
   * const context: PromptContext = {
   *   tools: [{ name: 'read', description: 'Read files' }],
   *   model: 'claude-3-5-sonnet-20241022',
   * };
   * const prompt = builder.build(context);
   * ```
   */
  build(context: PromptContext): string {
    // Filter components by condition
    const activeComponents = this.components.filter((component) => {
      if (component.condition) {
        return component.condition(context);
      }
      return true;
    });

    // Sort by priority (higher first)
    activeComponents.sort((a, b) => {
      const aPriority = a.priority ?? 50;
      const bPriority = b.priority ?? 50;
      return bPriority - aPriority;
    });

    // Render and join
    const parts = activeComponents.map((component) => component.render(context));

    // Filter out empty strings and join with double newlines
    return parts.filter((part) => part.trim().length > 0).join("\n\n");
  }

  /**
   * Clone this builder with all its registered components.
   *
   * Useful for creating variants of a base builder.
   *
   * @returns A new PromptBuilder with the same components
   *
   * @example
   * ```typescript
   * const base = createDefaultPromptBuilder();
   * const custom = base.clone().register({
   *   name: 'custom',
   *   render: () => 'Additional instructions',
   * });
   * ```
   */
  clone(): PromptBuilder {
    const cloned = new PromptBuilder();
    cloned.components = [...this.components];
    return cloned;
  }

  /**
   * Get all registered component names.
   * Useful for debugging and introspection.
   *
   * @returns Array of component names
   */
  getComponentNames(): string[] {
    return this.components.map((c) => c.name);
  }
}
