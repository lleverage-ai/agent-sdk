import { describe, expect, it } from "vitest";

import {
  AgentError,
  ConfigurationError,
  ContextLogConflictError,
  ContextLogError,
  ContextLogNotFoundError,
  ContextLogRefusedError,
  ContextLogUnavailableError,
  createAgent,
  isContextLogError,
  MemoryContextLogStore,
} from "../../src/index.js";
import { createMockModel } from "../../src/testing/index.js";

describe("context log errors", () => {
  it("distinguishes conflict, not found, refused and retryable unavailability", () => {
    const conflict = new ContextLogConflictError("head_moved");
    const notFound = new ContextLogNotFoundError("manifest", "m1");
    const refused = new ContextLogRefusedError("access_revoked");
    const unavailable = new ContextLogUnavailableError("timeout");

    expect([conflict.kind, notFound.kind, refused.kind, unavailable.kind]).toEqual([
      "conflict",
      "not_found",
      "refused",
      "unavailable",
    ]);
    expect(unavailable.retryable).toBe(true);
    expect([conflict, notFound, refused].some((error) => error.retryable)).toBe(false);
    expect(conflict.reason).toBe("head_moved");
    expect(conflict.head).toBeNull();
    expect(notFound.resource).toBe("manifest");
    expect(conflict).toBeInstanceOf(AgentError);
    expect(conflict.code).toBe("CONTEXT_ERROR");
  });

  it("recognises context log errors across SDK copies by shape", () => {
    const foreign = Object.assign(new Error("conflict"), {
      code: "CONTEXT_ERROR",
      kind: "conflict",
      reason: "head_moved",
    });
    expect(isContextLogError(foreign)).toBe(true);
    expect(isContextLogError(foreign, "conflict")).toBe(true);
    expect(isContextLogError(foreign, "refused")).toBe(false);
    expect(isContextLogError(new Error("plain"))).toBe(false);
    expect(isContextLogError(new AgentError("other", { code: "CONTEXT_ERROR" }))).toBe(false);
    expect(isContextLogError(new ContextLogError("invalid", "bad", "bad"), "invalid")).toBe(true);
  });
});

describe("createAgent contextLog option", () => {
  it("keeps legacy behaviour when the option is off or omitted", () => {
    const store = new MemoryContextLogStore();
    expect(() => createAgent({ model: createMockModel() })).not.toThrow();
    expect(() => createAgent({ model: createMockModel(), contextLog: { store } })).not.toThrow();
    expect(() =>
      createAgent({ model: createMockModel(), contextLog: { mode: "off", store } }),
    ).not.toThrow();
  });

  it("enables log mode with a frozen core", () => {
    expect(() =>
      createAgent({
        model: createMockModel(),
        systemPrompt: "core",
        contextLog: { mode: "log", store: new MemoryContextLogStore() },
      }),
    ).not.toThrow();
  });

  it("rejects log mode without a frozen core and unknown modes", () => {
    expect(() =>
      createAgent({
        model: createMockModel(),
        contextLog: { mode: "log", store: new MemoryContextLogStore() },
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      createAgent({
        model: createMockModel(),
        systemPrompt: "core",
        contextLog: {
          mode: "journal" as "log",
          store: new MemoryContextLogStore(),
        },
      }),
    ).toThrow(ConfigurationError);
  });
});
