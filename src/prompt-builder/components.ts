/**
 * Default prompt components for common use cases.
 *
 * @packageDocumentation
 */

import { delegationComponent } from "./delegation-component.js";
import type { PromptComponent } from "./index.js";
import { PromptBuilder } from "./index.js";

/**
 * Default identity component providing a basic agent identity.
 *
 * Priority: 100 (highest)
 *
 * @example
 * ```typescript
 * const builder = new PromptBuilder().register(identityComponent);
 * ```
 *
 * @category Prompt Builder
 */
export const identityComponent: PromptComponent = {
  name: "identity",
  priority: 100,
  render: () => "You are a helpful AI assistant.",
};

/**
 * Lists available tools in the system prompt.
 *
 * Only included if tools are available.
 * Priority: 70
 *
 * @example
 * ```typescript
 * const builder = new PromptBuilder().register(toolsComponent);
 * ```
 *
 * @category Prompt Builder
 */
export const toolsComponent: PromptComponent = {
  name: "tools-listing",
  priority: 70,
  condition: (ctx) => ctx.tools !== undefined && ctx.tools.length > 0,
  render: (ctx) => {
    const toolLines = ctx.tools!.map((t) => `- **${t.name}**: ${t.description}`);
    return `# Available Tools\n\nYou have access to the following tools:\n${toolLines.join("\n")}`;
  },
};

/**
 * Lists available skills in the system prompt.
 *
 * Only included if skills are available.
 * Priority: 65
 *
 * @example
 * ```typescript
 * const builder = new PromptBuilder().register(skillsComponent);
 * ```
 *
 * @category Prompt Builder
 */
export const skillsComponent: PromptComponent = {
  name: "skills-listing",
  priority: 65,
  condition: (ctx) => ctx.skills !== undefined && ctx.skills.length > 0,
  render: (ctx) => {
    const skillLines = ctx.skills!.map((s) => `- **${s.name}**: ${s.description}`);
    return `# Available Skills\n\nYou can activate these skills on-demand:\n${skillLines.join("\n")}`;
  },
};

/**
 * Lists agent capabilities based on backend and configuration.
 *
 * Priority: 60
 *
 * @example
 * ```typescript
 * const builder = new PromptBuilder().register(capabilitiesComponent);
 * ```
 *
 * @category Prompt Builder
 */
export const capabilitiesComponent: PromptComponent = {
  name: "capabilities",
  priority: 60,
  render: (ctx) => {
    const capabilities: string[] = [];

    if (ctx.backend?.hasExecuteCapability) {
      capabilities.push("- Execute shell commands (bash)");
    }

    if (ctx.backend?.type === "filesystem") {
      capabilities.push("- Read and write files to the filesystem");
      if (ctx.backend.rootDir) {
        capabilities.push(`- Working directory: ${ctx.backend.rootDir}`);
      }
    } else if (ctx.backend?.type === "state") {
      capabilities.push("- In-memory file operations (sandboxed)");
    }

    if (capabilities.length === 0) {
      return "";
    }

    return `# Capabilities\n\n${capabilities.join("\n")}`;
  },
};

/**
 * Provides context about the current conversation.
 *
 * Only included if thread ID or messages are available.
 * Priority: 50
 *
 * @example
 * ```typescript
 * const builder = new PromptBuilder().register(contextComponent);
 * ```
 *
 * @category Prompt Builder
 */
export const contextComponent: PromptComponent = {
  name: "context",
  priority: 50,
  condition: (ctx) => !!ctx.threadId || !!(ctx.currentMessages && ctx.currentMessages.length > 0),
  render: (ctx) => {
    const parts: string[] = [];

    if (ctx.threadId) {
      parts.push(`- Thread ID: ${ctx.threadId}`);
    }

    if (ctx.currentMessages && ctx.currentMessages.length > 0) {
      parts.push(`- Conversation history: ${ctx.currentMessages.length} message(s)`);
    }

    if (parts.length === 0) {
      return "";
    }

    return `# Context\n\n${parts.join("\n")}`;
  },
};

/**
 * Lists loaded plugins.
 *
 * Only included if plugins are available.
 * Priority: 68
 *
 * @example
 * ```typescript
 * const builder = new PromptBuilder().register(pluginsComponent);
 * ```
 *
 * @category Prompt Builder
 */
export const pluginsComponent: PromptComponent = {
  name: "plugins-listing",
  priority: 68,
  condition: (ctx) => ctx.plugins !== undefined && ctx.plugins.length > 0,
  render: (ctx) => {
    const pluginLines = ctx.plugins!.map((p) => `- **${p.name}**: ${p.description}`);
    return `# Loaded Plugins\n\n${pluginLines.join("\n")}`;
  },
};

/**
 * Provides information about permission mode.
 *
 * Only included if permission mode is set.
 * Priority: 55
 *
 * @example
 * ```typescript
 * const builder = new PromptBuilder().register(permissionModeComponent);
 * ```
 *
 * @category Prompt Builder
 */
export const permissionModeComponent: PromptComponent = {
  name: "permission-mode",
  priority: 55,
  condition: (ctx) => !!ctx.permissionMode,
  render: (ctx) => {
    const mode = ctx.permissionMode!;
    let description = "";

    if (mode === "default") {
      description = "Default permission mode: tools may require approval based on safety rules.";
    } else if (mode === "acceptEdits") {
      description = "File editing tools are auto-approved; other tools may require approval.";
    } else if (mode === "bypassPermissions") {
      description = "All tools are auto-approved without permission checks.";
    } else if (mode === "plan") {
      description = "Plan mode: tool use is planned but not executed.";
    } else {
      description = `Permission mode: ${String(mode)}`;
    }

    return `# Permission Mode\n\n${description}`;
  },
};

/**
 * Creates a prompt builder with sensible defaults.
 *
 * Includes the following components by default:
 * - `identity`: Basic agent identity
 * - `tools-listing`: Available tools
 * - `skills-listing`: Available skills
 * - `plugins-listing`: Loaded plugins
 * - `capabilities`: Backend capabilities
 * - `permission-mode`: Permission mode info
 *
 * You can customize by cloning and modifying:
 *
 * @example
 * ```typescript
 * // Use defaults
 * const agent = createAgent({
 *   model,
 *   // No systemPrompt = uses default builder automatically
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Customize defaults
 * const builder = createDefaultPromptBuilder()
 *   .unregister('identity')
 *   .register({
 *     name: 'custom-identity',
 *     priority: 100,
 *     render: () => 'You are a specialized coding assistant.',
 *   });
 *
 * const agent = createAgent({
 *   model,
 *   promptBuilder: builder,
 * });
 * ```
 *
 * @returns A PromptBuilder with default components registered
 *
 * @category Prompt Builder
 */
export function createDefaultPromptBuilder(): PromptBuilder {
  return new PromptBuilder().registerMany([
    identityComponent,
    delegationComponent,
    toolsComponent,
    skillsComponent,
    pluginsComponent,
    capabilitiesComponent,
    permissionModeComponent,
  ]);
}
