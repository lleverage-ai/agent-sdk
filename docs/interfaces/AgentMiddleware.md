[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / AgentMiddleware

# Interface: AgentMiddleware

Defined in: [packages/agent-sdk/src/middleware/types.ts:155](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L155)

Agent middleware interface.

Middleware registers hooks and can have lifecycle methods for setup and
teardown. Middleware provides a cleaner API than raw hooks for adding
cross-cutting concerns to agents.

## Example

```typescript
const loggingMiddleware: AgentMiddleware = {
  name: "logging",
  register(ctx) {
    ctx.onPreGenerate(async (input) => {
      console.log("Generation starting");
      return {};
    });
    ctx.onPostGenerate(async (input) => {
      console.log("Generation complete");
      return {};
    });
  },
};
```

## Properties

### name

> **name**: `string`

Defined in: [packages/agent-sdk/src/middleware/types.ts:160](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L160)

Unique middleware name.
Used for debugging and error messages.

## Methods

### register()

> **register**(`context`: [`MiddlewareContext`](MiddlewareContext.md)): `void`

Defined in: [packages/agent-sdk/src/middleware/types.ts:170](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L170)

Called during agent creation to register hooks.

Use the context to register event handlers for various lifecycle events.
Hooks are executed in the order middleware was added to the agent.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `context` | [`MiddlewareContext`](MiddlewareContext.md) | The middleware context for registering hooks |

#### Returns

`void`

***

### setup()?

> `optional` **setup**(): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/middleware/types.ts:179](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L179)

Optional setup called during agent creation.

Use this for initialization that needs to happen before the agent
starts processing requests, such as establishing connections or
loading configuration.

#### Returns

`void` \| `Promise`&lt;`void`&gt;

***

### teardown()?

> `optional` **teardown**(): `void` \| `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/middleware/types.ts:187](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/middleware/types.ts#L187)

Optional teardown for cleanup.

Use this to clean up resources when the agent is being disposed,
such as closing connections or flushing buffers.

#### Returns

`void` \| `Promise`&lt;`void`&gt;
