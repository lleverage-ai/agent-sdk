[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / RateLimitHooksOptions

# Interface: RateLimitHooksOptions

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:51](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L51)

Options for creating rate limit hooks.

## Properties

### enableServerLimits?

> `optional` **enableServerLimits**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:85](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L85)

Enable server rate limit integration.
When enabled, hooks will attempt to extract rate limit information
from model response headers (e.g., x-ratelimit-* headers) and use
server-provided limits in addition to client-side tracking.

#### Default Value

```ts
false
```

***

### extractServerLimits()?

> `optional` **extractServerLimits**: (`result`: [`PostGenerateInput`](PostGenerateInput.md)) => [`ServerRateLimitInfo`](ServerRateLimitInfo.md) \| `undefined`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:107](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L107)

Custom function to extract server rate limit info from response metadata.
Use this if your provider uses non-standard header names or formats.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `result` | [`PostGenerateInput`](PostGenerateInput.md) | The generation result which may contain response metadata |

#### Returns

[`ServerRateLimitInfo`](ServerRateLimitInfo.md) \| `undefined`

Server rate limit information, or undefined if not available

#### Example

```typescript
extractServerLimits: (result) => {
  const headers = result.rawResponse?.headers;
  if (!headers) return undefined;
  return {
    limit: parseInt(headers['x-custom-limit'] || '0'),
    remaining: parseInt(headers['x-custom-remaining'] || '0'),
    reset: parseInt(headers['x-custom-reset'] || '0'),
  };
}
```

***

### limitMessage?

> `optional` **limitMessage**: `string`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:68](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L68)

Message to show when rate limit is exceeded.

#### Default Value

```ts
"Rate limit exceeded. Please try again later."
```

***

### maxTokensPerWindow?

> `optional` **maxTokensPerWindow**: `number`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:56](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L56)

Maximum tokens per time window.

#### Default Value

```ts
100000
```

***

### perToolQuota?

> `optional` **perToolQuota**: `boolean`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:121](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L121)

**`Experimental`**

Enable per-tool quota tracking.
When enabled, tracks token usage separately for each tool,
allowing different tools to have independent rate limits.

**Note**: This feature is designed for future tool-based rate limiting hooks
(PreToolUse/PostToolUse). The current generation-based hooks (PreGenerate/PostGenerate)
track overall token usage, not per-tool usage.

#### Default Value

```ts
false
@experimental
```

***

### shouldAllow()?

> `optional` **shouldAllow**: (`tokensUsed`: `number`, `maxTokens`: `number`) => `boolean`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:75](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L75)

Custom function to determine if a request should be rate limited.
Return true to allow, false to deny.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `tokensUsed` | `number` |
| `maxTokens` | `number` |

#### Returns

`boolean`

#### Default Value

```ts
Check token count against limit
```

***

### toolLimits?

> `optional` **toolLimits**: `Record`&lt;`string`, `number`&gt;

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:140](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L140)

**`Experimental`**

Per-tool token limits when perToolQuota is enabled.
Maps tool names to their maximum tokens per window.

**Note**: This feature is designed for future tool-based rate limiting hooks.
Current generation-based hooks do not use this configuration.

#### Example

```typescript
{
  'Write': 10000,    // Write tool limited to 10k tokens per window
  'Bash': 5000,      // Bash tool limited to 5k tokens per window
  'Read': 20000,     // Read tool limited to 20k tokens per window
}
```

***

### windowMs?

> `optional` **windowMs**: `number`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:62](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L62)

Time window in milliseconds for token counting.

#### Default Value

```ts
60000 (1 minute)
```
