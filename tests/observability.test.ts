/**
 * Tests for the Observability module.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createAgentMetrics,
  createCallbackMetricsExporter,
  createCallbackTransport,
  createFilteredTransport,
  createJsonFormatter,
  // Logger
  createLogger,
  createMemoryMetricsExporter,
  createMemorySpanExporter,
  createMemoryTransport,
  // Metrics
  createMetricsRegistry,
  createOTLPSpanExporter,
  createPrettyFormatter,
  // Tracing
  createTracer,
  DEFAULT_LATENCY_BUCKETS,
  DEFAULT_TOKEN_BUCKETS,
  defaultLogger,
  defaultMetricsRegistry,
  defaultTracer,
  LOG_LEVEL_VALUES,
  SemanticAttributes,
  setDefaultLogger,
  setDefaultMetricsRegistry,
  setDefaultTracer,
} from "../src/observability/index.js";

// =============================================================================
// Logger Tests
// =============================================================================

describe("Logger", () => {
  describe("createLogger", () => {
    it("creates a logger with default options", () => {
      const logger = createLogger();
      expect(logger.name).toBe("agent");
      expect(logger.level).toBe("info");
    });

    it("creates a logger with custom name and level", () => {
      const logger = createLogger({ name: "test", level: "debug" });
      expect(logger.name).toBe("test");
      expect(logger.level).toBe("debug");
    });

    it("logs at different levels", () => {
      const entries: unknown[] = [];
      const transport = createCallbackTransport((entry) => entries.push(entry));
      const logger = createLogger({
        level: "debug",
        transports: [transport],
      });

      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      expect(entries).toHaveLength(4);
    });

    it("filters by log level", () => {
      const entries: unknown[] = [];
      const transport = createCallbackTransport((entry) => entries.push(entry));
      const logger = createLogger({
        level: "warn",
        transports: [transport],
      });

      logger.debug("debug");
      logger.info("info");
      logger.warn("warn");
      logger.error("error");

      expect(entries).toHaveLength(2);
    });

    it("includes context in log entries", () => {
      const memoryTransport = createMemoryTransport();
      const logger = createLogger({
        level: "debug",
        transports: [memoryTransport],
      });

      logger.info("test", { key: "value" });

      expect(memoryTransport.entries).toHaveLength(1);
      expect(memoryTransport.entries[0].context).toEqual({ key: "value" });
    });

    it("includes error in error logs", () => {
      const memoryTransport = createMemoryTransport();
      const logger = createLogger({
        level: "debug",
        transports: [memoryTransport],
      });

      const error = new Error("test error");
      logger.error("failed", error);

      expect(memoryTransport.entries).toHaveLength(1);
      expect(memoryTransport.entries[0].error).toBe(error);
    });

    it("creates child loggers with namespace", () => {
      const memoryTransport = createMemoryTransport();
      const logger = createLogger({
        name: "parent",
        transports: [memoryTransport],
      });

      const child = logger.child("child");
      child.info("test");

      expect(child.name).toBe("parent:child");
      expect(memoryTransport.entries[0].logger).toBe("parent:child");
    });

    it("creates child loggers with additional context", () => {
      const memoryTransport = createMemoryTransport();
      const logger = createLogger({
        name: "parent",
        context: { base: true },
        transports: [memoryTransport],
      });

      const child = logger.child({ extra: "value" });
      child.info("test");

      expect(memoryTransport.entries[0].context).toEqual({
        base: true,
        extra: "value",
      });
    });

    it("times operations", async () => {
      const memoryTransport = createMemoryTransport();
      const logger = createLogger({
        transports: [memoryTransport],
      });

      const timer = logger.startTimer("operation");
      await new Promise((resolve) => setTimeout(resolve, 15));
      timer.end();

      expect(memoryTransport.entries).toHaveLength(1);
      // Allow some tolerance for timer precision (setTimeout can complete slightly early)
      expect(memoryTransport.entries[0].durationMs).toBeGreaterThanOrEqual(10);
    });
  });

  describe("LOG_LEVEL_VALUES", () => {
    it("has correct ordering", () => {
      expect(LOG_LEVEL_VALUES.debug).toBeLessThan(LOG_LEVEL_VALUES.info);
      expect(LOG_LEVEL_VALUES.info).toBeLessThan(LOG_LEVEL_VALUES.warn);
      expect(LOG_LEVEL_VALUES.warn).toBeLessThan(LOG_LEVEL_VALUES.error);
    });
  });

  describe("createJsonFormatter", () => {
    it("formats entries as JSON", () => {
      const formatter = createJsonFormatter();
      const entry = {
        level: "info" as const,
        message: "test",
        timestamp: "2024-01-01T00:00:00.000Z",
        logger: "test",
      };

      const output = formatter.format(entry);
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe("info");
      expect(parsed.message).toBe("test");
    });
  });

  describe("createPrettyFormatter", () => {
    it("formats entries with colors by default", () => {
      const formatter = createPrettyFormatter();
      const entry = {
        level: "info" as const,
        message: "test message",
        timestamp: "2024-01-01T00:00:00.000Z",
      };

      const output = formatter.format(entry);
      expect(output).toContain("test message");
    });

    it("formats entries without colors when disabled", () => {
      const formatter = createPrettyFormatter({ colors: false });
      const entry = {
        level: "info" as const,
        message: "test",
        timestamp: "2024-01-01T00:00:00.000Z",
      };

      const output = formatter.format(entry);
      expect(output).not.toContain("\x1b[");
    });
  });

  describe("createMemoryTransport", () => {
    it("stores entries", () => {
      const transport = createMemoryTransport();
      transport.write({
        level: "info",
        message: "test",
        timestamp: new Date().toISOString(),
      });

      expect(transport.entries).toHaveLength(1);
    });

    it("respects max entries limit", () => {
      const transport = createMemoryTransport({ maxEntries: 2 });
      for (let i = 0; i < 5; i++) {
        transport.write({
          level: "info",
          message: `test ${i}`,
          timestamp: new Date().toISOString(),
        });
      }

      expect(transport.entries).toHaveLength(2);
      expect(transport.entries[0].message).toBe("test 3");
    });

    it("clears entries", () => {
      const transport = createMemoryTransport();
      transport.write({
        level: "info",
        message: "test",
        timestamp: new Date().toISOString(),
      });
      transport.clear();

      expect(transport.entries).toHaveLength(0);
    });
  });

  describe("createFilteredTransport", () => {
    it("filters entries based on predicate", () => {
      const memoryTransport = createMemoryTransport();
      const filteredTransport = createFilteredTransport(
        memoryTransport,
        (entry) => entry.level === "error",
      );

      filteredTransport.write({
        level: "info",
        message: "info",
        timestamp: new Date().toISOString(),
      });
      filteredTransport.write({
        level: "error",
        message: "error",
        timestamp: new Date().toISOString(),
      });

      expect(memoryTransport.entries).toHaveLength(1);
      expect(memoryTransport.entries[0].level).toBe("error");
    });
  });

  describe("defaultLogger", () => {
    it("exists and can be replaced", () => {
      expect(defaultLogger).toBeDefined();
      const custom = createLogger({ name: "custom" });
      setDefaultLogger(custom);
      expect(defaultLogger.name).toBe("custom");
    });
  });
});

// =============================================================================
// Metrics Tests
// =============================================================================

describe("Metrics", () => {
  describe("createMetricsRegistry", () => {
    it("creates counters", () => {
      const registry = createMetricsRegistry();
      const counter = registry.counter("test_counter");

      counter.inc();
      counter.inc(5);

      expect(counter.get()).toBe(6);
    });

    it("creates gauges", () => {
      const registry = createMetricsRegistry();
      const gauge = registry.gauge("test_gauge");

      gauge.set(10);
      expect(gauge.get()).toBe(10);

      gauge.inc(5);
      expect(gauge.get()).toBe(15);

      gauge.dec(3);
      expect(gauge.get()).toBe(12);
    });

    it("creates histograms", () => {
      const registry = createMetricsRegistry();
      const histogram = registry.histogram("test_histogram", [10, 50, 100]);

      histogram.observe(5);
      histogram.observe(25);
      histogram.observe(75);
      histogram.observe(150);

      const data = histogram.get();
      expect(data.count).toBe(4);
      expect(data.sum).toBe(255);
      expect(data.buckets[0].count).toBe(1); // <= 10
      expect(data.buckets[1].count).toBe(2); // <= 50
      expect(data.buckets[2].count).toBe(3); // <= 100
    });

    it("times histogram observations", async () => {
      const registry = createMetricsRegistry();
      const histogram = registry.histogram("test_duration", [50, 100, 200]);

      const endTimer = histogram.startTimer();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const duration = endTimer();

      expect(duration).toBeGreaterThanOrEqual(10);
      expect(histogram.get().count).toBe(1);
    });

    it("applies prefix to metric names", () => {
      const registry = createMetricsRegistry({ prefix: "myapp" });
      registry.counter("requests");

      const metrics = registry.getMetrics();
      expect(metrics.some((m) => m.name === "myapp_requests")).toBe(true);
    });

    it("applies default labels", () => {
      const registry = createMetricsRegistry({
        defaultLabels: { env: "test" },
      });
      registry.counter("test").inc();

      const metrics = registry.getMetrics();
      expect(metrics[0].labels.env).toBe("test");
    });
  });

  describe("DEFAULT_LATENCY_BUCKETS", () => {
    it("has reasonable latency buckets", () => {
      expect(DEFAULT_LATENCY_BUCKETS).toContain(100);
      expect(DEFAULT_LATENCY_BUCKETS).toContain(1000);
    });
  });

  describe("DEFAULT_TOKEN_BUCKETS", () => {
    it("has reasonable token buckets", () => {
      expect(DEFAULT_TOKEN_BUCKETS).toContain(100);
      expect(DEFAULT_TOKEN_BUCKETS).toContain(1000);
    });
  });

  describe("createAgentMetrics", () => {
    it("creates all agent metrics", () => {
      const registry = createMetricsRegistry();
      const metrics = createAgentMetrics(registry);

      expect(metrics.requestsTotal).toBeDefined();
      expect(metrics.requestsInProgress).toBeDefined();
      expect(metrics.requestDurationMs).toBeDefined();
      expect(metrics.inputTokensTotal).toBeDefined();
      expect(metrics.outputTokensTotal).toBeDefined();
      expect(metrics.tokensTotal).toBeDefined();
      expect(metrics.toolCallsTotal).toBeDefined();
      expect(metrics.toolErrorsTotal).toBeDefined();
      expect(metrics.subagentSpawnsTotal).toBeDefined();
      expect(metrics.errorsTotal).toBeDefined();
    });
  });

  describe("createMemoryMetricsExporter", () => {
    it("stores exported metrics", async () => {
      const exporter = createMemoryMetricsExporter();
      const registry = createMetricsRegistry({ exporters: [exporter] });

      registry.counter("test").inc();
      await registry.export();

      expect(exporter.metrics.length).toBeGreaterThan(0);
    });
  });

  describe("createCallbackMetricsExporter", () => {
    it("calls callback on export", async () => {
      const callback = vi.fn();
      const exporter = createCallbackMetricsExporter(callback);
      const registry = createMetricsRegistry({ exporters: [exporter] });

      registry.counter("test").inc();
      await registry.export();

      expect(callback).toHaveBeenCalled();
    });
  });

  describe("defaultMetricsRegistry", () => {
    it("exists and can be replaced", () => {
      expect(defaultMetricsRegistry).toBeDefined();
      const custom = createMetricsRegistry({ prefix: "custom" });
      setDefaultMetricsRegistry(custom);
      expect(defaultMetricsRegistry).toBe(custom);
    });
  });
});

// =============================================================================
// Tracing Tests
// =============================================================================

describe("Tracing", () => {
  describe("createTracer", () => {
    it("creates a tracer with default options", () => {
      const tracer = createTracer();
      expect(tracer.name).toBe("agent");
      expect(tracer.enabled).toBe(true);
    });

    it("creates spans", () => {
      const tracer = createTracer();
      const span = tracer.startSpan("test");

      expect(span.name).toBe("test");
      expect(span.traceId).toHaveLength(32);
      expect(span.spanId).toHaveLength(16);
      expect(span.isRecording()).toBe(true);
    });

    it("ends spans and exports", async () => {
      const exporter = createMemorySpanExporter();
      const tracer = createTracer({ exporters: [exporter] });

      const span = tracer.startSpan("test");
      span.end();
      await tracer.flush();

      expect(exporter.spans).toHaveLength(1);
      expect(exporter.spans[0].name).toBe("test");
    });

    it("sets span attributes", async () => {
      const exporter = createMemorySpanExporter();
      const tracer = createTracer({ exporters: [exporter] });

      const span = tracer.startSpan("test");
      span.setAttribute("key", "value");
      span.setAttributes({ num: 42, bool: true });
      span.end();
      await tracer.flush();

      expect(exporter.spans[0].attributes.key).toBe("value");
      expect(exporter.spans[0].attributes.num).toBe(42);
      expect(exporter.spans[0].attributes.bool).toBe(true);
    });

    it("adds span events", async () => {
      const exporter = createMemorySpanExporter();
      const tracer = createTracer({ exporters: [exporter] });

      const span = tracer.startSpan("test");
      span.addEvent("something_happened", { detail: "info" });
      span.end();
      await tracer.flush();

      expect(exporter.spans[0].events).toHaveLength(1);
      expect(exporter.spans[0].events[0].name).toBe("something_happened");
    });

    it("records exceptions", async () => {
      const exporter = createMemorySpanExporter();
      const tracer = createTracer({ exporters: [exporter] });

      const span = tracer.startSpan("test");
      span.recordException(new Error("test error"));
      span.end();
      await tracer.flush();

      expect(exporter.spans[0].status.code).toBe("error");
      expect(exporter.spans[0].events[0].name).toBe("exception");
    });

    it("links parent and child spans", async () => {
      const exporter = createMemorySpanExporter();
      const tracer = createTracer({ exporters: [exporter] });

      const parent = tracer.startSpan("parent");
      const child = tracer.startSpan("child", {
        parent: { traceId: parent.traceId, spanId: parent.spanId },
      });

      child.end();
      parent.end();
      await tracer.flush();

      expect(exporter.spans[0].parentSpanId).toBe(parent.spanId);
      expect(exporter.spans[0].traceId).toBe(parent.traceId);
    });

    it("executes withSpan", async () => {
      const exporter = createMemorySpanExporter();
      const tracer = createTracer({ exporters: [exporter] });

      const result = await tracer.withSpan("operation", async (span) => {
        span.setAttribute("inside", true);
        return 42;
      });

      await tracer.flush();

      expect(result).toBe(42);
      expect(exporter.spans[0].status.code).toBe("ok");
    });

    it("handles withSpan errors", async () => {
      const exporter = createMemorySpanExporter();
      const tracer = createTracer({ exporters: [exporter] });

      await expect(
        tracer.withSpan("operation", async () => {
          throw new Error("test");
        }),
      ).rejects.toThrow("test");

      await tracer.flush();

      expect(exporter.spans[0].status.code).toBe("error");
    });

    it("respects sampling rate", async () => {
      const exporter = createMemorySpanExporter();
      const tracer = createTracer({
        exporters: [exporter],
        samplingRate: 0, // Never sample
      });

      const span = tracer.startSpan("test");
      span.end();
      await tracer.flush();

      expect(exporter.spans).toHaveLength(0);
    });

    it("returns noop span when disabled", () => {
      const tracer = createTracer({ enabled: false });
      const span = tracer.startSpan("test");

      expect(span.isRecording()).toBe(false);
    });
  });

  describe("createOTLPSpanExporter", () => {
    it("formats spans as OTLP payload", async () => {
      let payload: unknown;
      const exporter = createOTLPSpanExporter({
        serviceName: "test-service",
        onExport: (p) => {
          payload = p;
        },
      });

      await exporter.export([
        {
          traceId: "12345678901234567890123456789012",
          spanId: "1234567890123456",
          name: "test",
          kind: "internal",
          startTime: "2024-01-01T00:00:00.000Z",
          endTime: "2024-01-01T00:00:01.000Z",
          durationMs: 1000,
          attributes: { key: "value" },
          events: [],
          links: [],
          status: { code: "ok" },
        },
      ]);

      expect(payload).toBeDefined();
      expect((payload as { resourceSpans: unknown[] }).resourceSpans).toHaveLength(1);
    });
  });

  describe("SemanticAttributes", () => {
    it("has standard attribute keys", () => {
      expect(SemanticAttributes.SERVICE_NAME).toBe("service.name");
      expect(SemanticAttributes.GEN_AI_USAGE_INPUT_TOKENS).toBe("gen_ai.usage.input_tokens");
      expect(SemanticAttributes.TOOL_NAME).toBe("tool.name");
    });
  });

  describe("defaultTracer", () => {
    it("exists and can be replaced", () => {
      expect(defaultTracer).toBeDefined();
      const custom = createTracer({ name: "custom" });
      setDefaultTracer(custom);
      expect(defaultTracer.name).toBe("custom");
    });
  });
});
