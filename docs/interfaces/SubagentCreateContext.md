[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentCreateContext

# Interface: SubagentCreateContext

Defined in: [packages/agent-sdk/src/types.ts:2524](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2524)

Context passed to subagent factory functions.

## Properties

### allowedTools?

> `optional` **allowedTools**: `string`[]

Defined in: [packages/agent-sdk/src/types.ts:2539](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2539)

Tool restrictions for this subagent, if any.
Comes from SubagentDefinition.allowedTools.

***

### model

> **model**: [`LanguageModel`](../type-aliases/LanguageModel.md)

Defined in: [packages/agent-sdk/src/types.ts:2533](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2533)

The resolved model to use for the subagent.

This is determined by priority:
1. SubagentDefinition.model (if not "inherit")
2. TaskToolOptions.defaultModel
3. Parent agent's model

***

### parentSpanContext?

> `optional` **parentSpanContext**: [`SpanContext`](SpanContext.md)

Defined in: [packages/agent-sdk/src/types.ts:2607](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2607)

Parent span context for distributed tracing.

When provided, the subagent should create child spans linked to
this parent span, enabling cross-agent trace correlation in
distributed tracing systems.

This allows you to track the full request flow across parent
and child agents in tools like Jaeger, Zipkin, or OpenTelemetry
collectors.

#### Example

```typescript
import { createTracer, SemanticAttributes } from "@lleverage-ai/agent-sdk";

const tracer = createTracer({ name: "my-agent" });

const subagentDef: SubagentDefinition = {
  type: "researcher",
  create: (ctx) => {
    const subagent = createSubagent(parentAgent, { ... });

    // Create child spans from parent context
    if (ctx.parentSpanContext) {
      const span = tracer.startSpan("subagent-execution", {
        parent: ctx.parentSpanContext,
        attributes: {
          [SemanticAttributes.SUBAGENT_TYPE]: "researcher",
        },
      });
      // ... perform work ...
      span.end();
    }

    return subagent;
  },
};
```

***

### plugins?

> `optional` **plugins**: [`PluginOptions`](PluginOptions.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2545](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2545)

Plugins to load for this subagent.
Comes from SubagentDefinition.plugins.

***

### streamingContext?

> `optional` **streamingContext**: [`StreamingContext`](StreamingContext.md)

Defined in: [packages/agent-sdk/src/types.ts:2566](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2566)

Streaming context from the parent agent.

Only provided when SubagentDefinition.streaming is true and the
parent agent is using streamDataResponse(). Allows the subagent
to write custom data directly to the parent's data stream.

The context includes metadata identifying this subagent as the
source of any streamed data.

#### Example

```typescript
create: (ctx) => {
  // Subagent can pass streaming context to its tools
  const tools = createStreamingTools(ctx.streamingContext);
  return createSubagent(parent, { tools });
}
```
