// tests/mcp-env.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandEnvVars } from "../src/mcp/env.js";

describe("expandEnvVars", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TEST_VAR = "test-value";
    process.env.API_TOKEN = "secret-token";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("expands ${VAR} syntax", () => {
    expect(expandEnvVars("Bearer ${API_TOKEN}")).toBe("Bearer secret-token");
  });

  it("expands multiple variables", () => {
    expect(expandEnvVars("${TEST_VAR}-${API_TOKEN}")).toBe("test-value-secret-token");
  });

  it("leaves unset variables as empty string", () => {
    expect(expandEnvVars("prefix-${UNSET_VAR}-suffix")).toBe("prefix--suffix");
  });

  it("returns original string if no variables", () => {
    expect(expandEnvVars("no variables here")).toBe("no variables here");
  });

  it("handles empty string", () => {
    expect(expandEnvVars("")).toBe("");
  });

  it("expands env vars in object values", () => {
    const result = expandEnvVars({
      token: "${API_TOKEN}",
      plain: "no-vars",
    });
    expect(result).toEqual({
      token: "secret-token",
      plain: "no-vars",
    });
  });
});
