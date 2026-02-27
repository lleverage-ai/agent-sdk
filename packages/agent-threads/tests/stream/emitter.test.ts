import { describe, expect, it, vi } from "vitest";

import { TypedEmitter } from "../../src/stream/emitter.js";

type TestEvents = {
  message: (text: string) => void;
  count: (n: number) => void;
  empty: () => void;
  error: (err: unknown) => void;
};

describe("TypedEmitter", () => {
  it("calls listener on emit", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn = vi.fn();
    emitter.on("message", fn);
    emitter.emit("message", "hello");
    expect(fn).toHaveBeenCalledWith("hello");
  });

  it("supports multiple listeners for same event", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on("message", fn1);
    emitter.on("message", fn2);
    emitter.emit("message", "hi");
    expect(fn1).toHaveBeenCalledWith("hi");
    expect(fn2).toHaveBeenCalledWith("hi");
  });

  it("returns unsubscribe function from on()", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn = vi.fn();
    const unsub = emitter.on("message", fn);
    unsub();
    emitter.emit("message", "ignored");
    expect(fn).not.toHaveBeenCalled();
  });

  it("removes listener with off()", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn = vi.fn();
    emitter.on("message", fn);
    emitter.off("message", fn);
    emitter.emit("message", "ignored");
    expect(fn).not.toHaveBeenCalled();
  });

  it("removeAllListeners for specific event", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const msgFn = vi.fn();
    const countFn = vi.fn();
    emitter.on("message", msgFn);
    emitter.on("count", countFn);
    emitter.removeAllListeners("message");
    emitter.emit("message", "ignored");
    emitter.emit("count", 42);
    expect(msgFn).not.toHaveBeenCalled();
    expect(countFn).toHaveBeenCalledWith(42);
  });

  it("removeAllListeners for all events", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const msgFn = vi.fn();
    const countFn = vi.fn();
    emitter.on("message", msgFn);
    emitter.on("count", countFn);
    emitter.removeAllListeners();
    emitter.emit("message", "ignored");
    emitter.emit("count", 0);
    expect(msgFn).not.toHaveBeenCalled();
    expect(countFn).not.toHaveBeenCalled();
  });

  it("emitting non-error event with no listeners does not throw", () => {
    const emitter = new TypedEmitter<TestEvents>();
    expect(() => emitter.emit("message", "no-one-listening")).not.toThrow();
  });

  it("throws on unhandled error event (Node.js convention)", () => {
    const emitter = new TypedEmitter<TestEvents>();
    expect(() => emitter.emit("error", new Error("boom"))).toThrow("boom");
  });

  it("throws non-Error values wrapped in Error on unhandled error event", () => {
    const emitter = new TypedEmitter<TestEvents>();
    expect(() => emitter.emit("error", "string error")).toThrow("string error");
  });

  it("does not throw on error event when listener is registered", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn = vi.fn();
    emitter.on("error", fn);
    expect(() => emitter.emit("error", new Error("handled"))).not.toThrow();
    expect(fn).toHaveBeenCalled();
  });

  it("off() on non-existent listener does not throw", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const fn = vi.fn();
    expect(() => emitter.off("message", fn)).not.toThrow();
  });

  it("continues notifying other listeners when one throws", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const bad = vi.fn(() => {
      throw new Error("listener failure");
    });
    const good = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    emitter.on("message", bad);
    emitter.on("message", good);

    expect(() => emitter.emit("message", "resilient")).not.toThrow();
    expect(bad).toHaveBeenCalledWith("resilient");
    expect(good).toHaveBeenCalledWith("resilient");
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
