import { describe, expect, it } from "vitest";

import { createCounterIdGenerator, ulid } from "../../src/ledger/ulid.js";

describe("ulid", () => {
  it("produces 26-character strings", () => {
    expect(ulid()).toHaveLength(26);
  });

  it("uses only Crockford base32 characters", () => {
    const id = ulid();
    expect(id).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  });

  it("is monotonically sortable by timestamp", () => {
    const a = ulid(1000);
    const b = ulid(2000);
    expect(a < b).toBe(true);
  });

  it("accepts optional timestamp override", () => {
    const a = ulid(0);
    const b = ulid(0);
    // Same timestamp prefix (first 10 chars)
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
  });

  it("generates unique IDs across rapid calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => ulid()));
    expect(ids.size).toBe(1000);
  });
});

describe("createCounterIdGenerator", () => {
  it("produces sequential IDs with default prefix", () => {
    const gen = createCounterIdGenerator();
    expect(gen()).toBe("id-1");
    expect(gen()).toBe("id-2");
    expect(gen()).toBe("id-3");
  });

  it("uses custom prefix", () => {
    const gen = createCounterIdGenerator("msg");
    expect(gen()).toBe("msg-1");
    expect(gen()).toBe("msg-2");
  });
});
