/**
 * Tests for trace context propagation to subagents.
 *
 * Ensures that parent span context is correctly passed to subagents
 * for distributed tracing support.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { describe, expect, it } from "vitest";
import { createAgent } from "../src/agent.js";
import {
  createMemorySpanExporter,
  createTracer,
  SemanticAttributes,
} from "../src/observability/tracing.js";
import { createSubagent } from "../src/subagents.js";
import { createTaskTool } from "../src/tools/task.js";
import type { SubagentCreateContext, SubagentDefinition } from "../src/types.js";

describe("Trace Context Propagation", () => {
  it("should accept parentSpanContext in TaskToolOptions", () => {
    // Verify that TaskToolOptions accepts parentSpanContext
    const tracer = createTracer({ name: "test" });
    const parentSpan = tracer.startSpan("parent");
    const parentSpanContext = {
      traceId: parentSpan.traceId,
      spanId: parentSpan.spanId,
    };

    const testSubagent: SubagentDefinition = {
      type: "test",
      description: "Test subagent",
      create: (ctx: SubagentCreateContext) => {
        const model = anthropic("claude-3-5-haiku-20241022");
        const agent = createAgent({ model });
        return createSubagent(agent, {
          name: "test",
          systemPrompt: "Test",
        });
      },
    };

    const model = anthropic("claude-3-5-haiku-20241022");
    const parentAgent = createAgent({ model });

    // This should compile and not throw
    const taskTool = createTaskTool({
      subagents: [testSubagent],
      defaultModel: model,
      parentAgent,
      parentSpanContext, // Type-check that this is accepted
    });

    expect(taskTool).toBeDefined();
    parentSpan.end();
  });

  it("should include parentSpanContext in SubagentCreateContext type", () => {
    // This is a type-level test - if it compiles, it passes
    const testCreate = (ctx: SubagentCreateContext) => {
      // Verify ctx.parentSpanContext is available
      if (ctx.parentSpanContext) {
        // Access properties
        const traceId: string = ctx.parentSpanContext.traceId;
        const spanId: string = ctx.parentSpanContext.spanId;
        expect(typeof traceId).toBe("string");
        expect(typeof spanId).toBe("string");
      }

      const model = anthropic("claude-3-5-haiku-20241022");
      const agent = createAgent({ model });
      return createSubagent(agent, {
        name: "test",
        systemPrompt: "Test",
      });
    };

    // Call the function with mock context
    const mockContext: SubagentCreateContext = {
      model: anthropic("claude-3-5-haiku-20241022"),
      parentSpanContext: {
        traceId: "test-trace-id",
        spanId: "test-span-id",
      },
    };

    const result = testCreate(mockContext);
    expect(result).toBeDefined();
  });

  it("should create child spans with parent linkage", () => {
    const exporter = createMemorySpanExporter();
    const tracer = createTracer({
      name: "test-agent",
      exporters: [exporter],
    });

    // Create parent span
    const parentSpan = tracer.startSpan("parent-request", {
      attributes: {
        [SemanticAttributes.AGENT_NAME]: "parent-agent",
      },
    });

    // Create child span linked to parent
    const childSpan = tracer.startSpan("child-task", {
      parent: {
        traceId: parentSpan.traceId,
        spanId: parentSpan.spanId,
      },
      attributes: {
        [SemanticAttributes.SUBAGENT_TYPE]: "test-subagent",
      },
    });

    // End spans
    childSpan.end();
    parentSpan.end();

    // Verify linkage
    expect(childSpan.traceId).toBe(parentSpan.traceId);

    // Flush and check exported spans
    tracer.flush();

    expect(exporter.spans.length).toBe(2);
    const parentData = exporter.spans.find((s) => s.name === "parent-request");
    const childData = exporter.spans.find((s) => s.name === "child-task");

    expect(parentData).toBeDefined();
    expect(childData).toBeDefined();
    expect(childData!.traceId).toBe(parentData!.traceId);
    expect(childData!.parentSpanId).toBe(parentData!.spanId);
  });

  it("should support semantic attributes for subagents", () => {
    const exporter = createMemorySpanExporter();
    const tracer = createTracer({
      name: "test-agent",
      exporters: [exporter],
    });

    const parentSpan = tracer.startSpan("parent");
    const childSpan = tracer.startSpan("subagent-task", {
      parent: {
        traceId: parentSpan.traceId,
        spanId: parentSpan.spanId,
      },
      attributes: {
        [SemanticAttributes.SUBAGENT_TYPE]: "researcher",
        [SemanticAttributes.SUBAGENT_ID]: "subagent-123",
        [SemanticAttributes.SUBAGENT_PROMPT]: "Research topic",
        [SemanticAttributes.AGENT_NAME]: "researcher-agent",
      },
    });

    childSpan.end();
    parentSpan.end();
    tracer.flush();

    const childData = exporter.spans.find((s) => s.name === "subagent-task");
    expect(childData).toBeDefined();
    expect(childData!.attributes[SemanticAttributes.SUBAGENT_TYPE]).toBe("researcher");
    expect(childData!.attributes[SemanticAttributes.SUBAGENT_ID]).toBe("subagent-123");
    expect(childData!.attributes[SemanticAttributes.SUBAGENT_PROMPT]).toBe("Research topic");
    expect(childData!.attributes[SemanticAttributes.AGENT_NAME]).toBe("researcher-agent");
  });

  it("should work without parentSpanContext (backward compatibility)", () => {
    // Verify that TaskToolOptions works without parentSpanContext
    const testSubagent: SubagentDefinition = {
      type: "test",
      description: "Test subagent",
      create: (ctx: SubagentCreateContext) => {
        // ctx.parentSpanContext should be optional
        expect(ctx.parentSpanContext).toBeUndefined();

        const model = anthropic("claude-3-5-haiku-20241022");
        const agent = createAgent({ model });
        return createSubagent(agent, {
          name: "test",
          systemPrompt: "Test",
        });
      },
    };

    const model = anthropic("claude-3-5-haiku-20241022");
    const parentAgent = createAgent({ model });

    // Create without parentSpanContext
    const taskTool = createTaskTool({
      subagents: [testSubagent],
      defaultModel: model,
      parentAgent,
      // No parentSpanContext
    });

    expect(taskTool).toBeDefined();
  });

  it("should maintain trace hierarchy across multiple levels", () => {
    const exporter = createMemorySpanExporter();
    const tracer = createTracer({
      name: "test-agent",
      exporters: [exporter],
    });

    // Level 0: root span
    const rootSpan = tracer.startSpan("root-request");

    // Level 1: first child
    const level1Span = tracer.startSpan("level1-task", {
      parent: {
        traceId: rootSpan.traceId,
        spanId: rootSpan.spanId,
      },
    });

    // Level 2: grandchild
    const level2Span = tracer.startSpan("level2-task", {
      parent: {
        traceId: level1Span.traceId,
        spanId: level1Span.spanId,
      },
    });

    // End all spans
    level2Span.end();
    level1Span.end();
    rootSpan.end();

    tracer.flush();

    // All spans should share the same traceId
    expect(exporter.spans.length).toBe(3);
    expect(exporter.spans.every((s) => s.traceId === rootSpan.traceId)).toBe(true);

    // Verify parent-child relationships
    const rootData = exporter.spans.find((s) => s.name === "root-request");
    const level1Data = exporter.spans.find((s) => s.name === "level1-task");
    const level2Data = exporter.spans.find((s) => s.name === "level2-task");

    expect(level1Data!.parentSpanId).toBe(rootData!.spanId);
    expect(level2Data!.parentSpanId).toBe(level1Data!.spanId);
  });
});
