[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ServerRateLimitInfo

# Interface: ServerRateLimitInfo

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:20](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L20)

Server-provided rate limit information from response headers.

## Properties

### limit?

> `optional` **limit**: `number`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:25](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L25)

Maximum requests allowed in the current window.
Typically from `x-ratelimit-limit` or `ratelimit-limit` header.

***

### remaining?

> `optional` **remaining**: `number`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:31](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L31)

Number of requests remaining in the current window.
Typically from `x-ratelimit-remaining` or `ratelimit-remaining` header.

***

### reset?

> `optional` **reset**: `number`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:37](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L37)

Timestamp when the rate limit window resets (Unix seconds).
Typically from `x-ratelimit-reset` or `ratelimit-reset` header.

***

### retryAfter?

> `optional` **retryAfter**: `number`

Defined in: [packages/agent-sdk/src/hooks/rate-limit.ts:43](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/rate-limit.ts#L43)

Number of seconds until the rate limit window resets.
Typically from `retry-after` header when rate limited.
