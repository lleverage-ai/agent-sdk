[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / TaskToolOptions\_Tool

# Interface: TaskToolOptions\_Tool

Defined in: [packages/agent-sdk/src/tools/task.ts:42](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L42)

Options for creating the task tool.

## Properties

### defaultMaxTurns?

> `optional` **defaultMaxTurns**: `number`

Defined in: [packages/agent-sdk/src/tools/task.ts:52](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L52)

Default max turns for subagents

***

### defaultModel

> **defaultModel**: [`LanguageModel`](../type-aliases/LanguageModel.md)

Defined in: [packages/agent-sdk/src/tools/task.ts:46](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L46)

Default model for subagents that don't specify one

***

### description?

> `optional` **description**: `string`

Defined in: [packages/agent-sdk/src/tools/task.ts:50](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L50)

Custom tool description

***

### generalPurposeModel?

> `optional` **generalPurposeModel**: [`LanguageModel`](../type-aliases/LanguageModel.md)

Defined in: [packages/agent-sdk/src/tools/task.ts:56](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L56)

Model to use for general-purpose subagent

***

### generalPurposePrompt?

> `optional` **generalPurposePrompt**: `string`

Defined in: [packages/agent-sdk/src/tools/task.ts:58](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L58)

System prompt for general-purpose subagent

***

### includeGeneralPurpose?

> `optional` **includeGeneralPurpose**: `boolean`

Defined in: [packages/agent-sdk/src/tools/task.ts:54](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L54)

Include a general-purpose subagent automatically

***

### parentAgent

> **parentAgent**: [`Agent`](Agent.md)

Defined in: [packages/agent-sdk/src/tools/task.ts:48](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L48)

Parent agent for creating subagents

***

### parentSpanContext?

> `optional` **parentSpanContext**: [`SpanContext`](SpanContext.md)

Defined in: [packages/agent-sdk/src/tools/task.ts:134](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L134)

Parent span context for distributed tracing.

When provided, subagents will create child spans linked to this parent
span, enabling cross-agent trace correlation. This allows full request
tracing across parent and child agents in distributed tracing systems.

#### Example

```typescript
import { createTracer } from "@lleverage-ai/agent-sdk";

const tracer = createTracer({ name: "parent-agent" });
const span = tracer.startSpan("handle-request");

const task = createTaskTool({
  subagents,
  defaultModel,
  parentAgent,
  parentSpanContext: {
    traceId: span.traceId,
    spanId: span.spanId,
  },
});
```

***

### streamingContext?

> `optional` **streamingContext**: [`StreamingContext`](StreamingContext.md)

Defined in: [packages/agent-sdk/src/tools/task.ts:81](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L81)

Streaming context from the parent agent.

When provided, streaming subagents (those with `streaming: true`) can
write custom data directly to the parent's data stream. This enables
progressive rendering, real-time updates, and structured data streaming.

Typically set when the parent agent is using `streamDataResponse()`.

#### Example

```typescript
// In agent.ts streamDataResponse
const streamingContext: StreamingContext = { writer };
const task = createTaskTool({
  subagents,
  defaultModel,
  parentAgent,
  streamingContext, // Pass to enable streaming subagents
});
```

***

### subagents

> **subagents**: [`SubagentDefinition`](SubagentDefinition.md)[]

Defined in: [packages/agent-sdk/src/tools/task.ts:44](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L44)

Available subagent definitions

***

### taskStore?

> `optional` **taskStore**: [`BaseTaskStore`](BaseTaskStore.md)

Defined in: [packages/agent-sdk/src/tools/task.ts:107](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/task.ts#L107)

Task store for persisting background task state.

When provided, background tasks will be persisted and can be recovered
across process restarts. Without a task store, tasks are kept in memory
only and lost when the process exits.

#### Example

```typescript
import { FileTaskStore } from "@lleverage-ai/agent-sdk/task-store";

const taskStore = new FileTaskStore({
  directory: "./task-data",
  expirationMs: 86400000, // 24 hours
});

const task = createTaskTool({
  subagents,
  defaultModel,
  parentAgent,
  taskStore, // Tasks now persist across restarts
});
```
