# Error Handling

Typed errors with recovery utilities.

## Error Types

```typescript
import {
  AgentError,
  ToolExecutionError,
  ModelError,
  TimeoutError,
  RateLimitError,
} from "@lleverage-ai/agent-sdk";

try {
  await agent.generate({ prompt });
} catch (error) {
  if (error instanceof RateLimitError) {
    // Wait and retry
    await sleep(error.retryAfter);
  } else if (error instanceof TimeoutError) {
    // Handle timeout
  } else if (error instanceof ToolExecutionError) {
    console.error("Tool failed:", error.toolName, error.cause);
  } else if (error instanceof ModelError) {
    console.error("Model error:", error.message);
  }
}
```

### Error Hierarchy

| Error | Description |
|-------|-------------|
| `AgentError` | Base class for all agent errors |
| `ModelError` | Errors from the language model |
| `ToolExecutionError` | Tool execution failures |
| `TimeoutError` | Operation timeouts |
| `RateLimitError` | Rate limiting (429) |
| `ContextLengthError` | Context window exceeded |
| `ValidationError` | Input validation failures |
| `MCPError` | MCP server/protocol errors |
| `MCPInputValidationError` | MCP tool input validation failures |

### Error Properties

```typescript
interface AgentError extends Error {
  code: string; // Machine-readable error code
  cause?: Error; // Original error if wrapped
  retryable: boolean; // Whether the error is retryable
  metadata?: Record<string, any>; // Additional context
}

interface ToolExecutionError extends AgentError {
  toolName: string;
  toolInput: any;
}

interface RateLimitError extends AgentError {
  retryAfter: number; // Milliseconds to wait
}
```

## Error Utilities

### Wrap Errors

```typescript
import { wrapError } from "@lleverage-ai/agent-sdk";

try {
  await riskyOperation();
} catch (error) {
  // Wrap unknown errors with context
  const agentError = wrapError(error, {
    context: "generation",
    toolName: "myTool",
  });
  throw agentError;
}
```

### Check Retryability

```typescript
import { isRetryable } from "@lleverage-ai/agent-sdk";

try {
  await agent.generate({ prompt });
} catch (error) {
  if (isRetryable(error)) {
    // Safe to retry
    await agent.generate({ prompt });
  } else {
    // Don't retry, handle differently
    throw error;
  }
}
```

### User-Friendly Messages

```typescript
import { getUserMessage } from "@lleverage-ai/agent-sdk";

try {
  await agent.generate({ prompt });
} catch (error) {
  // Get a message suitable for displaying to users
  const message = getUserMessage(error);
  console.log(message); // "The request timed out. Please try again."
}
```

### Error Handler

```typescript
import { createErrorHandler } from "@lleverage-ai/agent-sdk";

const handleError = createErrorHandler({
  onRateLimit: async (error) => {
    console.log(`Rate limited, waiting ${error.retryAfter}ms`);
    await sleep(error.retryAfter);
  },
  onTimeout: async (error) => {
    console.log("Request timed out");
  },
  onToolError: async (error) => {
    console.log(`Tool ${error.toolName} failed:`, error.message);
  },
  onUnknown: async (error) => {
    console.error("Unexpected error:", error);
  },
});

try {
  await agent.generate({ prompt });
} catch (error) {
  await handleError(error);
}
```

## Graceful Degradation

### Fallback Operations

```typescript
import { withFallback } from "@lleverage-ai/agent-sdk";

// Single fallback
const result = await withFallback(
  () => primaryOperation(),
  () => fallbackOperation(),
);

// With error logging
const result = await withFallback(
  () => primaryOperation(),
  () => fallbackOperation(),
  { onFallback: (error) => console.warn("Primary failed:", error) },
);
```

### Try Multiple Operations

```typescript
import { tryOperations } from "@lleverage-ai/agent-sdk";

// Try each operation in order until one succeeds
const result = await tryOperations([
  () => primaryModel.generate(prompt),
  () => secondaryModel.generate(prompt),
  () => tertiaryModel.generate(prompt),
]);

// With options
const result = await tryOperations(
  [attempt1, attempt2, attempt3],
  {
    onAttempt: (index, error) => console.log(`Attempt ${index + 1} failed`),
    shouldContinue: (error) => isRetryable(error),
  },
);
```

### Circuit Breaker

Prevents cascading failures by stopping requests when error threshold is reached:

```typescript
import { createCircuitBreaker } from "@lleverage-ai/agent-sdk";

const breaker = createCircuitBreaker({
  threshold: 5, // Open after 5 failures
  resetTimeout: 60000, // Try again after 60s
});

// Use the circuit breaker
try {
  const result = await breaker.execute(() => riskyOperation());
} catch (error) {
  if (error.code === "CIRCUIT_OPEN") {
    // Circuit is open, don't attempt
    console.log("Service unavailable, circuit open");
  }
}

// Check circuit state
console.log(breaker.state); // "closed" | "open" | "half-open"
console.log(breaker.failures); // Number of consecutive failures
```

### Circuit Breaker States

| State | Description |
|-------|-------------|
| `closed` | Normal operation, requests pass through |
| `open` | Failures exceeded threshold, requests blocked |
| `half-open` | Testing if service recovered, limited requests |

## Retry Patterns

### Simple Retry

```typescript
import { retry } from "@lleverage-ai/agent-sdk";

const result = await retry(
  () => agent.generate({ prompt }),
  {
    maxAttempts: 3,
    delay: 1000,
  },
);
```

### Exponential Backoff

```typescript
import { retryWithBackoff } from "@lleverage-ai/agent-sdk";

const result = await retryWithBackoff(
  () => agent.generate({ prompt }),
  {
    maxAttempts: 5,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2, // 1s, 2s, 4s, 8s, 16s (capped at 30s)
    jitter: true, // Add randomness
  },
);
```

### Conditional Retry

```typescript
import { retryIf } from "@lleverage-ai/agent-sdk";

const result = await retryIf(
  () => agent.generate({ prompt }),
  {
    maxAttempts: 3,
    shouldRetry: (error, attempt) => {
      // Only retry rate limits and server errors
      return error instanceof RateLimitError ||
        (error instanceof ModelError && error.status >= 500);
    },
    getDelay: (error, attempt) => {
      // Use retry-after header if available
      if (error instanceof RateLimitError) {
        return error.retryAfter;
      }
      return 1000 * Math.pow(2, attempt);
    },
  },
);
```

## Error Hooks

Handle errors at the agent level with hooks:

```typescript
const agent = createAgent({
  model,
  hooks: {
    PostGenerateFailure: [
      async ({ error }) => {
        console.error("Generation failed:", error);
        // Log to monitoring service
        monitoring.recordError(error);
        return {};
      },
    ],
    PostToolUseFailure: [
      {
        hooks: [
          async ({ tool_name, error }) => {
            console.error(`Tool ${tool_name} failed:`, error);
            return {};
          },
        ],
      },
    ],
  },
});
```

`PostGenerateFailure` hooks now receive optional retry metadata:
- `requestClass` for the current request (`"foreground"`, `"background"`, or a host-defined class)
- `failureClassification.type` for the high-level taxonomy (`overload`, `authentication`, `authorization`, `transport`, `context_overflow`, `unknown`)
- `failureClassification.subtype` for more specific cases such as `rate_limit`, `timeout`, `model_unavailable`, or `stale_socket`
- `consecutiveOverloadCount` so hosts can inspect bounded overload behavior

## Generation Retry Policy

Use `generationRetryPolicy` when retry behavior should depend on request class and failure type rather than a single global retry path.

```typescript
const agent = createAgent({
  model,
  fallbackModel,
  generationRetryPolicy: {
    requestClasses: {
      foreground: {
        maxConsecutiveOverloadRetries: 2,
      },
      background: {
        maxConsecutiveOverloadRetries: 0,
        fallbackOnOverloadExhaustion: false,
      },
    },
    onAuthenticationFailure: async ({ options }) => ({
      retry: true,
      updatedOptions: {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${await refreshToken()}`,
        },
      },
    }),
    onTransportFailure: async ({ options }) => ({
      retry: true,
      updatedOptions: {
        ...options,
        headers: {
          ...options.headers,
          Connection: "close",
        },
      },
    }),
    contextOverflow: {
      reductionFactor: 0.5,
      minMaxTokens: 256,
    },
  },
});
```

The built-in taxonomy is:
- `overload` for rate limits, timeouts, and temporary model/service unavailability
- `authentication` for token or API-key failures
- `authorization` for permission-denied failures
- `transport` for network and stale-socket failures such as `ECONNRESET` and `EPIPE`
- `context_overflow` for context-window or max-token overflow failures
- `unknown` for anything the SDK cannot classify

Extension points for hosts:
- Set `GenerateOptions.requestClass` per request to vary overload behavior for foreground vs background work.
- Use `requestClasses` to bound consecutive overload retries before fallback or termination.
- Use `onAuthenticationFailure` to refresh credentials and return updated headers/provider options.
- Use `onTransportFailure` to re-establish clients or force a fresh connection after stale socket failures.
- Use `contextOverflow` to automatically reduce `maxTokens` on retry when overflow errors are recoverable.
- Use `GenerationRetryDecision` hooks for observability of the final retry/fallback/fail decision.

## Error Codes

Common error codes for programmatic handling:

| Code | Description |
|------|-------------|
| `RATE_LIMIT` | Rate limit exceeded |
| `TIMEOUT` | Operation timed out |
| `CONTEXT_LENGTH` | Context window exceeded |
| `MODEL_ERROR` | Model returned an error |
| `TOOL_EXECUTION` | Tool execution failed |
| `VALIDATION` | Input validation failed |
| `MCP_CONNECTION` | MCP server connection failed |
| `MCP_VALIDATION` | MCP input validation failed |
| `CIRCUIT_OPEN` | Circuit breaker is open |

```typescript
switch (error.code) {
  case "RATE_LIMIT":
    await sleep(error.retryAfter);
    break;
  case "CONTEXT_LENGTH":
    // Compact context and retry
    break;
  case "CIRCUIT_OPEN":
    // Use fallback service
    break;
}
```
