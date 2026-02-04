[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / TokenBucketRateLimiter

# Class: TokenBucketRateLimiter

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:151](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L151)

Token bucket rate limiter implementation.

Tracks token usage in a sliding window with automatic cleanup of old entries.
Supports per-tool quota tracking and server-provided rate limit integration.

## Constructors

### Constructor

> **new TokenBucketRateLimiter**(`maxTokensPerWindow`: `number`, `windowMs`: `number`, `perToolQuota`: `boolean`, `toolLimits`: `Record`&lt;`string`, `number`&gt;): `TokenBucketRateLimiter`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:159](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L159)

#### Parameters

| Parameter | Type | Default value |
| :------ | :------ | :------ |
| `maxTokensPerWindow` | `number` | `undefined` |
| `windowMs` | `number` | `undefined` |
| `perToolQuota` | `boolean` | `false` |
| `toolLimits` | `Record`&lt;`string`, `number`&gt; | `{}` |

#### Returns

`TokenBucketRateLimiter`

## Methods

### getCurrentUsage()

> **getCurrentUsage**(`tool?`: `string`): `number`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:207](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L207)

Get current token usage in the window.
If tool is provided and per-tool quotas are enabled, returns usage for that tool only.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `tool?` | `string` |

#### Returns

`number`

***

### getRemainingTokens()

> **getRemainingTokens**(`tool?`: `string`): `number`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:223](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L223)

Get remaining tokens in current window.
Uses server limits if available, otherwise falls back to client-side tracking.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `tool?` | `string` |

#### Returns

`number`

***

### getServerLimits()

> **getServerLimits**(): [`ServerRateLimitInfo`](../interfaces/ServerRateLimitInfo.md) \| `undefined`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:245](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L245)

Get current server limit information if available.

#### Returns

[`ServerRateLimitInfo`](../interfaces/ServerRateLimitInfo.md) \| `undefined`

***

### recordUsage()

> **recordUsage**(`tokens`: `number`, `tool?`: `string`): `void`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:194](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L194)

Record token usage for a tool.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `tokens` | `number` |
| `tool?` | `string` |

#### Returns

`void`

***

### reset()

> **reset**(): `void`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:270](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L270)

Reset all usage data and server limit info.

#### Returns

`void`

***

### tryAcquire()

> **tryAcquire**(`tool?`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:175](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L175)

Try to acquire tokens. Returns true if allowed, false if would exceed limit.
If tool is provided and per-tool quotas are enabled, checks against tool-specific limit.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `tool?` | `string` |

#### Returns

`boolean`

***

### updateServerLimits()

> **updateServerLimits**(`info`: [`ServerRateLimitInfo`](../interfaces/ServerRateLimitInfo.md)): `void`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:238](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L238)

Update with server-provided rate limit information.
This information takes precedence over client-side tracking.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `info` | [`ServerRateLimitInfo`](../interfaces/ServerRateLimitInfo.md) |

#### Returns

`void`
