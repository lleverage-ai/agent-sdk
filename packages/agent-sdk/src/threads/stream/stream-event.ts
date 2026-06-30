import type { z } from "zod";

/**
 * A stream event with a kind discriminator and typed payload.
 *
 * The kind is an open string — not a closed union — to allow extension
 * by consumers without modifying this package.
 *
 * @category Types
 */
export interface StreamEvent<TKind extends string = string, TPayload = unknown> {
  /** Discriminator tag identifying the event type */
  readonly kind: TKind;
  /** Event-specific data */
  readonly payload: TPayload;
}

/**
 * Core event kinds emitted during agent generation.
 *
 * These are constants, not a closed enum — consumers can define
 * additional kinds without modifying this package.
 *
 * @category Constants
 */
export const CORE_EVENT_KINDS = {
  TEXT_DELTA: "text-delta",
  TOOL_CALL: "tool-call",
  TOOL_RESULT: "tool-result",
  REASONING: "reasoning",
  FILE: "file",
  STEP_STARTED: "step-started",
  STEP_FINISHED: "step-finished",
  ERROR: "error",
} as const;

/** Union of all core event kind string values */
export type CoreEventKind = (typeof CORE_EVENT_KINDS)[keyof typeof CORE_EVENT_KINDS];

/**
 * Registry for optional runtime validation of stream events.
 *
 * Consumers register Zod schemas keyed by event kind. When `validate()` is called,
 * the registry looks up the schema for the event's kind and validates the payload.
 * Events with unregistered kinds pass validation by default.
 *
 * @category Validation
 */
export class EventKindRegistry {
  private schemas = new Map<string, z.ZodType>();

  /**
   * Register a Zod schema for a specific event kind.
   *
   * @param kind - The event kind to validate
   * @param schema - Zod schema that validates the event's payload
   */
  register(kind: string, schema: z.ZodType): void {
    this.schemas.set(kind, schema);
  }

  /**
   * Check whether a schema is registered for a given kind.
   *
   * @param kind - The event kind to check
   */
  has(kind: string): boolean {
    return this.schemas.has(kind);
  }

  /**
   * Validate a stream event's payload against its registered schema.
   *
   * Returns `true` if:
   * - No schema is registered for the event's kind (open-world assumption), or
   * - The payload passes the registered schema's validation
   *
   * Returns `false` if the payload fails validation.
   *
   * @param event - The stream event to validate
   */
  validate(event: StreamEvent): boolean {
    const schema = this.schemas.get(event.kind);
    if (!schema) return true;
    const result = schema.safeParse(event.payload);
    return result.success;
  }
}
