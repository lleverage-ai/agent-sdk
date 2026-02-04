[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / StreamingContext

# Interface: StreamingContext

Defined in: [packages/agent-sdk/src/types.ts:186](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L186)

Context for streaming data from tools to the client.

This is passed to streaming-aware tools created via function-based plugin tools.
Tools can use `writer.write()` to send custom data parts to the client
incrementally during execution.

## Example

```typescript
const plugin = definePlugin({
  name: "my-plugin",
  tools: (ctx) => ({
    myTool: tool({
      description: "Streams data",
      inputSchema: z.object({ data: z.string() }),
      execute: async ({ data }) => {
        if (ctx.writer) {
          // Write custom data parts to the stream
          ctx.writer.write({
            type: "data",
            data: { progress: 50 },
          });
        }
        return { success: true };
      },
    }),
  }),
});
```

## Properties

### metadata?

> `optional` **metadata**: [`StreamingMetadata`](StreamingMetadata.md)

Defined in: [packages/agent-sdk/src/types.ts:198](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L198)

Metadata identifying the source of streamed data.
Automatically included when streaming from subagents.

***

### writer

> **writer**: `UIMessageStreamWriter`&lt;[`UIMessage`](UIMessage.md)&lt;`unknown`, `UIDataTypes`, `UITools`&gt;&gt; \| `null`

Defined in: [packages/agent-sdk/src/types.ts:192](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L192)

UI Message stream writer for sending custom data to client.
Only available when using `streamDataResponse()`.
Will be `null` when using `generate()` or regular `streamResponse()`.
