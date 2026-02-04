[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / StreamingToolsFactory

# Type Alias: StreamingToolsFactory()

> **StreamingToolsFactory** = (`ctx`: [`StreamingContext`](../interfaces/StreamingContext.md)) => [`ToolSet`](ToolSet.md)

Defined in: [packages/agent-sdk/src/types.ts:225](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L225)

Factory function for creating streaming-aware tools.

This allows plugins to create tools that can access the streaming context
and send incremental data to the client via `ctx.writer`.

## Parameters

| Parameter | Type |
| :------ | :------ |
| `ctx` | [`StreamingContext`](../interfaces/StreamingContext.md) |

## Returns

[`ToolSet`](ToolSet.md)

## Example

```typescript
const streamingTools: StreamingToolsFactory = (ctx) => ({
  renderUI: tool({
    description: "Renders UI with streaming updates",
    inputSchema: z.object({ tree: UITreeSchema }),
    execute: async ({ tree }) => {
      if (ctx.writer) {
        ctx.writer.write({ type: "data", value: { type: "ui-patch", op: "set", path: "/root", value: tree.root } });
      }
      return { success: true };
    },
  }),
});
```
