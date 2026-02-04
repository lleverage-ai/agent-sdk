[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / RouteConfig

# Type Alias: RouteConfig

> **RouteConfig** = `Record`&lt;`string`, [`BackendProtocol`](../interfaces/BackendProtocol.md)&gt;

Defined in: [packages/agent-sdk/src/backends/composite.ts:64](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L64)

Configuration for routing paths to backends.

Keys are path prefixes (should start with '/' and optionally end with '/').
Values are the backends that handle those paths.

## Example

```typescript
const routes: RouteConfig = {
  '/memories/': persistentBackend,
  '/cache/': stateBackend,
  '/project/': filesystemBackend,
};
```
