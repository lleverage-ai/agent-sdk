# Middleware

Middleware intercepts and transforms agent operations.

## Logging Middleware

```typescript
import {
  createLoggingMiddleware,
  createTimingMiddleware,
} from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  middleware: [
    createLoggingMiddleware({ level: "debug" }),
    createTimingMiddleware(),
  ],
});
```

### Logging Options

```typescript
createLoggingMiddleware({
  level: "debug", // "debug" | "info" | "warn" | "error"
  logRequests: true,
  logResponses: true,
  logToolCalls: true,
  redactSecrets: true,
  logger: customLogger, // Optional custom logger
});
```

## Caching Middleware

```typescript
import {
  createCacheMiddleware,
  InMemoryCacheStore,
} from "@lleverage-ai/agent-sdk";

const cacheStore = new InMemoryCacheStore();

const agent = createAgent({
  model,
  middleware: [
    createCacheMiddleware({
      store: cacheStore,
      ttl: 60000, // 1 minute
    }),
  ],
});
```

### Cache Options

```typescript
createCacheMiddleware({
  store: cacheStore,
  ttl: 60000, // Time-to-live in ms
  keyGenerator: (request) => {
    // Custom cache key generation
    return `${request.model}-${hash(request.messages)}`;
  },
  shouldCache: (request, response) => {
    // Conditionally cache responses
    return response.finishReason === "stop";
  },
});
```

### Cache Stores

```typescript
// In-memory (default)
const memoryStore = new InMemoryCacheStore();

// File-based
const fileStore = new FileCacheStore({
  directory: ".cache/agent",
});

// Redis (custom implementation)
class RedisCacheStore implements CacheStore {
  async get(key: string) { /* ... */ }
  async set(key: string, value: any, ttl?: number) { /* ... */ }
  async delete(key: string) { /* ... */ }
}
```

## Retry Middleware

```typescript
import {
  createRetryMiddleware,
  createCircuitBreakerMiddleware,
} from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  middleware: [
    createRetryMiddleware({
      maxRetries: 3,
      backoff: "exponential",
    }),
    createCircuitBreakerMiddleware({
      threshold: 5,
      resetTimeout: 60000,
    }),
  ],
});
```

### Retry Options

```typescript
createRetryMiddleware({
  maxRetries: 3,
  backoff: "exponential", // "fixed" | "linear" | "exponential"
  baseDelay: 1000, // Base delay in ms
  maxDelay: 30000, // Maximum delay in ms
  jitter: true, // Add randomness to prevent thundering herd
  retryOn: (error) => {
    // Custom retry condition
    return error.status === 429 || error.status >= 500;
  },
});
```

### Circuit Breaker

Prevents cascading failures by stopping requests when error threshold is reached:

```typescript
createCircuitBreakerMiddleware({
  threshold: 5, // Number of failures before opening circuit
  resetTimeout: 60000, // Time before attempting reset (ms)
  halfOpenRequests: 3, // Requests to allow in half-open state
  onOpen: () => console.log("Circuit opened"),
  onClose: () => console.log("Circuit closed"),
  onHalfOpen: () => console.log("Circuit half-open"),
});
```

## Guardrails Middleware

```typescript
import {
  createGuardrailsMiddleware,
  createContentFilterMiddleware,
} from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  middleware: [
    createGuardrailsMiddleware({
      blockedPatterns: [/password/i, /api[_-]?key/i],
    }),
    createContentFilterMiddleware({
      maxLength: 10000,
    }),
  ],
});
```

### Guardrails Options

```typescript
createGuardrailsMiddleware({
  blockedPatterns: [/pattern/i],
  blockedStrings: ["exact match"],
  onBlocked: (request, pattern) => {
    console.warn(`Request blocked by pattern: ${pattern}`);
  },
});
```

### Content Filter Options

```typescript
createContentFilterMiddleware({
  maxLength: 10000, // Maximum message length
  maxMessages: 100, // Maximum number of messages
  truncateStrategy: "tail", // "head" | "tail" | "middle"
  onTruncate: (original, truncated) => {
    console.log(`Truncated from ${original.length} to ${truncated.length}`);
  },
});
```

## Rate Limiting Middleware

```typescript
import { createRateLimitMiddleware } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  middleware: [
    createRateLimitMiddleware({
      maxRequests: 100,
      windowMs: 60000, // 1 minute
    }),
  ],
});
```

### Rate Limit Options

```typescript
createRateLimitMiddleware({
  maxRequests: 100,
  windowMs: 60000,
  keyGenerator: (request) => {
    // Rate limit by user or other criteria
    return request.metadata?.userId ?? "default";
  },
  onLimit: (key, retryAfter) => {
    console.warn(`Rate limited: ${key}, retry after ${retryAfter}ms`);
  },
});
```

## Composing Middleware

Combine multiple middleware into one:

```typescript
import { composeMiddleware } from "@lleverage-ai/agent-sdk";

const combined = composeMiddleware([
  createLoggingMiddleware(),
  createRetryMiddleware({ maxRetries: 3 }),
  createCacheMiddleware({ store }),
]);

const agent = createAgent({
  model,
  middleware: [combined],
});
```

### Execution Order

Middleware executes in order for requests (first to last) and reverse order for responses (last to first):

```
Request  → Logging → Retry → Cache → Model
Response ← Logging ← Retry ← Cache ← Model
```

## Creating Custom Middleware

```typescript
import { Middleware, MiddlewareContext } from "@lleverage-ai/agent-sdk";

const customMiddleware: Middleware = {
  name: "custom",

  async onRequest(context: MiddlewareContext) {
    // Modify request before sending
    console.log("Request:", context.request);
    return context; // or return modified context
  },

  async onResponse(context: MiddlewareContext) {
    // Modify response after receiving
    console.log("Response:", context.response);
    return context;
  },

  async onError(context: MiddlewareContext, error: Error) {
    // Handle errors
    console.error("Error:", error);
    throw error; // or return modified context to recover
  },
};

const agent = createAgent({
  model,
  middleware: [customMiddleware],
});
```

## Middleware with State

```typescript
function createStatefulMiddleware() {
  let requestCount = 0;

  return {
    name: "stateful",

    async onRequest(context: MiddlewareContext) {
      requestCount++;
      context.metadata = { ...context.metadata, requestNumber: requestCount };
      return context;
    },

    getStats() {
      return { requestCount };
    },
  };
}

const middleware = createStatefulMiddleware();
const agent = createAgent({ model, middleware: [middleware] });

// Later
console.log(middleware.getStats()); // { requestCount: 42 }
```
