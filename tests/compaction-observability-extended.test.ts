import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompactionLoggingHooks,
  createComprehensiveLoggingHooks,
} from "../src/hooks/logging.js";
import {
  createObservabilityEventHooks,
  createObservabilityEventStore,
  exportEventsJSONLines,
  exportEventsPrometheus,
  toStructuredEvent,
} from "../src/observability/events.js";
import {
  createAgentMetrics,
  createMetricsHooks,
  createMetricsRegistry,
} from "../src/observability/metrics.js";
import type { PostCompactInput, PreCompactInput } from "../src/types.js";

describe("Compaction Logging Hooks", () => {
  const hookContext = {
    signal: new AbortController().signal,
    agent: {} as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should log PreCompact events", async () => {
    const logs: string[] = [];
    const [preCompactHook] = createCompactionLoggingHooks({
      log: (msg) => logs.push(msg),
      prefix: "[Test]",
    });

    const input: PreCompactInput = {
      hook_event_name: "PreCompact",
      session_id: "test-session",
      cwd: "/test",
      message_count: 10,
      tokens_before: 5000,
    };

    await preCompactHook(input, null, hookContext);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("[Test] PreCompact:");
    expect(logs[0]).toContain("Messages: 10");
    expect(logs[0]).toContain("Tokens: 5000");
  });

  it("should log PostCompact events with reduction percentage", async () => {
    const logs: string[] = [];
    const [, postCompactHook] = createCompactionLoggingHooks({
      log: (msg) => logs.push(msg),
      prefix: "[Test]",
      logTiming: false,
    });

    const input: PostCompactInput = {
      hook_event_name: "PostCompact",
      session_id: "test-session",
      cwd: "/test",
      messages_before: 10,
      messages_after: 3,
      tokens_before: 5000,
      tokens_after: 2000,
      tokens_saved: 3000,
    };

    await postCompactHook(input, null, hookContext);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("[Test] PostCompact:");
    expect(logs[0]).toContain("Messages: 10 → 3");
    expect(logs[0]).toContain("Tokens: 5000 → 2000");
    expect(logs[0]).toContain("saved 3000");
    expect(logs[0]).toContain("60.0% reduction");
  });

  it("should track timing between PreCompact and PostCompact", async () => {
    const logs: string[] = [];
    const [preCompactHook, postCompactHook] = createCompactionLoggingHooks({
      log: (msg) => logs.push(msg),
      logTiming: true,
    });

    const preInput: PreCompactInput = {
      hook_event_name: "PreCompact",
      session_id: "timed-session",
      cwd: "/test",
      message_count: 10,
      tokens_before: 5000,
    };

    await preCompactHook(preInput, null, hookContext);

    // Simulate some processing time
    await new Promise((resolve) => setTimeout(resolve, 10));

    const postInput: PostCompactInput = {
      hook_event_name: "PostCompact",
      session_id: "timed-session",
      cwd: "/test",
      messages_before: 10,
      messages_after: 3,
      tokens_before: 5000,
      tokens_after: 2000,
      tokens_saved: 3000,
    };

    await postCompactHook(postInput, null, hookContext);

    expect(logs).toHaveLength(2);
    expect(logs[1]).toContain("Duration:");
    expect(logs[1]).toMatch(/Duration: \d+ms/);
  });

  it("should respect logCompaction: false option", async () => {
    const logs: string[] = [];
    const [preCompactHook, postCompactHook] = createCompactionLoggingHooks({
      log: (msg) => logs.push(msg),
      logCompaction: false,
    });

    const preInput: PreCompactInput = {
      hook_event_name: "PreCompact",
      session_id: "test-session",
      cwd: "/test",
      message_count: 10,
      tokens_before: 5000,
    };

    const postInput: PostCompactInput = {
      hook_event_name: "PostCompact",
      session_id: "test-session",
      cwd: "/test",
      messages_before: 10,
      messages_after: 3,
      tokens_before: 5000,
      tokens_after: 2000,
      tokens_saved: 3000,
    };

    await preCompactHook(preInput, null, hookContext);
    await postCompactHook(postInput, null, hookContext);

    expect(logs).toHaveLength(0);
  });

  it("should include compaction hooks in createComprehensiveLoggingHooks", () => {
    const { generationHooks, toolHooks, compactionHooks } = createComprehensiveLoggingHooks();

    expect(generationHooks).toHaveLength(3);
    expect(toolHooks).toHaveLength(3);
    expect(compactionHooks).toHaveLength(2);
  });
});

describe("Compaction Observability Events", () => {
  it("should convert PreCompact to structured event", () => {
    const input: PreCompactInput = {
      hook_event_name: "PreCompact",
      session_id: "test-session",
      cwd: "/test",
      message_count: 10,
      tokens_before: 5000,
    };

    const structured = toStructuredEvent(input);

    expect(structured.event_type).toBe("context_compaction_started");
    expect(structured.severity).toBe("info");
    expect(structured.message).toContain("10 messages");
    expect(structured.message).toContain("5000 tokens");
    expect(structured.metadata.message_count).toBe(10);
    expect(structured.metadata.tokens_before).toBe(5000);
    expect(structured.session_id).toBe("test-session");
  });

  it("should convert PostCompact to structured event with reduction", () => {
    const input: PostCompactInput = {
      hook_event_name: "PostCompact",
      session_id: "test-session",
      cwd: "/test",
      messages_before: 10,
      messages_after: 3,
      tokens_before: 5000,
      tokens_after: 2000,
      tokens_saved: 3000,
    };

    const structured = toStructuredEvent(input);

    expect(structured.event_type).toBe("context_compaction_completed");
    expect(structured.severity).toBe("info");
    expect(structured.message).toContain("10 → 3 messages");
    expect(structured.message).toContain("saved 3000 tokens");
    expect(structured.message).toContain("60.0%");
    expect(structured.metadata.messages_before).toBe(10);
    expect(structured.metadata.messages_after).toBe(3);
    expect(structured.metadata.tokens_saved).toBe(3000);
    expect(structured.metadata.reduction_percent).toBe(60.0);
  });

  it("should add compaction events to event store", () => {
    const store = createObservabilityEventStore();
    const hooks = createObservabilityEventHooks(store);

    expect(hooks.PreCompact).toBeDefined();
    expect(hooks.PostCompact).toBeDefined();

    const preInput: PreCompactInput = {
      hook_event_name: "PreCompact",
      session_id: "test-session",
      cwd: "/test",
      message_count: 10,
      tokens_before: 5000,
    };

    const postInput: PostCompactInput = {
      hook_event_name: "PostCompact",
      session_id: "test-session",
      cwd: "/test",
      messages_before: 10,
      messages_after: 3,
      tokens_before: 5000,
      tokens_after: 2000,
      tokens_saved: 3000,
    };

    store.add(preInput);
    store.add(postInput);

    expect(store.size()).toBe(2);
    expect(store.getByType("PreCompact")).toHaveLength(1);
    expect(store.getByType("PostCompact")).toHaveLength(1);
  });

  it("should export compaction events to JSON Lines", () => {
    const preInput: PreCompactInput = {
      hook_event_name: "PreCompact",
      session_id: "test-session",
      cwd: "/test",
      message_count: 10,
      tokens_before: 5000,
    };

    const postInput: PostCompactInput = {
      hook_event_name: "PostCompact",
      session_id: "test-session",
      cwd: "/test",
      messages_before: 10,
      messages_after: 3,
      tokens_before: 5000,
      tokens_after: 2000,
      tokens_saved: 3000,
    };

    const jsonl = exportEventsJSONLines([preInput, postInput]);
    const lines = jsonl.split("\n");

    expect(lines).toHaveLength(2);

    const preEvent = JSON.parse(lines[0]!);
    expect(preEvent.event_type).toBe("context_compaction_started");

    const postEvent = JSON.parse(lines[1]!);
    expect(postEvent.event_type).toBe("context_compaction_completed");
  });

  it("should export compaction metrics to Prometheus format", () => {
    const postInput: PostCompactInput = {
      hook_event_name: "PostCompact",
      session_id: "test-session",
      cwd: "/test",
      messages_before: 10,
      messages_after: 3,
      tokens_before: 5000,
      tokens_after: 2000,
      tokens_saved: 3000,
    };

    const metrics = exportEventsPrometheus([postInput]);

    expect(metrics).toContain("context_compactions_total 1");
    expect(metrics).toContain("context_compaction_tokens_saved_total 3000");
    expect(metrics).toContain("context_compaction_messages_removed_total 7");
  });
});

describe("Compaction Metrics Hooks", () => {
  const metricsHookContext = {
    signal: new AbortController().signal,
    agent: {} as any,
  };
  it("should increment compactionsTotal on PostCompact", async () => {
    const registry = createMetricsRegistry();
    const metrics = createAgentMetrics(registry);
    const hooks = createMetricsHooks(metrics);

    expect(metrics.compactionsTotal.get()).toBe(0);

    const input: PostCompactInput = {
      hook_event_name: "PostCompact",
      session_id: "test-session",
      cwd: "/test",
      messages_before: 10,
      messages_after: 3,
      tokens_before: 5000,
      tokens_after: 2000,
      tokens_saved: 3000,
    };

    await hooks.PostCompact(input, null, metricsHookContext);

    expect(metrics.compactionsTotal.get()).toBe(1);
  });

  it("should accumulate multiple compactions", async () => {
    const registry = createMetricsRegistry();
    const metrics = createAgentMetrics(registry);
    const hooks = createMetricsHooks(metrics);

    const input: PostCompactInput = {
      hook_event_name: "PostCompact",
      session_id: "test-session",
      cwd: "/test",
      messages_before: 10,
      messages_after: 3,
      tokens_before: 5000,
      tokens_after: 2000,
      tokens_saved: 3000,
    };

    await hooks.PostCompact(input, null, metricsHookContext);
    await hooks.PostCompact(input, null, metricsHookContext);
    await hooks.PostCompact(input, null, metricsHookContext);

    expect(metrics.compactionsTotal.get()).toBe(3);
  });

  it("should ignore non-PostCompact events", async () => {
    const registry = createMetricsRegistry();
    const metrics = createAgentMetrics(registry);
    const hooks = createMetricsHooks(metrics);

    const input: PreCompactInput = {
      hook_event_name: "PreCompact",
      session_id: "test-session",
      cwd: "/test",
      message_count: 10,
      tokens_before: 5000,
    };

    // PostCompact hook should ignore PreCompact input
    await hooks.PostCompact(input as unknown as PostCompactInput, null, metricsHookContext);

    expect(metrics.compactionsTotal.get()).toBe(0);
  });
});
