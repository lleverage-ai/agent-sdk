# Observability

Built-in logging, metrics, and tracing support.

## Logging

```typescript
import {
  createLogger,
  createConsoleTransport,
  createJsonFormatter,
} from "@lleverage-ai/agent-sdk";

const logger = createLogger({
  level: "info",
  transports: [
    createConsoleTransport({
      formatter: createJsonFormatter(),
    }),
  ],
});

logger.info("Agent started", { agentId: "123" });
logger.warn("Rate limit approaching", { remaining: 10 });
logger.error("Request failed", { error: err.message });
```

### Log Levels

| Level | Description |
|-------|-------------|
| `debug` | Detailed debugging information |
| `info` | General operational information |
| `warn` | Warning conditions |
| `error` | Error conditions |

### Transports

```typescript
// Console transport
createConsoleTransport({
  formatter: createJsonFormatter(), // or createPrettyFormatter()
  level: "info", // Minimum level for this transport
});

// File transport
createFileTransport({
  filename: "agent.log",
  maxSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
  formatter: createJsonFormatter(),
});

// Custom transport
const customTransport = {
  log: (level, message, meta) => {
    // Send to external service
    externalLogger.send({ level, message, ...meta });
  },
};
```

## Metrics

```typescript
import {
  createMetricsRegistry,
  createAgentMetrics,
  createConsoleMetricsExporter,
} from "@lleverage-ai/agent-sdk";

const registry = createMetricsRegistry({
  exporters: [createConsoleMetricsExporter()],
});

const metrics = createAgentMetrics(registry);
metrics.requestsTotal.inc(1, { model: "claude-3" });
metrics.requestDurationMs.observe(1500, { model: "claude-3" });
```

### Built-in Agent Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `requestsTotal` | Counter | Total number of requests |
| `errorsTotal` | Counter | Total number of errors |
| `requestDurationMs` | Histogram | Request latency distribution |
| `tokensTotal` | Counter | Total tokens consumed |
| `toolCallsTotal` | Counter | Total tool invocations |
| `toolDurationMs` | Histogram | Tool latency distribution |
| `streamTimeToFirstTokenMs` | Histogram | Stream time-to-first-token |

### Custom Metrics

```typescript
// Counter
const myCounter = registry.createCounter({
  name: "my_counter",
  help: "Description of my counter",
  labels: ["label1", "label2"],
});
myCounter.inc({ label1: "value1", label2: "value2" });

// Gauge
const myGauge = registry.createGauge({
  name: "my_gauge",
  help: "Description of my gauge",
});
myGauge.set(42);
myGauge.inc();
myGauge.dec();

// Histogram
const myHistogram = registry.createHistogram({
  name: "my_histogram",
  help: "Description of my histogram",
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});
myHistogram.observe({}, 1.5);
```

### Metrics Exporters

```typescript
// Console exporter (for debugging)
createConsoleMetricsExporter({ interval: 10000 });

// Prometheus exporter
createPrometheusExporter({ port: 9090, path: "/metrics" });

// Custom exporter
const customExporter = {
  export: (metrics) => {
    // Send to external service
    datadog.send(metrics);
  },
};
```

## Tracing

```typescript
import {
  createTracer,
  createConsoleSpanExporter,
  SemanticAttributes,
} from "@lleverage-ai/agent-sdk";

const tracer = createTracer({
  serviceName: "my-agent",
  exporters: [createConsoleSpanExporter()],
});

const span = tracer.startSpan("agent.generate");
span.setAttribute(SemanticAttributes.MODEL_NAME, "claude-3");
// ... do work
span.end();
```

### Semantic Attributes

| Attribute | Description |
|-----------|-------------|
| `MODEL_NAME` | Name of the model used |
| `MODEL_PROVIDER` | Provider (anthropic, openai, etc.) |
| `PROMPT_TOKENS` | Number of prompt tokens |
| `COMPLETION_TOKENS` | Number of completion tokens |
| `TOOL_NAME` | Name of tool being called |
| `AGENT_NAME` | Name of the agent |
| `SUBAGENT_TYPE` | Type of subagent |
| `SUBAGENT_ID` | ID of subagent instance |

### Cross-Agent Tracing

Propagate trace context across parent and child agents:

```typescript
import {
  createAgent,
  createTaskTool,
  createSubagent,
  createTracer,
  SemanticAttributes,
} from "@lleverage-ai/agent-sdk";

const tracer = createTracer({
  name: "my-app",
  exporters: [createConsoleSpanExporter()],
});

// Start parent span
const parentSpan = tracer.startSpan("handle-user-request", {
  attributes: {
    [SemanticAttributes.AGENT_NAME]: "parent-agent",
  },
});

// Define subagent with tracing support
const researcherSubagent = {
  type: "researcher",
  description: "Researches information",
  create: (ctx) => {
    // Create child span linked to parent
    if (ctx.parentSpanContext) {
      const span = tracer.startSpan("subagent-research", {
        parent: ctx.parentSpanContext,
        attributes: {
          [SemanticAttributes.SUBAGENT_TYPE]: "researcher",
          [SemanticAttributes.SUBAGENT_ID]: "researcher-1",
        },
      });
      // Track span for cleanup
    }
    return createSubagent(parentAgent, {
      name: "researcher",
      systemPrompt: "You are a research assistant.",
    });
  },
};

// Create task tool with parent span context
const task = createTaskTool({
  subagents: [researcherSubagent],
  defaultModel: model,
  parentAgent,
  parentSpanContext: {
    traceId: parentSpan.traceId,
    spanId: parentSpan.spanId,
  },
});

// Use the agent
const result = await parentAgent.generate({
  prompt: "Research quantum computing",
  tools: { task },
});

parentSpan.end();
await tracer.flush();
```

This creates a distributed trace where both spans share the same `traceId`, allowing you to:

- Track the full request flow across agents
- Measure latency at each level
- Correlate logs and errors across parent and child operations
- Visualize the call graph in tools like Jaeger or Zipkin

## Observability Hooks

Automatically instrument agents with logging, metrics, and tracing:

```typescript
import {
  createObservabilityEventStore,
  createObservabilityEventHooks,
} from "@lleverage-ai/agent-sdk";

const store = createObservabilityEventStore();
const hooks = createObservabilityEventHooks(store);

const agent = createAgent({
  model,
  hooks: {
    MCPConnectionFailed: hooks.MCPConnectionFailed,
    MCPConnectionRestored: hooks.MCPConnectionRestored,
    ToolRegistered: hooks.ToolRegistered,
    ToolLoadError: hooks.ToolLoadError,
    PreCompact: hooks.PreCompact,
    PostCompact: hooks.PostCompact,
  },
});

// Query events
const events = store.getAll();
const mcpEvents = store.getByType("MCPConnectionFailed");
```

## Observability Preset

One-line setup for common observability needs:

```typescript
import {
  createConsoleTransport,
  createConsoleSpanExporter,
  createObservabilityPreset,
} from "@lleverage-ai/agent-sdk";

const { logger, metrics, tracer, hooks } = createObservabilityPreset({
  name: "my-agent",
  enableMetrics: true,
  enableTracing: true,
  loggerOptions: {
    level: "info",
    transports: [createConsoleTransport()],
  },
  spanExporters: [createConsoleSpanExporter()],
});

const agent = createAgent({
  model,
  hooks,
});
```

When `enableHooks` is left on, the preset now wires logging, metrics, and tracing hooks together. That means request counters, latency histograms, tool metrics, and spans are emitted automatically without extra manual hook registration.

## Execution Metadata

Generation results and generation/tool/subagent hook inputs now include SDK-generated execution metadata:

```typescript
const result = await agent.generate({
  prompt: "Summarize this",
  threadId: "thread_123",
});

console.log(result.telemetry?.threadId); // "thread_123"
console.log(result.telemetry?.runId); // Stable per-run ID
console.log(result.telemetry?.requestedModelId);
console.log(result.telemetry?.modelId);
```

This metadata is intended for correlation in logs, traces, audit events, and event stores. `threadId` and `runId` are intentionally not added as built-in metric labels because they are high-cardinality dimensions.

## Logging Hooks

Create logging hooks for all agent events:

```typescript
import { createLoggingHooks } from "@lleverage-ai/agent-sdk/hooks";

const agent = createAgent({
  model,
  hooks: createLoggingHooks({
    logger,
    logLevel: "info",
    includeToolInputs: true,
    includeToolOutputs: false, // Avoid logging large outputs
    redactPatterns: [/password/i, /secret/i],
  }),
});
```

## Production Observability Example

```typescript
import {
  createAgent,
  createLogger,
  createMetricsRegistry,
  createTracer,
  createLoggingHooks,
  createObservabilityEventHooks,
} from "@lleverage-ai/agent-sdk";

// Set up observability
const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  transports: [
    createJsonTransport({ stream: process.stdout }),
  ],
});

const metrics = createMetricsRegistry({
  exporters: [
    createPrometheusExporter({ port: 9090 }),
  ],
});

const tracer = createTracer({
  serviceName: "my-agent",
  exporters: [
    createOTLPExporter({ endpoint: process.env.OTLP_ENDPOINT }),
  ],
});

const eventStore = createObservabilityEventStore();

// Create agent with full observability
const agent = createAgent({
  model,
  hooks: {
    ...createLoggingHooks({ logger }),
    ...createObservabilityEventHooks(eventStore),
  },
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await tracer.flush();
  await metrics.flush();
  process.exit(0);
});
```
