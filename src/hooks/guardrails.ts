/**
 * Guardrails hook utilities.
 *
 * Provides content filtering and safety hooks using the unified hook system.
 *
 * @packageDocumentation
 */

import type { HookCallback, PostGenerateInput, PreGenerateInput } from "../types.js";

/**
 * Options for creating guardrails hooks.
 *
 * @category Hooks
 */
export interface GuardrailsHooksOptions {
  /**
   * Regex patterns to block in input (user messages).
   * If matched, generation is denied.
   */
  blockedInputPatterns?: RegExp[];

  /**
   * Regex patterns to filter in output (model responses).
   * If matched, output is replaced with filterMessage.
   */
  blockedOutputPatterns?: RegExp[];

  /**
   * Message to show when input is blocked.
   * @defaultValue "Request blocked by content policy"
   */
  blockedInputMessage?: string;

  /**
   * Message to replace filtered output with.
   * @defaultValue "[Content filtered]"
   */
  filteredOutputMessage?: string;

  /**
   * Custom input validation function.
   * Throw error to block, or return options to allow/transform.
   */
  checkInput?: (input: PreGenerateInput) => PreGenerateInput | undefined;

  /**
   * Custom output validation function.
   * Return modified result to filter/transform output.
   */
  checkOutput?: (input: PostGenerateInput) => PostGenerateInput["result"] | undefined;
}

/**
 * Extracts text content from a single message.
 */
function extractTextFromMessage(msg: unknown): string {
  if (typeof msg !== "object" || msg === null) {
    return "";
  }

  const content = (msg as { content?: unknown }).content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        texts.push(part.text);
      }
    }
    return texts.join("\n");
  }

  return "";
}

/**
 * Extracts text content from all messages for pattern matching.
 */
function extractTextFromMessages(messages: unknown[] = []): string {
  const texts: string[] = [];

  for (const msg of messages) {
    const text = extractTextFromMessage(msg);
    if (text) {
      texts.push(text);
    }
  }

  return texts.join("\n");
}

/**
 * Finds message IDs that match any of the given patterns.
 * Returns IDs of messages containing blocked content.
 */
function findBlockedMessageIds(messages: unknown[], patterns: RegExp[]): string[] {
  const blockedIds: string[] = [];

  for (const msg of messages) {
    const typedMsg = msg as { id?: string; role?: string };
    if (!typedMsg.id) continue;

    const text = extractTextFromMessage(msg);
    if (!text) continue;

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        blockedIds.push(typedMsg.id);
        break; // Only add each message once
      }
    }
  }

  return blockedIds;
}

/**
 * Creates guardrails hooks for input and output content filtering.
 *
 * The PreGenerate hook blocks requests matching input patterns.
 * The PostGenerate hook filters output matching output patterns.
 *
 * This replaces guardrails middleware with hook-based filtering that
 * works correctly with the unified hook system.
 *
 * @param options - Configuration options
 * @returns Array of two hooks: [PreGenerate input filter, PostGenerate output filter]
 *
 * @example
 * ```typescript
 * const [inputFilter, outputFilter] = createGuardrailsHooks({
 *   blockedInputPatterns: [
 *     /password/i,
 *     /api.?key/i,
 *     /secret/i,
 *   ],
 *   blockedOutputPatterns: [
 *     /\b\d{16}\b/,  // Credit card numbers
 *     /\b\d{3}-\d{2}-\d{4}\b/,  // SSN
 *   ],
 * });
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PreGenerate: [{ hooks: [inputFilter] }],
 *     PostGenerate: [{ hooks: [outputFilter] }],
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Custom validation with transformation
 * const hooks = createGuardrailsHooks({
 *   checkInput: (input) => {
 *     // Allow but transform: remove PII from messages
 *     const cleaned = cleanPII(input.options.messages);
 *     return {
 *       ...input,
 *       options: { ...input.options, messages: cleaned },
 *     };
 *   },
 *   checkOutput: (input) => {
 *     // Filter harmful content
 *     if (isHarmful(input.result.text)) {
 *       return { ...input.result, text: "[Content filtered for safety]" };
 *     }
 *   },
 * });
 * ```
 *
 * @category Hooks
 */
export function createGuardrailsHooks(
  options: GuardrailsHooksOptions = {},
): [HookCallback, HookCallback] {
  const {
    blockedInputPatterns = [],
    blockedOutputPatterns = [],
    blockedInputMessage = "Request blocked by content policy",
    filteredOutputMessage = "[Content filtered]",
    checkInput,
    checkOutput,
  } = options;

  // PreGenerate: Block inputs matching patterns
  const inputFilter: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreGenerate") return {};

    const preGenInput = input as PreGenerateInput;

    // Custom input validation
    if (checkInput) {
      const result = checkInput(preGenInput);
      if (result && result !== preGenInput) {
        // Transform input
        return {
          hookSpecificOutput: {
            hookEventName: "PreGenerate",
            updatedInput: result.options,
          },
        };
      }
    }

    // Pattern-based blocking
    if (blockedInputPatterns.length > 0) {
      const messages = preGenInput.options.messages as unknown[];
      const text = extractTextFromMessages(messages);

      for (const pattern of blockedInputPatterns) {
        if (pattern.test(text)) {
          // Find which messages contain blocked content
          const blockedMessageIds = findBlockedMessageIds(messages, [pattern]);

          return {
            hookSpecificOutput: {
              hookEventName: "PreGenerate",
              permissionDecision: "deny",
              permissionDecisionReason: blockedInputMessage,
              blockedMessageIds,
            },
          };
        }
      }
    }

    return {};
  };

  // PostGenerate: Filter outputs matching patterns
  const outputFilter: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostGenerate") return {};

    const postGenInput = input as PostGenerateInput;

    // Custom output validation
    if (checkOutput) {
      const result = checkOutput(postGenInput);
      if (result && result !== postGenInput.result) {
        // Transform output
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerate",
            updatedResult: result,
          },
        };
      }
    }

    // Pattern-based filtering
    if (blockedOutputPatterns.length > 0) {
      const text = postGenInput.result.text || "";

      for (const pattern of blockedOutputPatterns) {
        if (pattern.test(text)) {
          // Replace output text with filter message
          return {
            hookSpecificOutput: {
              hookEventName: "PostGenerate",
              updatedResult: {
                ...postGenInput.result,
                text: filteredOutputMessage,
              },
            },
          };
        }
      }
    }

    return {};
  };

  return [inputFilter, outputFilter];
}

/**
 * Creates guardrails hooks with statistics tracking.
 *
 * Returns hooks along with functions to get filtering statistics.
 *
 * @param options - Configuration options
 * @returns Object with hooks and statistics getter
 *
 * @example
 * ```typescript
 * const { hooks, getStats } = createManagedGuardrailsHooks({
 *   blockedInputPatterns: [/password/i, /secret/i],
 *   blockedOutputPatterns: [/\b\d{16}\b/],
 * });
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PreGenerate: [{ hooks: [hooks[0]] }],
 *     PostGenerate: [{ hooks: [hooks[1]] }],
 *   },
 * });
 *
 * // Check statistics
 * const stats = getStats();
 * console.log(`Blocked inputs: ${stats.blockedInputs}`);
 * console.log(`Filtered outputs: ${stats.filteredOutputs}`);
 * ```
 *
 * @category Hooks
 */
export function createManagedGuardrailsHooks(options: GuardrailsHooksOptions = {}): {
  hooks: [HookCallback, HookCallback];
  getStats: () => {
    blockedInputs: number;
    filteredOutputs: number;
    totalInputs: number;
    totalOutputs: number;
  };
} {
  const {
    blockedInputPatterns = [],
    blockedOutputPatterns = [],
    blockedInputMessage = "Request blocked by content policy",
    filteredOutputMessage = "[Content filtered]",
    checkInput,
    checkOutput,
  } = options;

  let blockedInputs = 0;
  let filteredOutputs = 0;
  let totalInputs = 0;
  let totalOutputs = 0;

  const inputFilter: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreGenerate") return {};

    const preGenInput = input as PreGenerateInput;
    totalInputs++;

    if (checkInput) {
      const result = checkInput(preGenInput);
      if (result && result !== preGenInput) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreGenerate",
            updatedInput: result.options,
          },
        };
      }
    }

    if (blockedInputPatterns.length > 0) {
      const messages = preGenInput.options.messages as unknown[];
      const text = extractTextFromMessages(messages);

      for (const pattern of blockedInputPatterns) {
        if (pattern.test(text)) {
          blockedInputs++;
          // Find which messages contain blocked content
          const blockedMessageIds = findBlockedMessageIds(messages, [pattern]);

          return {
            hookSpecificOutput: {
              hookEventName: "PreGenerate",
              permissionDecision: "deny",
              permissionDecisionReason: blockedInputMessage,
              blockedMessageIds,
            },
          };
        }
      }
    }

    return {};
  };

  const outputFilter: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostGenerate") return {};

    const postGenInput = input as PostGenerateInput;
    totalOutputs++;

    if (checkOutput) {
      const result = checkOutput(postGenInput);
      if (result && result !== postGenInput.result) {
        return {
          hookSpecificOutput: {
            hookEventName: "PostGenerate",
            updatedResult: result,
          },
        };
      }
    }

    if (blockedOutputPatterns.length > 0) {
      const text = postGenInput.result.text || "";

      for (const pattern of blockedOutputPatterns) {
        if (pattern.test(text)) {
          filteredOutputs++;
          return {
            hookSpecificOutput: {
              hookEventName: "PostGenerate",
              updatedResult: {
                ...postGenInput.result,
                text: filteredOutputMessage,
              },
            },
          };
        }
      }
    }

    return {};
  };

  return {
    hooks: [inputFilter, outputFilter],
    getStats: () => ({
      blockedInputs,
      filteredOutputs,
      totalInputs,
      totalOutputs,
    }),
  };
}
