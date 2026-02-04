/**
 * Audit hook utilities.
 *
 * Provides structured audit event emission for compliance and monitoring
 * using the unified hook system.
 *
 * @packageDocumentation
 */

import type {
  HookCallback,
  PostGenerateFailureInput,
  PostGenerateInput,
  PostToolUseFailureInput,
  PostToolUseInput,
  PreGenerateInput,
  PreToolUseInput,
} from "../types.js";

/**
 * Audit event categories.
 *
 * @category Hooks
 */
export type AuditEventCategory =
  | "tool_execution"
  | "policy_denial"
  | "approval_prompt"
  | "file_access"
  | "command_execution"
  | "generation"
  | "error";

/**
 * Structured audit event.
 *
 * @category Hooks
 */
export interface AuditEvent {
  /** Event category */
  category: AuditEventCategory;

  /** Event type (hook event name) */
  event: string;

  /** Timestamp (milliseconds since epoch) */
  timestamp: number;

  /** Session ID */
  sessionId: string;

  /** Tool use ID (for tool events) */
  toolUseId?: string | null;

  /** Tool name (for tool events) */
  toolName?: string;

  /** Tool input (for tool events) */
  toolInput?: Record<string, unknown>;

  /** Tool output (for PostToolUse) */
  toolOutput?: unknown;

  /** Error message (for failure events) */
  error?: string;

  /** Permission decision (for PreToolUse/PreGenerate with permission checks) */
  permissionDecision?: "allow" | "deny" | "ask";

  /** Permission decision reason */
  permissionDecisionReason?: string;

  /** Model used (for generation events) */
  model?: string;

  /** Token usage (for generation events) */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Audit event handler function.
 *
 * @category Hooks
 */
export type AuditEventHandler = (event: AuditEvent) => void | Promise<void>;

/**
 * Options for creating audit hooks.
 *
 * @category Hooks
 */
export interface AuditHooksOptions {
  /**
   * Event handler function.
   * Called for each audit event.
   */
  onEvent: AuditEventHandler;

  /**
   * Categories to audit.
   * @defaultValue All categories
   */
  categories?: AuditEventCategory[];

  /**
   * Whether to audit tool execution.
   * @defaultValue true
   */
  auditTools?: boolean;

  /**
   * Whether to audit generation.
   * @defaultValue true
   */
  auditGeneration?: boolean;

  /**
   * Whether to audit errors.
   * @defaultValue true
   */
  auditErrors?: boolean;

  /**
   * Additional metadata to include in all events.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Determines audit category from tool name.
 */
function categorizeToolUse(toolName: string): AuditEventCategory {
  const name = toolName.toLowerCase();

  if (name === "bash" || name === "execute") {
    return "command_execution";
  }

  if (
    name === "read" ||
    name === "write" ||
    name === "edit" ||
    name === "glob" ||
    name === "grep"
  ) {
    return "file_access";
  }

  return "tool_execution";
}

/**
 * Creates audit hooks for all lifecycle events.
 *
 * Emits structured audit events for tool execution, generation,
 * and errors. Useful for compliance, security monitoring, and
 * debugging.
 *
 * This addresses the audit events requirement from CODE_REVIEW.md
 * using the unified hook system.
 *
 * @param options - Configuration options
 * @returns Array of hooks for all audited events
 *
 * @example
 * ```typescript
 * const auditHooks = createAuditHooks({
 *   onEvent: (event) => {
 *     // Send to your logging service
 *     logger.info('Audit event', event);
 *
 *     // Send to SIEM
 *     siem.send(event);
 *
 *     // Store in database
 *     db.auditEvents.insert(event);
 *   },
 * });
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PreToolUse: [{ hooks: [auditHooks[0]] }],
 *     PostToolUse: [{ hooks: [auditHooks[1]] }],
 *     PostToolUseFailure: [{ hooks: [auditHooks[2]] }],
 *     PreGenerate: [{ hooks: [auditHooks[3]] }],
 *     PostGenerate: [{ hooks: [auditHooks[4]] }],
 *     PostGenerateFailure: [{ hooks: [auditHooks[5]] }],
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Selective auditing
 * const auditHooks = createAuditHooks({
 *   categories: ['command_execution', 'file_access', 'policy_denial'],
 *   onEvent: (event) => {
 *     if (event.category === 'command_execution') {
 *       securityLog.command(event);
 *     }
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // JSON lines export for log aggregation
 * const auditHooks = createAuditHooks({
 *   onEvent: (event) => {
 *     console.log(JSON.stringify(event));
 *   },
 * });
 * ```
 *
 * @category Hooks
 */
export function createAuditHooks(options: AuditHooksOptions): HookCallback[] {
  const {
    onEvent,
    categories,
    auditTools = true,
    auditGeneration = true,
    auditErrors = true,
    metadata = {},
  } = options;

  const shouldAuditCategory = (category: AuditEventCategory): boolean => {
    if (!categories) return true;
    return categories.includes(category);
  };

  // PreToolUse: Audit tool calls
  const preToolUse: HookCallback = async (input, toolUseId) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    if (!auditTools) return {};

    const preToolInput = input as PreToolUseInput;
    const category = categorizeToolUse(preToolInput.tool_name);

    if (!shouldAuditCategory(category)) return {};

    const event: AuditEvent = {
      category,
      event: "PreToolUse",
      timestamp: Date.now(),
      sessionId: preToolInput.session_id,
      toolUseId,
      toolName: preToolInput.tool_name,
      toolInput: preToolInput.tool_input,
      metadata,
    };

    await onEvent(event);

    return {};
  };

  // PostToolUse: Audit successful tool execution
  const postToolUse: HookCallback = async (input, toolUseId) => {
    if (input.hook_event_name !== "PostToolUse") return {};
    if (!auditTools) return {};

    const postToolInput = input as PostToolUseInput;
    const category = categorizeToolUse(postToolInput.tool_name);

    if (!shouldAuditCategory(category)) return {};

    const event: AuditEvent = {
      category,
      event: "PostToolUse",
      timestamp: Date.now(),
      sessionId: postToolInput.session_id,
      toolUseId,
      toolName: postToolInput.tool_name,
      toolInput: postToolInput.tool_input,
      toolOutput: postToolInput.tool_response,
      metadata,
    };

    await onEvent(event);

    return {};
  };

  // PostToolUseFailure: Audit tool errors
  const postToolUseFailure: HookCallback = async (input, toolUseId) => {
    if (input.hook_event_name !== "PostToolUseFailure") return {};
    if (!auditErrors) return {};

    const failureInput = input as PostToolUseFailureInput;
    const category = categorizeToolUse(failureInput.tool_name);

    if (!shouldAuditCategory(category) && !shouldAuditCategory("error")) return {};

    const event: AuditEvent = {
      category: "error",
      event: "PostToolUseFailure",
      timestamp: Date.now(),
      sessionId: failureInput.session_id,
      toolUseId,
      toolName: failureInput.tool_name,
      toolInput: failureInput.tool_input,
      error:
        typeof failureInput.error === "string" ? failureInput.error : failureInput.error.message,
      metadata,
    };

    await onEvent(event);

    return {};
  };

  // PreGenerate: Audit generation requests
  const preGenerate: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreGenerate") return {};
    if (!auditGeneration) return {};

    if (!shouldAuditCategory("generation")) return {};

    const preGenInput = input as PreGenerateInput;

    const event: AuditEvent = {
      category: "generation",
      event: "PreGenerate",
      timestamp: Date.now(),
      sessionId: preGenInput.session_id,
      metadata: {
        ...metadata,
        messageCount: preGenInput.options.messages?.length || 0,
      },
    };

    await onEvent(event);

    return {};
  };

  // PostGenerate: Audit generation results
  const postGenerate: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostGenerate") return {};
    if (!auditGeneration) return {};

    if (!shouldAuditCategory("generation")) return {};

    const postGenInput = input as PostGenerateInput;

    const event: AuditEvent = {
      category: "generation",
      event: "PostGenerate",
      timestamp: Date.now(),
      sessionId: postGenInput.session_id,
      usage: postGenInput.result.usage,
      metadata: {
        ...metadata,
        finishReason: postGenInput.result.finishReason,
      },
    };

    await onEvent(event);

    return {};
  };

  // PostGenerateFailure: Audit generation errors
  const postGenerateFailure: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostGenerateFailure") return {};
    if (!auditErrors) return {};

    if (!shouldAuditCategory("error")) return {};

    const failureInput = input as PostGenerateFailureInput;

    const event: AuditEvent = {
      category: "error",
      event: "PostGenerateFailure",
      timestamp: Date.now(),
      sessionId: failureInput.session_id,
      error: failureInput.error.message,
      metadata,
    };

    await onEvent(event);

    return {};
  };

  return [
    preToolUse,
    postToolUse,
    postToolUseFailure,
    preGenerate,
    postGenerate,
    postGenerateFailure,
  ];
}

/**
 * Export audit events to JSON Lines format.
 *
 * Returns a function that writes audit events to console.log
 * in JSON Lines format (one JSON object per line), suitable for
 * log aggregation tools.
 *
 * @returns Audit event handler for JSON Lines export
 *
 * @example
 * ```typescript
 * const auditHooks = createAuditHooks({
 *   onEvent: exportAuditEventsJSONLines(),
 * });
 * ```
 *
 * @category Hooks
 */
export function exportAuditEventsJSONLines(): AuditEventHandler {
  return (event: AuditEvent) => {
    console.log(JSON.stringify(event));
  };
}

/**
 * Creates an in-memory audit event store.
 *
 * Useful for testing and development. Events are kept in memory
 * with a configurable size limit.
 *
 * @param maxEvents - Maximum events to keep
 * @returns Object with event handler and getter
 *
 * @example
 * ```typescript
 * const { onEvent, getEvents, clear } = createInMemoryAuditStore(1000);
 *
 * const auditHooks = createAuditHooks({ onEvent });
 *
 * // Later, retrieve events
 * const events = getEvents();
 * console.log(`Captured ${events.length} audit events`);
 * ```
 *
 * @category Hooks
 */
export function createInMemoryAuditStore(maxEvents = 1000): {
  onEvent: AuditEventHandler;
  getEvents: () => AuditEvent[];
  clear: () => void;
} {
  const events: AuditEvent[] = [];

  return {
    onEvent: (event: AuditEvent) => {
      events.push(event);

      // LRU eviction
      if (events.length > maxEvents) {
        events.shift();
      }
    },
    getEvents: () => [...events],
    clear: () => {
      events.length = 0;
    },
  };
}
