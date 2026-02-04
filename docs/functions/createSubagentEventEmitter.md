[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createSubagentEventEmitter

# Function: createSubagentEventEmitter()

> **createSubagentEventEmitter**(): [`SubagentEventEmitter`](../interfaces/SubagentEventEmitter.md)

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:752](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L752)

Creates an event emitter for subagent lifecycle events.

Provides a convenient way to handle all subagent events
without passing individual callbacks.

## Returns

[`SubagentEventEmitter`](../interfaces/SubagentEventEmitter.md)

Event emitter instance

## Example

```typescript
const emitter = createSubagentEventEmitter();

emitter.onStart((event) => {
  console.log(`Starting ${event.subagentType}: ${event.prompt}`);
});

emitter.onStep((event) => {
  console.log(`Step ${event.stepNumber}: ${event.toolCalls.length} tool calls`);
});

emitter.onFinish((event) => {
  console.log(`Finished in ${event.duration}ms: ${event.summary}`);
});

emitter.onError((event) => {
  console.error(`Error: ${event.error.message}`);
});
```
