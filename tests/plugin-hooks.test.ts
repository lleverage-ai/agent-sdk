import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeCustomHook } from "../src/hooks.js";
import { mergeHooks } from "../src/middleware/apply.js";
import { createMiddlewareContext } from "../src/middleware/context.js";
import { definePlugin } from "../src/plugins.js";
import type { Agent, HookCallback, HookRegistration } from "../src/types.js";

// Mock agent for hook invocation
const mockAgent = { id: "test-agent" } as Agent;

describe("Plugin Hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("definePlugin with hooks", () => {
    it("passes through hooks from plugin options", () => {
      const callback: HookCallback = vi.fn(async () => ({}));

      const plugin = definePlugin({
        name: "test-plugin",
        hooks: {
          PreGenerate: [callback],
        },
      });

      expect(plugin.hooks).toBeDefined();
      expect(plugin.hooks?.PreGenerate).toHaveLength(1);
      expect(plugin.hooks?.PreGenerate?.[0]).toBe(callback);
    });

    it("passes through custom hooks", () => {
      const callback: HookCallback = vi.fn(async () => ({}));

      const plugin = definePlugin({
        name: "test-plugin",
        hooks: {
          Custom: {
            "my:Event": [callback],
          },
        },
      });

      expect(plugin.hooks?.Custom).toBeDefined();
      expect(plugin.hooks?.Custom?.["my:Event"]).toHaveLength(1);
    });

    it("returns undefined hooks when not provided", () => {
      const plugin = definePlugin({ name: "no-hooks-plugin" });
      expect(plugin.hooks).toBeUndefined();
    });
  });

  describe("mergeHooks with Custom field", () => {
    it("merges custom hooks from multiple registrations", () => {
      const cb1: HookCallback = vi.fn(async () => ({}));
      const cb2: HookCallback = vi.fn(async () => ({}));

      const reg1: HookRegistration = {
        Custom: { "event:A": [cb1] },
      };
      const reg2: HookRegistration = {
        Custom: { "event:A": [cb2], "event:B": [cb2] },
      };

      const merged = mergeHooks(reg1, reg2);

      expect(merged.Custom?.["event:A"]).toHaveLength(2);
      expect(merged.Custom?.["event:A"]?.[0]).toBe(cb1);
      expect(merged.Custom?.["event:A"]?.[1]).toBe(cb2);
      expect(merged.Custom?.["event:B"]).toHaveLength(1);
    });

    it("handles first registration with no Custom field", () => {
      const cb: HookCallback = vi.fn(async () => ({}));

      const reg1: HookRegistration = {};
      const reg2: HookRegistration = {
        Custom: { "event:A": [cb] },
      };

      const merged = mergeHooks(reg1, reg2);
      expect(merged.Custom?.["event:A"]).toHaveLength(1);
    });

    it("handles second registration with no Custom field", () => {
      const cb: HookCallback = vi.fn(async () => ({}));

      const reg1: HookRegistration = {
        Custom: { "event:A": [cb] },
      };
      const reg2: HookRegistration = {};

      const merged = mergeHooks(reg1, reg2);
      expect(merged.Custom?.["event:A"]).toHaveLength(1);
    });

    it("merges plugin hooks in order with other registrations", () => {
      const mwCb: HookCallback = vi.fn(async () => ({}));
      const pluginCb: HookCallback = vi.fn(async () => ({}));
      const agentCb: HookCallback = vi.fn(async () => ({}));

      const middlewareHooks: HookRegistration = { PreGenerate: [mwCb] };
      const pluginHooks: HookRegistration = { PreGenerate: [pluginCb] };
      const agentHooks: HookRegistration = { PreGenerate: [agentCb] };

      const merged = mergeHooks(middlewareHooks, pluginHooks, agentHooks);

      expect(merged.PreGenerate).toHaveLength(3);
      expect(merged.PreGenerate?.[0]).toBe(mwCb);
      expect(merged.PreGenerate?.[1]).toBe(pluginCb);
      expect(merged.PreGenerate?.[2]).toBe(agentCb);
    });
  });

  describe("invokeCustomHook", () => {
    it("invokes callbacks for the given event name", async () => {
      const cb: HookCallback = vi.fn(async () => ({ hookSpecificOutput: { result: "ok" } }));

      const registration: HookRegistration = {
        Custom: { "my:Event": [cb] },
      };

      const outputs = await invokeCustomHook(registration, "my:Event", { data: "test" }, mockAgent);

      expect(cb).toHaveBeenCalledOnce();
      expect(outputs).toHaveLength(1);
      expect(outputs[0].hookSpecificOutput?.result).toBe("ok");

      // Verify the input shape
      const callArgs = (cb as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[0]).toMatchObject({
        hook_event_name: "Custom",
        custom_event: "my:Event",
        payload: { data: "test" },
      });
    });

    it("returns empty array when no callbacks registered", async () => {
      const outputs = await invokeCustomHook({ Custom: {} }, "nonexistent:Event", {}, mockAgent);

      expect(outputs).toEqual([]);
    });

    it("returns empty array when registration is undefined", async () => {
      const outputs = await invokeCustomHook(undefined, "my:Event", {}, mockAgent);
      expect(outputs).toEqual([]);
    });

    it("returns empty array when Custom is undefined", async () => {
      const outputs = await invokeCustomHook({}, "my:Event", {}, mockAgent);
      expect(outputs).toEqual([]);
    });

    it("invokes multiple callbacks for same event", async () => {
      const cb1: HookCallback = vi.fn(async () => ({}));
      const cb2: HookCallback = vi.fn(async () => ({}));

      const registration: HookRegistration = {
        Custom: { "my:Event": [cb1, cb2] },
      };

      const outputs = await invokeCustomHook(registration, "my:Event", { x: 1 }, mockAgent);

      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
      expect(outputs).toHaveLength(2);
    });
  });

  describe("middleware onCustom()", () => {
    it("registers custom hook callbacks via onCustom", () => {
      const { context, getHooks } = createMiddlewareContext();
      const cb: HookCallback = vi.fn(async () => ({}));

      context.onCustom("my:Event", cb);

      const hooks = getHooks();
      expect(hooks.Custom).toBeDefined();
      expect(hooks.Custom?.["my:Event"]).toHaveLength(1);
      expect(hooks.Custom?.["my:Event"]?.[0]).toBe(cb);
    });

    it("registers multiple callbacks for the same custom event", () => {
      const { context, getHooks } = createMiddlewareContext();
      const cb1: HookCallback = vi.fn(async () => ({}));
      const cb2: HookCallback = vi.fn(async () => ({}));

      context.onCustom("my:Event", cb1);
      context.onCustom("my:Event", cb2);

      const hooks = getHooks();
      expect(hooks.Custom?.["my:Event"]).toHaveLength(2);
    });

    it("registers callbacks for different custom events", () => {
      const { context, getHooks } = createMiddlewareContext();
      const cb1: HookCallback = vi.fn(async () => ({}));
      const cb2: HookCallback = vi.fn(async () => ({}));

      context.onCustom("event:A", cb1);
      context.onCustom("event:B", cb2);

      const hooks = getHooks();
      expect(hooks.Custom?.["event:A"]).toHaveLength(1);
      expect(hooks.Custom?.["event:B"]).toHaveLength(1);
    });

    it("does not include Custom when no custom hooks are registered", () => {
      const { context, getHooks } = createMiddlewareContext();

      // Register a regular hook only
      context.onPreGenerate(vi.fn(async () => ({})));

      const hooks = getHooks();
      expect(hooks.Custom).toBeUndefined();
      expect(hooks.PreGenerate).toHaveLength(1);
    });
  });
});
