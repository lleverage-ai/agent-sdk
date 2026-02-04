/**
 * Secrets filtering hook utilities.
 *
 * Provides hooks to detect and redact common secret patterns in inputs
 * and outputs using the unified hook system.
 *
 * @packageDocumentation
 */

import type { HookCallback, PostGenerateInput, PreGenerateInput } from "../types.js";

/**
 * Common secret patterns for automatic detection.
 *
 * @category Hooks
 */
export const COMMON_SECRET_PATTERNS = {
  /** AWS access keys (AKIA...) */
  AWS_ACCESS_KEY: /AKIA[0-9A-Z]{16}/g,

  /** AWS secret keys (40 chars base64) */
  AWS_SECRET_KEY: /[A-Za-z0-9/+=]{40}/g,

  /** GitHub personal access tokens */
  GITHUB_TOKEN: /ghp_[A-Za-z0-9]{36}/g,

  /** GitHub OAuth tokens */
  GITHUB_OAUTH: /gho_[A-Za-z0-9]{36}/g,

  /** Generic API keys (common formats) */
  API_KEY: /api[_-]?key[_-]?[=:]\s*['""]?[A-Za-z0-9_-]{20,}['""]?/gi,

  /** Bearer tokens */
  BEARER_TOKEN: /Bearer\s+[A-Za-z0-9_\-.]+/gi,

  /** JWT tokens */
  JWT: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,

  /** Private keys (PEM format headers) */
  PRIVATE_KEY:
    /-----BEGIN\s+(?:RSA|EC|OPENSSH|DSA)?\s*PRIVATE KEY-----[\s\S]*?-----END\s+(?:RSA|EC|OPENSSH|DSA)?\s*PRIVATE KEY-----/g,

  /** Generic passwords in common formats */
  PASSWORD: /password[_-]?[=:]\s*['""]?[^\s'"",;]{6,}['""]?/gi,

  /** Slack tokens */
  SLACK_TOKEN: /xox[baprs]-[0-9a-zA-Z]{10,48}/g,

  /** Stripe API keys */
  STRIPE_KEY: /sk_(?:live|test)_[0-9a-zA-Z]{24,}/g,

  /** Generic secrets in common formats */
  GENERIC_SECRET: /secret[_-]?[=:]\s*['""]?[A-Za-z0-9_-]{20,}['""]?/gi,
};

/**
 * Options for creating secrets filter hooks.
 *
 * @category Hooks
 */
export interface SecretsFilterHooksOptions {
  /**
   * Custom secret patterns to detect (in addition to built-in patterns).
   */
  customPatterns?: RegExp[];

  /**
   * Built-in patterns to use.
   * @defaultValue All patterns from COMMON_SECRET_PATTERNS
   */
  patterns?: RegExp[];

  /**
   * Replacement text for redacted secrets.
   * @defaultValue "[REDACTED]"
   */
  redactionText?: string;

  /**
   * Whether to filter input (user messages).
   * @defaultValue true
   */
  filterInput?: boolean;

  /**
   * Whether to filter output (model responses).
   * @defaultValue true
   */
  filterOutput?: boolean;

  /**
   * Callback when secrets are detected.
   * Useful for logging/alerting.
   */
  onSecretDetected?: (type: "input" | "output", pattern: RegExp, match: string) => void;
}

/**
 * Redacts secrets in text using the provided patterns.
 */
function redactSecrets(
  text: string,
  patterns: RegExp[],
  redactionText: string,
  onDetected?: (pattern: RegExp, match: string) => void,
): string {
  let redacted = text;

  for (const pattern of patterns) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;

    // Find all matches first (for callback)
    if (onDetected) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          onDetected(pattern, match);
        }
      }
    }

    // Redact all matches
    redacted = redacted.replace(pattern, redactionText);
  }

  return redacted;
}

/**
 * Extracts and redacts text from messages.
 */
function redactMessages(
  messages: unknown[] = [],
  patterns: RegExp[],
  redactionText: string,
  onDetected?: (pattern: RegExp, match: string) => void,
): unknown[] {
  return messages.map((msg) => {
    if (typeof msg !== "object" || msg === null) return msg;

    const content = (msg as { content?: unknown }).content;

    if (typeof content === "string") {
      return {
        ...msg,
        content: redactSecrets(content, patterns, redactionText, onDetected),
      };
    } else if (Array.isArray(content)) {
      return {
        ...msg,
        content: content.map((part) => {
          if (
            typeof part === "object" &&
            part !== null &&
            "text" in part &&
            typeof part.text === "string"
          ) {
            return {
              ...part,
              text: redactSecrets(part.text, patterns, redactionText, onDetected),
            };
          }
          return part;
        }),
      };
    }

    return msg;
  });
}

/**
 * Creates secrets filtering hooks for input and output.
 *
 * The PreGenerate hook redacts secrets from input messages before sending
 * to the model. The PostGenerate hook redacts secrets from model responses.
 *
 * This addresses the secrets redaction requirement from CODE_REVIEW.md
 * using the unified hook system.
 *
 * @param options - Configuration options
 * @returns Array of two hooks: [PreGenerate input filter, PostGenerate output filter]
 *
 * @example
 * ```typescript
 * const [inputFilter, outputFilter] = createSecretsFilterHooks({
 *   redactionText: "***REDACTED***",
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
 * // Custom patterns with alerting
 * const hooks = createSecretsFilterHooks({
 *   customPatterns: [/my-secret-format-[A-Z0-9]{16}/g],
 *   onSecretDetected: (type, pattern, match) => {
 *     console.warn(`Secret detected in ${type}:`, pattern.source);
 *     alertSecurityTeam({ type, pattern: pattern.source });
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Only specific patterns
 * const hooks = createSecretsFilterHooks({
 *   patterns: [
 *     COMMON_SECRET_PATTERNS.AWS_ACCESS_KEY,
 *     COMMON_SECRET_PATTERNS.GITHUB_TOKEN,
 *   ],
 * });
 * ```
 *
 * @category Hooks
 */
export function createSecretsFilterHooks(
  options: SecretsFilterHooksOptions = {},
): [HookCallback, HookCallback] {
  const {
    customPatterns = [],
    patterns = Object.values(COMMON_SECRET_PATTERNS),
    redactionText = "[REDACTED]",
    filterInput = true,
    filterOutput = true,
    onSecretDetected,
  } = options;

  const allPatterns = [...patterns, ...customPatterns];

  // PreGenerate: Redact secrets from input
  const inputFilter: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreGenerate") return {};
    if (!filterInput) return {};

    const preGenInput = input as PreGenerateInput;
    const messages = preGenInput.options.messages;

    if (!messages || messages.length === 0) return {};

    const redactedMessages = redactMessages(
      messages,
      allPatterns,
      redactionText,
      onSecretDetected ? (pattern, match) => onSecretDetected("input", pattern, match) : undefined,
    );

    // Only return updatedInput if we actually changed something
    if (JSON.stringify(redactedMessages) !== JSON.stringify(messages)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          updatedInput: {
            ...preGenInput.options,
            messages: redactedMessages,
          },
        },
      };
    }

    return {};
  };

  // PostGenerate: Redact secrets from output
  const outputFilter: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostGenerate") return {};
    if (!filterOutput) return {};

    const postGenInput = input as PostGenerateInput;
    const text = postGenInput.result.text || "";

    const redactedText = redactSecrets(
      text,
      allPatterns,
      redactionText,
      onSecretDetected ? (pattern, match) => onSecretDetected("output", pattern, match) : undefined,
    );

    // Only return updatedResult if we actually changed something
    if (redactedText !== text) {
      return {
        hookSpecificOutput: {
          hookEventName: "PostGenerate",
          updatedResult: {
            ...postGenInput.result,
            text: redactedText,
          },
        },
      };
    }

    return {};
  };

  return [inputFilter, outputFilter];
}

/**
 * Creates managed secrets filter hooks with detection statistics.
 *
 * Returns hooks along with functions to get detection statistics.
 *
 * @param options - Configuration options
 * @returns Object with hooks and statistics getter
 *
 * @example
 * ```typescript
 * const { hooks, getStats, getDetections } = createManagedSecretsFilterHooks();
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
 * console.log(`Secrets detected: ${stats.totalDetections} (${stats.inputDetections} input, ${stats.outputDetections} output)`);
 *
 * // Get detailed detections
 * const detections = getDetections();
 * console.log('Recent detections:', detections.slice(0, 10));
 * ```
 *
 * @category Hooks
 */
export function createManagedSecretsFilterHooks(options: SecretsFilterHooksOptions = {}): {
  hooks: [HookCallback, HookCallback];
  getStats: () => {
    inputDetections: number;
    outputDetections: number;
    totalDetections: number;
  };
  getDetections: () => Array<{
    type: "input" | "output";
    pattern: string;
    timestamp: number;
  }>;
} {
  const {
    customPatterns = [],
    patterns = Object.values(COMMON_SECRET_PATTERNS),
    redactionText = "[REDACTED]",
    filterInput = true,
    filterOutput = true,
    onSecretDetected,
  } = options;

  const allPatterns = [...patterns, ...customPatterns];

  let inputDetections = 0;
  let outputDetections = 0;
  const detections: Array<{
    type: "input" | "output";
    pattern: string;
    timestamp: number;
  }> = [];

  const trackDetection = (type: "input" | "output", pattern: RegExp, match: string) => {
    if (type === "input") inputDetections++;
    else outputDetections++;

    detections.push({
      type,
      pattern: pattern.source,
      timestamp: Date.now(),
    });

    if (onSecretDetected) {
      onSecretDetected(type, pattern, match);
    }
  };

  const inputFilter: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreGenerate") return {};
    if (!filterInput) return {};

    const preGenInput = input as PreGenerateInput;
    const messages = preGenInput.options.messages;

    if (!messages || messages.length === 0) return {};

    const redactedMessages = redactMessages(
      messages,
      allPatterns,
      redactionText,
      (pattern, match) => trackDetection("input", pattern, match),
    );

    if (JSON.stringify(redactedMessages) !== JSON.stringify(messages)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          updatedInput: {
            ...preGenInput.options,
            messages: redactedMessages,
          },
        },
      };
    }

    return {};
  };

  const outputFilter: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostGenerate") return {};
    if (!filterOutput) return {};

    const postGenInput = input as PostGenerateInput;
    const text = postGenInput.result.text || "";

    const redactedText = redactSecrets(text, allPatterns, redactionText, (pattern, match) =>
      trackDetection("output", pattern, match),
    );

    if (redactedText !== text) {
      return {
        hookSpecificOutput: {
          hookEventName: "PostGenerate",
          updatedResult: {
            ...postGenInput.result,
            text: redactedText,
          },
        },
      };
    }

    return {};
  };

  return {
    hooks: [inputFilter, outputFilter],
    getStats: () => ({
      inputDetections,
      outputDetections,
      totalDetections: inputDetections + outputDetections,
    }),
    getDetections: () => [...detections],
  };
}
