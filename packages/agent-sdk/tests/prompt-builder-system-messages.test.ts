/**
 * Tests for PromptBuilder.buildSystemMessages — structured-block system
 * emission with an Anthropic cache_control breakpoint at the stability
 * boundary (LLE-10626).
 */

import { describe, expect, it } from "vitest";
import type { PromptComponent } from "../src/prompt-builder/index.js";
import { MAX_PROMPT_CACHE_BREAKPOINTS, PromptBuilder } from "../src/prompt-builder/index.js";

/**
 * Builder with a deterministic mix of static and dynamic sections in a known
 * priority order: two static heads, then two dynamic tails.
 */
function makeMixedBuilder(): PromptBuilder {
  const components: PromptComponent[] = [
    { name: "identity", priority: 100, stability: "static", render: () => "IDENTITY" },
    { name: "policy", priority: 90, stability: "static", render: () => "POLICY" },
    { name: "context", priority: 80, stability: "dynamic", render: () => "CONTEXT" },
    { name: "recall", priority: 70, stability: "dynamic", render: () => "RECALL" },
  ];
  return new PromptBuilder().registerMany(components);
}

describe("PromptBuilder.buildSystemMessages", () => {
  describe("stability boundary split", () => {
    it("splits at the first dynamic section into a stable head and dynamic tail", () => {
      const builder = makeMixedBuilder();

      const messages = builder.buildSystemMessages({});

      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe("system");
      expect(messages[0]?.content).toBe("IDENTITY\n\nPOLICY");
      expect(messages[1]?.role).toBe("system");
      expect(messages[1]?.content).toBe("CONTEXT\n\nRECALL");
    });

    it("treats a static section that renders after a dynamic one as part of the tail", () => {
      // A static section is positioned (by priority) AFTER a dynamic one; it
      // cannot be in a byte-stable prefix, so it must fall into the tail.
      const builder = new PromptBuilder().registerMany([
        { name: "identity", priority: 100, stability: "static", render: () => "IDENTITY" },
        { name: "context", priority: 90, stability: "dynamic", render: () => "CONTEXT" },
        { name: "late-static", priority: 80, stability: "static", render: () => "LATE" },
      ]);

      const messages = builder.buildSystemMessages({});

      expect(messages).toHaveLength(2);
      expect(messages[0]?.content).toBe("IDENTITY");
      expect(messages[1]?.content).toBe("CONTEXT\n\nLATE");
    });

    it("returns a single unmarked message when the first section is dynamic (no stable head)", () => {
      const builder = new PromptBuilder().registerMany([
        { name: "context", priority: 100, stability: "dynamic", render: () => "CONTEXT" },
        { name: "recall", priority: 90, stability: "dynamic", render: () => "RECALL" },
      ]);

      const messages = builder.buildSystemMessages({}, { cacheTtl: "5m" });

      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe("CONTEXT\n\nRECALL");
      expect(messages[0]?.providerOptions).toBeUndefined();
    });

    it("returns only the stable head when there is no dynamic tail", () => {
      const builder = new PromptBuilder().registerMany([
        { name: "identity", priority: 100, stability: "static", render: () => "IDENTITY" },
        { name: "policy", priority: 90, stability: "static", render: () => "POLICY" },
      ]);

      const messages = builder.buildSystemMessages({}, { cacheTtl: "5m" });

      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe("IDENTITY\n\nPOLICY");
      expect(messages[0]?.providerOptions?.anthropic).toMatchObject({
        cacheControl: { type: "ephemeral", ttl: "5m" },
      });
    });

    it("returns an empty array when no sections render", () => {
      const builder = new PromptBuilder().register({
        name: "empty",
        stability: "static",
        render: () => "",
      });

      expect(builder.buildSystemMessages({})).toEqual([]);
    });

    it("classifies sections with no explicit stability as dynamic", () => {
      const builder = new PromptBuilder().registerMany([
        { name: "head", priority: 100, stability: "static", render: () => "HEAD" },
        // No stability => defaults to dynamic => boundary.
        { name: "rest", priority: 90, render: () => "REST" },
      ]);

      const messages = builder.buildSystemMessages({});

      expect(messages).toHaveLength(2);
      expect(messages[0]?.content).toBe("HEAD");
      expect(messages[1]?.content).toBe("REST");
    });
  });

  describe("cacheControl on the stable head", () => {
    it("marks the stable head with an ephemeral cacheControl breakpoint", () => {
      const builder = makeMixedBuilder();

      const messages = builder.buildSystemMessages({}, { cacheTtl: "5m" });

      expect(messages[0]?.providerOptions?.anthropic).toMatchObject({
        cacheControl: { type: "ephemeral", ttl: "5m" },
      });
      // The dynamic tail never carries a breakpoint.
      expect(messages[1]?.providerOptions).toBeUndefined();
    });

    it("honours the 1h ttl", () => {
      const builder = makeMixedBuilder();

      const messages = builder.buildSystemMessages({}, { cacheTtl: "1h" });

      expect(messages[0]?.providerOptions?.anthropic).toMatchObject({
        cacheControl: { type: "ephemeral", ttl: "1h" },
      });
    });

    it("emits no breakpoint when cacheTtl is omitted (purely structural split)", () => {
      const builder = makeMixedBuilder();

      const messages = builder.buildSystemMessages({});

      expect(messages[0]?.providerOptions).toBeUndefined();
      expect(messages[1]?.providerOptions).toBeUndefined();
    });

    it("places at most one breakpoint, staying within the provider budget", () => {
      const builder = makeMixedBuilder();

      const messages = builder.buildSystemMessages({}, { cacheTtl: "5m" });

      const breakpoints = messages.filter(
        (m) =>
          (m.providerOptions?.anthropic as { cacheControl?: unknown } | undefined)?.cacheControl !==
          undefined,
      );
      expect(breakpoints).toHaveLength(1);
      expect(breakpoints.length).toBeLessThanOrEqual(MAX_PROMPT_CACHE_BREAKPOINTS);
    });
  });

  describe("byte-faithfulness to build()", () => {
    it("concatenated message content reproduces the build() string exactly", () => {
      const builder = makeMixedBuilder();

      const stringForm = builder.build({});
      const messages = builder.buildSystemMessages({}, { cacheTtl: "1h" });
      const concatenated = messages.map((m) => m.content).join("\n\n");

      expect(concatenated).toBe(stringForm);
    });

    it("is byte-faithful when there is only a stable head", () => {
      const builder = new PromptBuilder().registerMany([
        { name: "a", priority: 100, stability: "static", render: () => "A" },
        { name: "b", priority: 90, stability: "static", render: () => "B" },
      ]);

      const concatenated = builder
        .buildSystemMessages({}, { cacheTtl: "5m" })
        .map((m) => m.content)
        .join("\n\n");

      expect(concatenated).toBe(builder.build({}));
    });
  });

  describe("buildWithDiagnostics consistency", () => {
    it("the diagnostics fingerprint matches the concatenated system-message content", () => {
      const builder = makeMixedBuilder();

      const diagnostics = builder.buildWithDiagnostics({});
      const concatenated = builder
        .buildSystemMessages({}, { cacheTtl: "5m" })
        .map((m) => m.content)
        .join("\n\n");

      expect(concatenated).toBe(diagnostics.prompt);
    });

    it("the boundary aligns with the first dynamic section in the diagnostics", () => {
      const builder = makeMixedBuilder();

      const diagnostics = builder.buildWithDiagnostics({});
      const firstDynamicIndex = diagnostics.sections.findIndex((s) => s.stability === "dynamic");
      const stableHeadContent = diagnostics.sections
        .slice(0, firstDynamicIndex)
        .map((s) => s.name)
        .join(",");

      // Head is exactly the leading run of static sections.
      expect(stableHeadContent).toBe("identity,policy");

      const messages = builder.buildSystemMessages({});
      expect(messages[0]?.content).toBe("IDENTITY\n\nPOLICY");
    });
  });
});
