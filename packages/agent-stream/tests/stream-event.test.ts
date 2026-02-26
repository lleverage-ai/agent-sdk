import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { StreamEvent } from "../src/stream-event.js";
import { CORE_EVENT_KINDS, EventKindRegistry } from "../src/stream-event.js";

describe("CORE_EVENT_KINDS", () => {
  it("has expected event kinds", () => {
    expect(CORE_EVENT_KINDS.TEXT_DELTA).toBe("text-delta");
    expect(CORE_EVENT_KINDS.TOOL_CALL).toBe("tool-call");
    expect(CORE_EVENT_KINDS.TOOL_RESULT).toBe("tool-result");
    expect(CORE_EVENT_KINDS.REASONING).toBe("reasoning");
    expect(CORE_EVENT_KINDS.FILE).toBe("file");
    expect(CORE_EVENT_KINDS.STEP_STARTED).toBe("step-started");
    expect(CORE_EVENT_KINDS.STEP_FINISHED).toBe("step-finished");
    expect(CORE_EVENT_KINDS.ERROR).toBe("error");
  });

  it("values are readonly (as const)", () => {
    // as const provides compile-time immutability
    expect(Object.keys(CORE_EVENT_KINDS)).toHaveLength(8);
  });
});

describe("EventKindRegistry", () => {
  it("validates events with registered schemas", () => {
    const registry = new EventKindRegistry();
    registry.register("text-delta", z.object({ text: z.string() }));

    const valid: StreamEvent = { kind: "text-delta", payload: { text: "hello" } };
    const invalid: StreamEvent = { kind: "text-delta", payload: { text: 123 } };

    expect(registry.validate(valid)).toBe(true);
    expect(registry.validate(invalid)).toBe(false);
  });

  it("passes events with unregistered kinds (open-world)", () => {
    const registry = new EventKindRegistry();
    const event: StreamEvent = { kind: "custom-event", payload: { anything: true } };
    expect(registry.validate(event)).toBe(true);
  });

  it("reports whether a schema is registered", () => {
    const registry = new EventKindRegistry();
    expect(registry.has("text-delta")).toBe(false);
    registry.register("text-delta", z.object({ text: z.string() }));
    expect(registry.has("text-delta")).toBe(true);
  });

  it("supports multiple registered kinds", () => {
    const registry = new EventKindRegistry();
    registry.register("text-delta", z.object({ text: z.string() }));
    registry.register("tool-call", z.object({ toolName: z.string(), input: z.unknown() }));

    expect(registry.validate({ kind: "text-delta", payload: { text: "hi" } })).toBe(true);
    expect(registry.validate({ kind: "text-delta", payload: { wrong: "field" } })).toBe(false);
    expect(registry.validate({ kind: "tool-call", payload: { toolName: "read", input: {} } })).toBe(
      true,
    );
    expect(registry.validate({ kind: "tool-call", payload: { bad: true } })).toBe(false);
  });

  it("overwrites schema on re-registration", () => {
    const registry = new EventKindRegistry();
    registry.register("test", z.object({ v: z.number() }));
    expect(registry.validate({ kind: "test", payload: { v: 1 } })).toBe(true);
    expect(registry.validate({ kind: "test", payload: { v: "string" } })).toBe(false);

    // Re-register with different schema
    registry.register("test", z.object({ v: z.string() }));
    expect(registry.validate({ kind: "test", payload: { v: "string" } })).toBe(true);
    expect(registry.validate({ kind: "test", payload: { v: 1 } })).toBe(false);
  });
});
