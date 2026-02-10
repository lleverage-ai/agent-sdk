/**
 * Production Agent Preset.
 *
 * Provides a convenience function for creating production-ready agents
 * with security, observability, and recommended hooks in a single call.
 *
 * @packageDocumentation
 */

import type { LanguageModel } from "ai";
import { createAgent } from "../agent.js";
import { createGuardrailsHooks, createSecretsFilterHooks } from "../hooks/index.js";
import {
  createObservabilityPreset,
  type ObservabilityPreset,
  type ObservabilityPresetOptions,
} from "../observability/preset.js";
import {
  applySecurityPolicy,
  type SecurityPolicy,
  type SecurityPolicyPreset,
} from "../security/index.js";
import type { Agent, AgentOptions, HookRegistration } from "../types.js";

/**
 * Type-safe helper to merge hook registrations.
 * Handles both HookMatcher[] (tool hooks) and HookCallback[] (other hooks).
 */
function mergeHooks(target: HookRegistration, source: Partial<HookRegistration>): void {
  const hookEvents: (keyof HookRegistration)[] = [
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PreGenerate",
    "PostGenerate",
    "PostGenerateFailure",
    "SessionStart",
    "SessionEnd",
    "SubagentStart",
    "SubagentStop",
  ];

  // Cast to Record for dynamic key assignment — all HookRegistration values are arrays
  const t = target as Record<string, unknown[]>;
  const s = source as Record<string, unknown[] | undefined>;

  for (const event of hookEvents) {
    const sourceCallbacks = s[event];
    if (sourceCallbacks) {
      if (!t[event]) {
        t[event] = sourceCallbacks;
      } else {
        t[event] = [...t[event], ...sourceCallbacks];
      }
    }
  }
}

/**
 * Options for creating a production agent.
 *
 * @category Presets
 */
export interface ProductionAgentOptions {
  /**
   * The language model to use for generation.
   */
  model: LanguageModel;

  /**
   * Security policy preset to apply.
   * @defaultValue "production"
   */
  securityPreset?: SecurityPolicyPreset;

  /**
   * Optional security policy overrides.
   */
  securityOverrides?: Partial<SecurityPolicy>;

  /**
   * Whether to enable observability (logging, metrics, tracing).
   * @defaultValue true
   */
  enableObservability?: boolean;

  /**
   * Observability configuration options.
   */
  observabilityOptions?: ObservabilityPresetOptions;

  /**
   * Whether to enable secrets filtering to prevent credential leakage.
   * @defaultValue true
   */
  enableSecretsFilter?: boolean;

  /**
   * Whether to enable guardrails for content filtering.
   * @defaultValue false
   */
  enableGuardrails?: boolean;

  /**
   * Blocked input patterns for guardrails (regex patterns).
   */
  blockedInputPatterns?: RegExp[];

  /**
   * Blocked output patterns for guardrails (regex patterns).
   */
  blockedOutputPatterns?: RegExp[];

  /**
   * Additional agent options to merge with preset defaults.
   * This can be used to add custom plugins, tools, checkpointers, etc.
   */
  additionalOptions?: Partial<AgentOptions>;
}

/**
 * Result of creating a production agent.
 *
 * @category Presets
 */
export interface ProductionAgentResult {
  /**
   * The created agent instance.
   */
  agent: Agent;

  /**
   * The observability preset (if enabled).
   */
  observability?: ObservabilityPreset;
}

/**
 * Creates a production-ready agent with security, observability, and recommended hooks.
 *
 * This function provides a convenient way to create an agent configured for production
 * deployment in a single call. It combines:
 * - Security policy presets (sandbox, permissions, tool restrictions)
 * - Observability (logging, metrics, tracing)
 * - Secrets filtering to prevent credential leakage
 * - Optional guardrails for content filtering
 *
 * @param options - Configuration options
 * @returns Production agent and observability preset
 *
 * @example
 * ```typescript
 * import { createProductionAgent } from "@lleverage-ai/agent-sdk";
 * import { anthropic } from "@ai-sdk/anthropic";
 *
 * // One-line production agent setup
 * const { agent, observability } = createProductionAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 * });
 *
 * // Access observability primitives
 * observability.logger?.info("Agent started");
 * observability.metrics?.requests.inc();
 * ```
 *
 * @example
 * ```typescript
 * // Customize security and observability
 * const { agent } = createProductionAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   securityPreset: "readonly", // Maximum restrictions
 *   enableGuardrails: true, // Enable content filtering
 *   blockedInputPatterns: [/ignore.*instructions/i],
 *   observabilityOptions: {
 *     name: "my-production-agent",
 *     loggerOptions: { level: "warn" },
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Add custom plugins and checkpointers
 * const { agent, observability } = createProductionAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   additionalOptions: {
 *     plugins: [myCustomPlugin],
 *     checkpointer: createMemorySaver(),
 *     systemPrompt: "You are a helpful assistant.",
 *   },
 * });
 * ```
 *
 * @category Presets
 */
export function createProductionAgent(options: ProductionAgentOptions): ProductionAgentResult {
  const {
    model,
    securityPreset = "production",
    securityOverrides,
    enableObservability = true,
    observabilityOptions,
    enableSecretsFilter = true,
    enableGuardrails = false,
    blockedInputPatterns,
    blockedOutputPatterns,
    additionalOptions,
  } = options;

  // Apply security policy
  const securityConfig = applySecurityPolicy(securityPreset, securityOverrides);

  // Create observability preset
  let observability: ObservabilityPreset | undefined;
  if (enableObservability) {
    observability = createObservabilityPreset({
      name: observabilityOptions?.name ?? "production-agent",
      ...observabilityOptions,
    });
  }

  // Collect hooks from various sources in HookRegistration format
  const hooksRegistration: HookRegistration = {};

  // Add observability hooks
  if (observability?.hooks) {
    mergeHooks(hooksRegistration, observability.hooks);
  }

  // Add security hooks from policy (already in HookRegistration format)
  if (securityConfig.hooks) {
    mergeHooks(hooksRegistration, securityConfig.hooks);
  }

  // Add secrets filter hooks (PreGenerate and PostGenerate)
  if (enableSecretsFilter) {
    const [preGenHook, postGenHook] = createSecretsFilterHooks();
    if (!hooksRegistration.PreGenerate) {
      hooksRegistration.PreGenerate = [];
    }
    if (!hooksRegistration.PostGenerate) {
      hooksRegistration.PostGenerate = [];
    }
    hooksRegistration.PreGenerate.push(preGenHook);
    hooksRegistration.PostGenerate.push(postGenHook);
  }

  // Add guardrails hooks (PreGenerate and PostGenerate)
  if (enableGuardrails) {
    const [preGenHook, postGenHook] = createGuardrailsHooks({
      blockedInputPatterns,
      blockedOutputPatterns,
    });
    if (!hooksRegistration.PreGenerate) {
      hooksRegistration.PreGenerate = [];
    }
    if (!hooksRegistration.PostGenerate) {
      hooksRegistration.PostGenerate = [];
    }
    hooksRegistration.PreGenerate.push(preGenHook);
    hooksRegistration.PostGenerate.push(postGenHook);
  }

  // Check if we have any hooks
  const hasHooks = Object.keys(hooksRegistration).length > 0;

  // Create agent with combined configuration
  const agent = createAgent({
    model,
    ...securityConfig,
    hooks: hasHooks ? hooksRegistration : undefined,
    ...additionalOptions,
  });

  return {
    agent,
    observability,
  };
}

/**
 * Default blocked input patterns for secure production mode.
 *
 * These patterns help prevent common prompt injection and jailbreak attempts.
 *
 * @category Presets
 */
export const DEFAULT_BLOCKED_INPUT_PATTERNS: RegExp[] = [
  // Common jailbreak/injection phrases
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /forget\s+(everything|all|your)\s+(you\s+)?(know|learned|training)/i,
  /you\s+are\s+now\s+in\s+(developer|debug|admin|test)\s+mode/i,
  /pretend\s+(you\s+are|to\s+be)\s+(?!a\s+helpful)/i,
  /act\s+as\s+if\s+you\s+(have\s+no|don't\s+have|lack)/i,
  /bypass\s+(your|all|the)\s+(safety|security|content|filter)/i,
  /override\s+(your|all|the)\s+(safety|security|restriction)/i,
];

/**
 * Default blocked output patterns for secure production mode.
 *
 * These patterns help prevent accidental credential/PII leakage.
 *
 * @category Presets
 */
export const DEFAULT_BLOCKED_OUTPUT_PATTERNS: RegExp[] = [
  // Credit card numbers (basic pattern)
  /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/,
  // SSN patterns
  /\b\d{3}-\d{2}-\d{4}\b/,
  // IP addresses that look internal
  /\b(?:192\.168|10\.|172\.(?:1[6-9]|2[0-9]|3[01]))\.\d{1,3}\.\d{1,3}\b/,
];

/**
 * Options for creating a secure production agent.
 *
 * This extends ProductionAgentOptions with secure-by-default values.
 *
 * @category Presets
 */
export interface SecureProductionAgentOptions
  extends Omit<ProductionAgentOptions, "enableGuardrails"> {
  /**
   * Whether to enable guardrails for content filtering.
   * Unlike ProductionAgentOptions, this defaults to true.
   * @defaultValue true
   */
  enableGuardrails?: boolean;

  /**
   * Whether to use the default blocked input patterns.
   * Set to false to only use custom patterns.
   * @defaultValue true
   */
  useDefaultInputPatterns?: boolean;

  /**
   * Whether to use the default blocked output patterns.
   * Set to false to only use custom patterns.
   * @defaultValue true
   */
  useDefaultOutputPatterns?: boolean;
}

/**
 * Creates a secure production-ready agent with all security features enabled by default.
 *
 * This is the **recommended entry point** for production deployments. It provides:
 * - Production security policy (blocks dangerous commands, limits file operations)
 * - **Guardrails enabled by default** (content filtering for inputs and outputs)
 * - Secrets filtering to prevent credential leakage
 * - Full observability (logging, metrics, tracing)
 *
 * Use this instead of `createProductionAgent()` unless you have specific reasons
 * to disable guardrails or want more permissive defaults.
 *
 * @param options - Configuration options
 * @returns Secure production agent and observability preset
 *
 * @example
 * ```typescript
 * import { createSecureProductionAgent } from "@lleverage-ai/agent-sdk";
 * import { anthropic } from "@ai-sdk/anthropic";
 *
 * // Recommended production setup - all security features enabled
 * const { agent, observability } = createSecureProductionAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 * });
 *
 * // Use the agent
 * const result = await agent.generate({
 *   prompt: "Help me with a task",
 * });
 *
 * // Access observability
 * observability.logger?.info("Request completed");
 * observability.metrics?.requests.inc();
 * ```
 *
 * @example
 * ```typescript
 * // Customize with additional blocked patterns
 * const { agent } = createSecureProductionAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   blockedInputPatterns: [
 *     /confidential/i,  // Additional custom pattern
 *   ],
 *   blockedOutputPatterns: [
 *     /internal-only/i,
 *   ],
 *   observabilityOptions: {
 *     name: "my-secure-agent",
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Disable default patterns, use only custom ones
 * const { agent } = createSecureProductionAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   useDefaultInputPatterns: false,
 *   useDefaultOutputPatterns: false,
 *   blockedInputPatterns: [/my-custom-pattern/],
 *   blockedOutputPatterns: [/another-pattern/],
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Add custom plugins and system prompt
 * const { agent, observability } = createSecureProductionAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   additionalOptions: {
 *     plugins: [myCustomPlugin],
 *     systemPrompt: "You are a helpful assistant.",
 *     checkpointer: createMemorySaver(),
 *   },
 * });
 * ```
 *
 * @category Presets
 */
export function createSecureProductionAgent(
  options: SecureProductionAgentOptions,
): ProductionAgentResult {
  const {
    useDefaultInputPatterns = true,
    useDefaultOutputPatterns = true,
    blockedInputPatterns = [],
    blockedOutputPatterns = [],
    enableGuardrails = true,
    ...restOptions
  } = options;

  // Combine default and custom patterns
  const combinedInputPatterns = useDefaultInputPatterns
    ? [...DEFAULT_BLOCKED_INPUT_PATTERNS, ...blockedInputPatterns]
    : blockedInputPatterns;

  const combinedOutputPatterns = useDefaultOutputPatterns
    ? [...DEFAULT_BLOCKED_OUTPUT_PATTERNS, ...blockedOutputPatterns]
    : blockedOutputPatterns;

  // Call createProductionAgent with secure defaults
  return createProductionAgent({
    ...restOptions,
    enableGuardrails,
    blockedInputPatterns: combinedInputPatterns,
    blockedOutputPatterns: combinedOutputPatterns,
  });
}
