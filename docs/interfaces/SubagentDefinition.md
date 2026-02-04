[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentDefinition

# Interface: SubagentDefinition

Defined in: [packages/agent-sdk/src/types.ts:2374](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2374)

Definition of a subagent type for task delegation.

## Properties

### allowedTools?

> `optional` **allowedTools**: `string`[]

Defined in: [packages/agent-sdk/src/types.ts:2429](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2429)

Restrict which tools this subagent can use.

When provided, only the specified tools will be available to
the subagent, even if more tools are available in the parent.
This provides security and context control for delegated tasks.

#### Example

```typescript
const subagents = [
  {
    type: "reader",
    description: "Read-only research agent",
    allowedTools: ["read", "glob", "grep"],  // No write access
  },
  {
    type: "coder",
    description: "Code writing agent",
    allowedTools: ["read", "write", "edit", "bash"],
  },
];
```

***

### create()

> **create**: (`context`: [`SubagentCreateContext`](SubagentCreateContext.md)) => [`Agent`](Agent.md) \| `Promise`&lt;[`Agent`](Agent.md)&gt;

Defined in: [packages/agent-sdk/src/types.ts:2516](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2516)

Factory function to create the subagent.

Receives a context object containing the resolved model and any
tool restrictions. Use these values when calling createSubagent.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `context` | [`SubagentCreateContext`](SubagentCreateContext.md) | Context for subagent creation |

#### Returns

[`Agent`](Agent.md) \| `Promise`&lt;[`Agent`](Agent.md)&gt;

The subagent instance

#### Example

```typescript
const subagents = [
  {
    type: "researcher",
    description: "Research agent",
    model: anthropic("claude-haiku-4.5"),
    allowedTools: ["read", "glob", "grep"],
    create: (ctx) => createSubagent(parentAgent, {
      name: "researcher",
      description: "Research agent",
      model: ctx.model,  // Use resolved model
      allowedTools: ctx.allowedTools,  // Use tool restrictions
    }),
  },
];
```

***

### description

> **description**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2379](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2379)

Description of what this subagent specializes in

***

### model?

> `optional` **model**: `"inherit"` \| [`LanguageModel`](../type-aliases/LanguageModel.md)

Defined in: [packages/agent-sdk/src/types.ts:2404](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2404)

Model to use for this subagent.

- If not specified, inherits from parent agent
- Use `"inherit"` to explicitly inherit from parent
- Provide a LanguageModel instance to override

#### Example

```typescript
const subagents = [
  {
    type: "fast-researcher",
    description: "Quick research tasks",
    model: anthropic("claude-haiku-4.5"),  // Use faster model
  },
  {
    type: "deep-analyst",
    description: "Complex analysis",
    model: anthropic("claude-sonnet-4-20250514"),  // Use more capable model
  },
];
```

***

### plugins?

> `optional` **plugins**: [`PluginOptions`](PluginOptions.md)[]

Defined in: [packages/agent-sdk/src/types.ts:2455](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2455)

Plugins to load for this subagent.

Unlike tools inherited from the parent, these plugins are loaded
exclusively for this subagent. This is useful for giving a subagent
access to an MCP server without polluting the parent's tool set.

#### Example

```typescript
const subagents = [
  {
    type: "web-researcher",
    description: "Web research specialist",
    plugins: [webSearchPlugin],  // Only this subagent gets web search
    allowedTools: [webSearch("search")],
    create: (ctx) => createSubagent(parentAgent, {
      name: "web-researcher",
      plugins: ctx.plugins,
      allowedTools: ctx.allowedTools,
    }),
  },
];
```

***

### streaming?

> `optional` **streaming**: `boolean`

Defined in: [packages/agent-sdk/src/types.ts:2487](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2487)

Enable streaming from this subagent to the parent's data stream.

When true, the subagent receives a StreamingContext and can write
custom data directly to the parent's stream. This enables:
- Progressive UI rendering
- Real-time progress updates
- Streaming structured data to the client

The streaming context includes metadata identifying this subagent
as the source, similar to LangGraph's namespace pattern.

#### Default Value

```ts
false
```

#### Example

```typescript
const subagents = [
  {
    type: "ui-builder",
    description: "Generates UI components with streaming",
    streaming: true,
    create: (ctx) => createSubagent(parentAgent, {
      name: "ui-builder",
      systemPrompt: generateCatalogPrompt(catalog),
      // Subagent can use ctx.streamingContext.writer
    }),
  },
];
```

***

### type

> **type**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2376](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2376)

Unique type identifier for this subagent
