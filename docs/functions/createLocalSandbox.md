[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createLocalSandbox

# Function: createLocalSandbox()

> **createLocalSandbox**(`options?`: [`LocalSandboxOptions`](../interfaces/LocalSandboxOptions.md)): [`LocalSandbox`](../classes/LocalSandbox.md)

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:668](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L668)

Create a LocalSandbox with the specified options.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options?` | [`LocalSandboxOptions`](../interfaces/LocalSandboxOptions.md) | Configuration options |

## Returns

[`LocalSandbox`](../classes/LocalSandbox.md)

A new LocalSandbox instance

## Example

```typescript
const sandbox = createLocalSandbox({
  cwd: "/home/user/project",
  timeout: 30000,
});
```
