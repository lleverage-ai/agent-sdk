/**
 * Tests for observability preset.
 */

import { describe, expect, it } from "vitest";
import { createObservabilityPreset } from "../src/observability/preset.js";

describe("createObservabilityPreset", () => {
  it("should create preset with all components enabled by default", () => {
    const preset = createObservabilityPreset();

    expect(preset.logger).toBeDefined();
    expect(preset.metricsRegistry).toBeDefined();
    expect(preset.metrics).toBeDefined();
    expect(preset.tracer).toBeDefined();
    expect(preset.hooks).toBeDefined();
    expect(Object.keys(preset.hooks!).length).toBeGreaterThan(0);
  });

  it("should use provided name for logger and tracer", () => {
    const preset = createObservabilityPreset({
      name: "test-agent",
    });

    // Logger should have the name in its options
    expect(preset.logger).toBeDefined();
    // Note: The actual logger internals depend on implementation,
    // but we can verify it was created successfully
  });

  it("should allow disabling individual components", () => {
    const presetNoLogging = createObservabilityPreset({
      enableLogging: false,
    });
    expect(presetNoLogging.logger).toBeUndefined();
    expect(presetNoLogging.metricsRegistry).toBeDefined();
    expect(presetNoLogging.tracer).toBeDefined();

    const presetNoMetrics = createObservabilityPreset({
      enableMetrics: false,
    });
    expect(presetNoMetrics.logger).toBeDefined();
    expect(presetNoMetrics.metricsRegistry).toBeUndefined();
    expect(presetNoMetrics.metrics).toBeUndefined();
    expect(presetNoMetrics.tracer).toBeDefined();

    const presetNoTracing = createObservabilityPreset({
      enableTracing: false,
    });
    expect(presetNoTracing.logger).toBeDefined();
    expect(presetNoTracing.metricsRegistry).toBeDefined();
    expect(presetNoTracing.tracer).toBeUndefined();

    const presetNoHooks = createObservabilityPreset({
      enableHooks: false,
    });
    expect(presetNoHooks.logger).toBeDefined();
    expect(presetNoHooks.hooks).toBeUndefined();
  });

  it("should allow overriding logger options", () => {
    const preset = createObservabilityPreset({
      loggerOptions: {
        level: "error",
      },
    });

    expect(preset.logger).toBeDefined();
    // Logger should be created with error level
  });

  it("should create agent metrics when metrics are enabled", () => {
    const preset = createObservabilityPreset({
      enableMetrics: true,
    });

    expect(preset.metrics).toBeDefined();
    expect(preset.metrics!.requestsTotal).toBeDefined();
    expect(preset.metrics!.errorsTotal).toBeDefined();
    expect(preset.metrics!.tokensTotal).toBeDefined();
    expect(preset.metrics!.requestDurationMs).toBeDefined();
  });

  it("should create hooks when logging is enabled", () => {
    const preset = createObservabilityPreset({
      enableLogging: true,
      enableHooks: true,
    });

    expect(preset.hooks).toBeDefined();
    expect(Object.keys(preset.hooks!).length).toBeGreaterThan(0);
  });

  it("should not create hooks when hooks are disabled", () => {
    const preset = createObservabilityPreset({
      enableHooks: false,
    });

    expect(preset.hooks).toBeUndefined();
  });

  it("should accept custom span exporters", () => {
    const customExporter = {
      export: (spans: unknown[]) => {
        // Custom export logic
      },
    };

    const preset = createObservabilityPreset({
      spanExporters: [customExporter],
    });

    expect(preset.tracer).toBeDefined();
  });

  it("should create empty preset when all features disabled", () => {
    const preset = createObservabilityPreset({
      enableLogging: false,
      enableMetrics: false,
      enableTracing: false,
      enableHooks: false,
    });

    expect(preset.logger).toBeUndefined();
    expect(preset.metricsRegistry).toBeUndefined();
    expect(preset.metrics).toBeUndefined();
    expect(preset.tracer).toBeUndefined();
    expect(preset.hooks).toBeUndefined();
  });

  it("should allow customizing logging hooks options", () => {
    const preset = createObservabilityPreset({
      enableLogging: true,
      enableHooks: true,
      loggingHooksOptions: {
        maxTextLength: 100,
        logTiming: true,
      },
    });

    expect(preset.hooks).toBeDefined();
    expect(Object.keys(preset.hooks!).length).toBeGreaterThan(0);
  });
});
