/**
 * Prompt builder system for creating dynamic, context-aware system prompts.
 *
 * @packageDocumentation
 */

import type { ModelMessage } from "ai";
import type { AgentState } from "../backends/state.js";
import type { PermissionMode } from "../types.js";

/**
 * A labeled instruction layer with explicit precedence.
 *
 * Higher `precedence` values win when instructions conflict. Layers with the
 * same precedence preserve their original array order.
 *
 * @category Types
 */
export interface PromptInstructionLayer {
  /**
   * Human-readable label for the instruction layer.
   */
  label: string;

  /**
   * Instructions contained in this layer.
   */
  instructions: string;

  /**
   * Relative precedence for conflict resolution.
   * Higher values indicate higher-priority instructions.
   * @defaultValue 50
   */
  precedence?: number;

  /**
   * Optional source identifier for debugging or custom rendering.
   */
  source?: string;
}

/**
 * A single structured memory item used for standing instructions or recall.
 *
 * @category Types
 */
export interface PromptMemoryEntry {
  /**
   * Human-readable label for the memory item.
   */
  label: string;

  /**
   * The memory content to inject into the prompt.
   */
  content: string;

  /**
   * Optional source identifier for debugging or attribution.
   */
  source?: string;
}

/**
 * Structured memory inputs for prompt composition.
 *
 * `standingInstructions` are durable guidance that should behave like a lower-
 * precedence instruction layer. `recall` is volatile, task-relevant context
 * that should be rendered separately from standing policy.
 *
 * @category Context
 */
export interface PromptMemoryContext {
  /**
   * Durable instructions recalled from memory.
   */
  standingInstructions?: PromptMemoryEntry[];

  /**
   * Compact task-relevant recall that should not be treated as standing policy.
   */
  recall?: PromptMemoryEntry[];
}

/**
 * Metadata about a skill that has already been activated.
 *
 * @category Types
 */
export interface PromptLoadedSkill {
  /**
   * Skill name.
   */
  name: string;

  /**
   * Short summary or description of the loaded skill.
   */
  summary?: string;

  /**
   * Resolved instructions from the loaded skill, if any.
   */
  instructions?: string;
}

/**
 * Context available to prompt components when building prompts.
 * Contains all relevant agent state and configuration.
 *
 * @category Context
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
   * Explicit instruction layers with stable precedence semantics.
   *
   * Higher `precedence` values win when instructions conflict. Layers with the
   * same precedence preserve the caller-provided array order.
   */
  instructionLayers?: PromptInstructionLayer[];

  /**
   * Structured memory inputs for standing instructions and compact recall.
   */
  memory?: PromptMemoryContext;

  /**
   * Skills that have already been activated and whose instructions are in play.
   */
  loadedSkills?: PromptLoadedSkill[];

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
   * Whether the current agent/host has persistent memory support available.
   *
   * Defaults to true when omitted so general memory guidance remains available
   * for existing custom builders unless they explicitly disable it.
   */
  memoryAvailable?: boolean;

  /**
   * Custom user-defined data that can be passed to components.
   */
  custom?: Record<string, unknown>;
}

/**
 * Stability classification for a prompt component.
 *
 * Static components should render the same text across turns for the same
 * agent configuration. Dynamic components may change with messages, memory,
 * tools, permissions, or other runtime context.
 *
 * @category Types
 */
export type PromptComponentStability = "static" | "dynamic";

/**
 * Token-budget metadata for a prompt component.
 *
 * This is advisory metadata for diagnostics and host policy. The builder does
 * not trim component output automatically.
 *
 * @category Types
 */
export interface PromptComponentBudget {
  /**
   * Optional maximum token budget expected for this component.
   */
  maxTokens?: number;

  /**
   * Whether this component may be omitted by host policy when prompt budget is tight.
   * @defaultValue false
   */
  optional?: boolean;
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
 * @category Types
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
   * Whether this component is expected to be stable across turns.
   *
   * `static` sections are good prompt-cache anchors. `dynamic` sections are
   * expected to vary with runtime context and can explain cache-prefix churn in
   * diagnostics.
   *
   * @defaultValue "dynamic"
   */
  stability?: PromptComponentStability;

  /**
   * Optional advisory budget metadata for this component.
   */
  budget?: PromptComponentBudget;

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
 * Diagnostic information for a rendered prompt component.
 *
 * @category Context
 */
export interface PromptSectionDiagnostics {
  /**
   * Component name.
   */
  name: string;

  /**
   * Effective component priority used for ordering.
   */
  priority: number;

  /**
   * Stability classification for this rendered section.
   */
  stability: PromptComponentStability;

  /**
   * Optional advisory budget metadata from the component.
   */
  budget?: PromptComponentBudget;

  /**
   * Stable fingerprint of the rendered section text.
   */
  fingerprint: string;

  /**
   * Rendered section length in UTF-16 code units.
   */
  charCount: number;
}

/**
 * Result returned by {@link PromptBuilder.buildWithDiagnostics}.
 *
 * @category Context
 */
export interface PromptBuildResult {
  /**
   * Final prompt string.
   */
  prompt: string;

  /**
   * Stable fingerprint of the final prompt string.
   */
  fingerprint: string;

  /**
   * Diagnostics for rendered, non-empty prompt sections.
   */
  sections: PromptSectionDiagnostics[];
}

function fingerprintText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
 * @category Context
 */
export class PromptBuilder {
  private components: PromptComponent[] = [];

  private getActiveComponents(context: PromptContext): PromptComponent[] {
    const activeComponents = this.components.filter((component) => {
      if (component.condition) {
        return component.condition(context);
      }
      return true;
    });

    activeComponents.sort((a, b) => {
      const aPriority = a.priority ?? 50;
      const bPriority = b.priority ?? 50;
      return bPriority - aPriority;
    });

    return activeComponents;
  }

  private renderSections(context: PromptContext): Array<{ component: PromptComponent; text: string }> {
    return this.getActiveComponents(context)
      .map((component) => {
        const text = component.render(context);
        return { component, text };
      })
      .filter(({ text }) => text.trim().length > 0);
  }

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
    return this.renderSections(context)
      .map(({ text }) => text)
      .join("\n\n");
  }

  /**
   * Build the final prompt and return rendered section diagnostics.
   *
   * Diagnostics include component stability, advisory budget metadata, and
   * content fingerprints suitable for prompt-cache debugging.
   *
   * @param context - The context to pass to components
   * @returns The final prompt and per-section diagnostics
   * @throws {Error} When a component condition or render callback throws
   *
   * @example
   * ```typescript
   * const context: PromptContext = {
   *   tools: [{ name: "read", description: "Read files" }],
   * };
   * const result: PromptBuildResult = builder.buildWithDiagnostics(context);
   * console.log(result.fingerprint, result.sections);
   * ```
   */
  buildWithDiagnostics(context: PromptContext): PromptBuildResult {
    const renderedSections = this.renderSections(context);

    // Filter out empty strings and join with double newlines
    const prompt = renderedSections.map(({ text }) => text).join("\n\n");

    return {
      prompt,
      fingerprint: fingerprintText(prompt),
      sections: renderedSections.map(({ component, text }) => ({
        name: component.name,
        priority: component.priority ?? 50,
        stability: component.stability ?? "dynamic",
        ...(component.budget !== undefined ? { budget: component.budget } : {}),
        fingerprint: fingerprintText(text),
        charCount: text.length,
      })),
    };
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
