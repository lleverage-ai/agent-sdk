[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / expandEnvVars

# Function: expandEnvVars()

## Call Signature

> **expandEnvVars**(`value`: `string`): `string`

Defined in: [packages/agent-sdk/src/mcp/env.ts:24](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/env.ts#L24)

Expands environment variables in a string using $\{VAR\} syntax.

### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `value` | `string` | String or object containing strings to expand |

### Returns

`string`

String or object with expanded values

### Example

```typescript
// String expansion
expandEnvVars("Bearer ${API_TOKEN}") // "Bearer actual-value"

// Object expansion
expandEnvVars({ token: "${TOKEN}" }) // { token: "actual-value" }
```

## Call Signature

> **expandEnvVars**(`value`: `Record`&lt;`string`, `string`&gt;): `Record`&lt;`string`, `string`&gt;

Defined in: [packages/agent-sdk/src/mcp/env.ts:25](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/env.ts#L25)

Expands environment variables in a string using $\{VAR\} syntax.

### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `value` | `Record`&lt;`string`, `string`&gt; | String or object containing strings to expand |

### Returns

`Record`&lt;`string`, `string`&gt;

String or object with expanded values

### Example

```typescript
// String expansion
expandEnvVars("Bearer ${API_TOKEN}") // "Bearer actual-value"

// Object expansion
expandEnvVars({ token: "${TOKEN}" }) // { token: "actual-value" }
```
