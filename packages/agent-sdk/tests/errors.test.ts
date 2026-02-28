/**
 * Tests for the Error Handling System.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AbortError,
  // Base error
  AgentError,
  AuthenticationError,
  AuthorizationError,
  BackendError,
  CheckpointError,
  // Specific errors
  ConfigurationError,
  ContextError,
  createCircuitBreaker,
  createErrorHandler,
  formatErrorForLogging,
  getUserMessage,
  isRetryable,
  MemoryError,
  ModelError,
  NetworkError,
  RateLimitError,
  SubagentError,
  TimeoutError,
  ToolExecutionError,
  tryOperations,
  ValidationError,
  // Graceful degradation
  withFallback,
  withFallbackFn,
  // Utilities
  wrapError,
} from "../src/errors/index.js";

// =============================================================================
// AgentError Tests
// =============================================================================

describe("AgentError", () => {
  it("creates error with default values", () => {
    const error = new AgentError("Something went wrong");

    expect(error.message).toBe("Something went wrong");
    expect(error.name).toBe("AgentError");
    expect(error.code).toBe("AGENT_ERROR");
    expect(error.severity).toBe("error");
    expect(error.retryable).toBe(false);
    expect(error.metadata).toEqual({});
    expect(error.timestamp).toBeDefined();
  });

  it("creates error with custom options", () => {
    const cause = new Error("Original error");
    const error = new AgentError("Custom error", {
      code: "TOOL_ERROR",
      userMessage: "Tool failed",
      severity: "fatal",
      retryable: true,
      retryAfterMs: 5000,
      metadata: { toolName: "test" },
      cause,
    });

    expect(error.code).toBe("TOOL_ERROR");
    expect(error.userMessage).toBe("Tool failed");
    expect(error.severity).toBe("fatal");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(5000);
    expect(error.metadata).toEqual({ toolName: "test" });
    expect(error.cause).toBe(cause);
  });

  it("generates user-friendly message automatically", () => {
    // The regex matches patterns like "NETWORK_ERROR" (all caps with underscores)
    const error = new AgentError("CONNECTION_REFUSEDError at endpoint {details}");
    // Technical details should be cleaned up
    expect(error.userMessage).toContain("An error");
    expect(error.userMessage).not.toContain("CONNECTION_REFUSEDError");
    expect(error.userMessage).not.toContain("{details}");
  });

  it("serializes to JSON correctly", () => {
    const error = new AgentError("Test error", {
      code: "TEST_ERROR" as never,
      metadata: { key: "value" },
    });

    const json = error.toJSON();

    expect(json.name).toBe("AgentError");
    expect(json.message).toBe("Test error");
    expect(json.code).toBe("TEST_ERROR");
    expect(json.metadata).toEqual({ key: "value" });
    expect(json.timestamp).toBeDefined();
    expect(json.stack).toBeDefined();
  });

  describe("static methods", () => {
    it("is() identifies AgentErrors", () => {
      expect(AgentError.is(new AgentError("test"))).toBe(true);
      expect(AgentError.is(new Error("test"))).toBe(false);
      expect(AgentError.is("test")).toBe(false);
      expect(AgentError.is(null)).toBe(false);
    });

    it("hasCode() checks error code", () => {
      const error = new AgentError("test", { code: "TOOL_ERROR" });

      expect(AgentError.hasCode(error, "TOOL_ERROR")).toBe(true);
      expect(AgentError.hasCode(error, "AGENT_ERROR")).toBe(false);
      expect(AgentError.hasCode(new Error("test"), "AGENT_ERROR")).toBe(false);
    });
  });
});

// =============================================================================
// Specific Error Classes Tests
// =============================================================================

describe("ConfigurationError", () => {
  it("creates with config details", () => {
    const error = new ConfigurationError("Invalid config", {
      configKey: "model",
      expectedType: "string",
      actualValue: 123,
    });

    expect(error.name).toBe("ConfigurationError");
    expect(error.code).toBe("CONFIGURATION_ERROR");
    expect(error.severity).toBe("fatal");
    expect(error.metadata.configKey).toBe("model");
    expect(error.metadata.expectedType).toBe("string");
    expect(error.metadata.actualValue).toBe(123);
  });
});

describe("ValidationError", () => {
  it("creates with field errors", () => {
    const error = new ValidationError("Validation failed", {
      fieldErrors: {
        email: ["Invalid format", "Required"],
        name: ["Too short"],
      },
    });

    expect(error.name).toBe("ValidationError");
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.fieldErrors).toEqual({
      email: ["Invalid format", "Required"],
      name: ["Too short"],
    });
  });

  it("getErrorList() formats errors", () => {
    const error = new ValidationError("Validation failed", {
      fieldErrors: {
        email: ["Invalid format"],
        name: ["Too short"],
      },
    });

    const list = error.getErrorList();

    expect(list).toContain("email: Invalid format");
    expect(list).toContain("name: Too short");
  });
});

describe("ToolExecutionError", () => {
  it("creates with tool details", () => {
    const error = new ToolExecutionError("Tool failed", {
      toolName: "read_file",
      toolInput: { path: "/test" },
    });

    expect(error.name).toBe("ToolExecutionError");
    expect(error.code).toBe("TOOL_ERROR");
    expect(error.toolName).toBe("read_file");
    expect(error.toolInput).toEqual({ path: "/test" });
    expect(error.retryable).toBe(true);
  });
});

describe("ModelError", () => {
  it("creates generic model error", () => {
    const error = new ModelError("Model failed", {
      modelId: "claude-3-sonnet",
    });

    expect(error.name).toBe("ModelError");
    expect(error.code).toBe("MODEL_ERROR");
    expect(error.modelId).toBe("claude-3-sonnet");
  });

  it("detects rate limit errors", () => {
    const error = new ModelError("Rate limit exceeded", {
      statusCode: 429,
    });

    expect(error.code).toBe("RATE_LIMIT_ERROR");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(30000);
  });

  it("detects timeout errors", () => {
    const error = new ModelError("Request timed out");

    expect(error.code).toBe("TIMEOUT_ERROR");
    expect(error.retryable).toBe(true);
  });
});

describe("NetworkError", () => {
  it("creates with network details", () => {
    const error = new NetworkError("Connection failed", {
      url: "https://api.example.com",
      statusCode: 503,
    });

    expect(error.name).toBe("NetworkError");
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.retryable).toBe(true);
    expect(error.metadata.url).toBe("https://api.example.com");
    expect(error.metadata.statusCode).toBe(503);
  });
});

describe("TimeoutError", () => {
  it("creates with timeout details", () => {
    const error = new TimeoutError("Operation timed out", {
      timeoutMs: 30000,
      operation: "read_file",
    });

    expect(error.name).toBe("TimeoutError");
    expect(error.code).toBe("TIMEOUT_ERROR");
    expect(error.timeoutMs).toBe(30000);
    expect(error.operation).toBe("read_file");
    expect(error.retryable).toBe(true);
  });
});

describe("RateLimitError", () => {
  it("creates with rate limit details", () => {
    const retryDate = new Date(Date.now() + 60000);
    const error = new RateLimitError("Rate limited", {
      retryAfter: retryDate,
      limit: 100,
      remaining: 0,
    });

    expect(error.name).toBe("RateLimitError");
    expect(error.code).toBe("RATE_LIMIT_ERROR");
    expect(error.retryAfter).toBe(retryDate);
    expect(error.retryable).toBe(true);
  });

  it("accepts ms as retryAfter", () => {
    const error = new RateLimitError("Rate limited", {
      retryAfter: 5000,
    });

    expect(error.retryAfterMs).toBe(5000);
  });
});

describe("AuthenticationError", () => {
  it("creates authentication error", () => {
    const error = new AuthenticationError("Invalid API key");

    expect(error.name).toBe("AuthenticationError");
    expect(error.code).toBe("AUTHENTICATION_ERROR");
    expect(error.severity).toBe("fatal");
    expect(error.retryable).toBe(false);
  });
});

describe("AuthorizationError", () => {
  it("creates with resource details", () => {
    const error = new AuthorizationError("Access denied", {
      resource: "/admin",
      action: "read",
    });

    expect(error.name).toBe("AuthorizationError");
    expect(error.code).toBe("AUTHORIZATION_ERROR");
    expect(error.metadata.resource).toBe("/admin");
    expect(error.metadata.action).toBe("read");
    expect(error.retryable).toBe(false);
  });
});

describe("CheckpointError", () => {
  it("creates with checkpoint details", () => {
    const error = new CheckpointError("Save failed", {
      operation: "save",
      threadId: "thread-123",
    });

    expect(error.name).toBe("CheckpointError");
    expect(error.code).toBe("CHECKPOINT_ERROR");
    expect(error.threadId).toBe("thread-123");
    expect(error.operation).toBe("save");
    expect(error.retryable).toBe(true);
  });

  it("is not retryable for load operations", () => {
    const error = new CheckpointError("Load failed", {
      operation: "load",
    });

    expect(error.retryable).toBe(false);
  });
});

describe("BackendError", () => {
  it("creates with backend details", () => {
    const error = new BackendError("Read failed", {
      operation: "read",
      path: "/test/file.txt",
    });

    expect(error.name).toBe("BackendError");
    expect(error.code).toBe("BACKEND_ERROR");
    expect(error.operation).toBe("read");
    expect(error.path).toBe("/test/file.txt");
    expect(error.retryable).toBe(true);
  });
});

describe("ContextError", () => {
  it("creates with context details", () => {
    const error = new ContextError("Context overflow", {
      operation: "compact",
      currentTokens: 100000,
      maxTokens: 50000,
    });

    expect(error.name).toBe("ContextError");
    expect(error.code).toBe("CONTEXT_ERROR");
    expect(error.severity).toBe("warning");
    expect(error.metadata.currentTokens).toBe(100000);
    expect(error.metadata.maxTokens).toBe(50000);
  });
});

describe("SubagentError", () => {
  it("creates with subagent details", () => {
    const error = new SubagentError("Subagent failed", {
      subagentName: "code-reviewer",
      task: "Review PR",
    });

    expect(error.name).toBe("SubagentError");
    expect(error.code).toBe("SUBAGENT_ERROR");
    expect(error.subagentName).toBe("code-reviewer");
    expect(error.task).toBe("Review PR");
    expect(error.retryable).toBe(true);
  });
});

describe("MemoryError", () => {
  it("creates with memory details", () => {
    const error = new MemoryError("Memory load failed", {
      operation: "load",
      memoryPath: "/path/to/memory.md",
    });

    expect(error.name).toBe("MemoryError");
    expect(error.code).toBe("MEMORY_ERROR");
    expect(error.memoryPath).toBe("/path/to/memory.md");
    expect(error.operation).toBe("load");
    expect(error.severity).toBe("warning");
  });
});

describe("AbortError", () => {
  it("creates with default message", () => {
    const error = new AbortError();

    expect(error.name).toBe("AbortError");
    expect(error.code).toBe("ABORT_ERROR");
    expect(error.message).toBe("Operation was aborted");
    expect(error.severity).toBe("warning");
    expect(error.retryable).toBe(false);
  });

  it("creates with custom reason", () => {
    const error = new AbortError("User cancelled", {
      reason: "User pressed cancel button",
    });

    expect(error.reason).toBe("User pressed cancel button");
    expect(error.userMessage).toBe("User pressed cancel button");
  });
});

// =============================================================================
// Utility Functions Tests
// =============================================================================

describe("wrapError", () => {
  it("preserves existing AgentErrors", () => {
    const original = new AgentError("Original", { code: "TOOL_ERROR" });
    const wrapped = wrapError(original, "Wrapped message");

    expect(wrapped).toBe(original);
  });

  it("wraps standard Errors", () => {
    const original = new Error("Original error");
    const wrapped = wrapError(original, "Wrapped context");

    expect(wrapped).toBeInstanceOf(AgentError);
    expect(wrapped.message).toBe("Wrapped context");
    expect(wrapped.cause).toBe(original);
  });

  it("wraps unknown values", () => {
    const wrapped = wrapError("string error", "Wrapped");

    expect(wrapped).toBeInstanceOf(AgentError);
    expect(wrapped.code).toBe("UNKNOWN_ERROR");
    expect(wrapped.metadata.originalError).toBe("string error");
  });

  it("infers error code from message", () => {
    const timeoutError = new Error("Request timed out");
    const wrapped = wrapError(timeoutError, "Wrapped");

    expect(wrapped.code).toBe("TIMEOUT_ERROR");
  });

  it("accepts custom options", () => {
    const original = new Error("Original");
    const wrapped = wrapError(original, "Wrapped", {
      code: "BACKEND_ERROR",
      userMessage: "Custom message",
      metadata: { key: "value" },
    });

    expect(wrapped.code).toBe("BACKEND_ERROR");
    expect(wrapped.userMessage).toBe("Custom message");
    expect(wrapped.metadata.key).toBe("value");
  });
});

describe("isRetryable", () => {
  it("returns true for AgentErrors marked retryable", () => {
    const error = new AgentError("Test", { retryable: true });
    expect(isRetryable(error)).toBe(true);
  });

  it("returns false for AgentErrors not marked retryable", () => {
    const error = new AgentError("Test", { retryable: false });
    expect(isRetryable(error)).toBe(false);
  });

  it("detects retryable standard errors by message", () => {
    expect(isRetryable(new Error("Rate limit exceeded"))).toBe(true);
    expect(isRetryable(new Error("Request timed out"))).toBe(true);
    expect(isRetryable(new Error("Network error"))).toBe(true);
    expect(isRetryable(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryable(new Error("503 Service Unavailable"))).toBe(true);
  });

  it("detects non-retryable errors by message", () => {
    expect(isRetryable(new Error("Invalid input"))).toBe(false);
    expect(isRetryable(new Error("Authentication failed"))).toBe(false);
    expect(isRetryable(new Error("Permission denied"))).toBe(false);
    expect(isRetryable(new Error("Not found"))).toBe(false);
  });
});

describe("getUserMessage", () => {
  it("returns userMessage from AgentErrors", () => {
    const error = new AgentError("Technical", {
      userMessage: "User-friendly message",
    });
    expect(getUserMessage(error)).toBe("User-friendly message");
  });

  it("translates common error patterns", () => {
    expect(getUserMessage(new Error("Rate limit exceeded"))).toContain("busy");
    expect(getUserMessage(new Error("Request timed out"))).toContain("too long");
    expect(getUserMessage(new Error("Network error"))).toContain("network");
    expect(getUserMessage(new Error("401 Unauthorized"))).toContain("Authentication");
    expect(getUserMessage(new Error("403 Forbidden"))).toContain("permission");
    expect(getUserMessage(new Error("404 Not found"))).toContain("not found");
  });

  it("returns fallback for unknown errors", () => {
    expect(getUserMessage("string error", "Custom fallback")).toBe("Custom fallback");
  });

  it("returns short messages as-is", () => {
    expect(getUserMessage(new Error("Short message"))).toBe("Short message");
  });
});

describe("formatErrorForLogging", () => {
  it("formats AgentErrors with full details", () => {
    const error = new AgentError("Test", {
      code: "TOOL_ERROR",
      metadata: { key: "value" },
    });

    const formatted = formatErrorForLogging(error);

    expect(formatted.name).toBe("AgentError");
    expect(formatted.code).toBe("TOOL_ERROR");
    expect(formatted.metadata).toEqual({ key: "value" });
    expect(formatted.stack).toBeDefined();
  });

  it("formats standard Errors", () => {
    const error = new Error("Test error");
    const formatted = formatErrorForLogging(error);

    expect(formatted.name).toBe("Error");
    expect(formatted.message).toBe("Test error");
    expect(formatted.stack).toBeDefined();
  });

  it("formats unknown values", () => {
    const formatted = formatErrorForLogging("string error");

    expect(formatted.type).toBe("string");
    expect(formatted.value).toBe("string error");
  });
});

describe("createErrorHandler", () => {
  it("wraps successful operations", async () => {
    const handler = createErrorHandler({});
    const result = await handler(async () => "success");

    expect(result).toBe("success");
  });

  it("transforms errors", async () => {
    const handler = createErrorHandler({
      transform: (error) =>
        new ToolExecutionError("Transformed", {
          toolName: "test",
          cause: error instanceof Error ? error : undefined,
        }),
    });

    await expect(
      handler(async () => {
        throw new Error("Original");
      }),
    ).rejects.toThrow(ToolExecutionError);
  });

  it("calls onError callback", async () => {
    const onError = vi.fn();
    const handler = createErrorHandler({ onError });

    await expect(
      handler(async () => {
        throw new Error("Test");
      }),
    ).rejects.toThrow();

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(AgentError);
  });
});

// =============================================================================
// Graceful Degradation Tests
// =============================================================================

describe("withFallback", () => {
  it("returns result on success", async () => {
    const result = await withFallback(async () => "success", { fallback: "fallback" });

    expect(result).toBe("success");
  });

  it("returns fallback on error", async () => {
    const result = await withFallback(
      async () => {
        throw new Error("Failed");
      },
      { fallback: "fallback", logError: false },
    );

    expect(result).toBe("fallback");
  });

  it("calls onError callback", async () => {
    const onError = vi.fn();

    await withFallback(
      async () => {
        throw new Error("Failed");
      },
      { fallback: "fallback", logError: false, onError },
    );

    expect(onError).toHaveBeenCalled();
  });

  it("rethrows fatal errors when configured", async () => {
    await expect(
      withFallback(
        async () => {
          throw new AgentError("Fatal", { severity: "fatal" });
        },
        { fallback: "fallback", rethrowFatal: true, logError: false },
      ),
    ).rejects.toThrow(AgentError);
  });

  it("does not rethrow fatal when disabled", async () => {
    const result = await withFallback(
      async () => {
        throw new AgentError("Fatal", { severity: "fatal" });
      },
      { fallback: "fallback", rethrowFatal: false, logError: false },
    );

    expect(result).toBe("fallback");
  });
});

describe("withFallbackFn", () => {
  it("returns result on success", async () => {
    const result = await withFallbackFn(
      async () => "success",
      () => "fallback",
    );

    expect(result).toBe("success");
  });

  it("calls fallback function on error", async () => {
    const result = await withFallbackFn(
      async () => {
        throw new Error("Failed");
      },
      (error) => `fallback: ${error.message}`,
    );

    expect(result).toContain("fallback");
  });

  it("passes error to fallback function", async () => {
    const fallbackFn = vi.fn().mockReturnValue("fallback");

    await withFallbackFn(async () => {
      throw new Error("Failed");
    }, fallbackFn);

    expect(fallbackFn).toHaveBeenCalledWith(expect.any(AgentError));
  });
});

describe("tryOperations", () => {
  it("returns first successful result", async () => {
    const result = await tryOperations([async () => "first", async () => "second"]);

    expect(result).toBe("first");
  });

  it("tries next operation on failure", async () => {
    const result = await tryOperations([
      async () => {
        throw new Error("First failed");
      },
      async () => "second",
    ]);

    expect(result).toBe("second");
  });

  it("throws if all operations fail", async () => {
    await expect(
      tryOperations([
        async () => {
          throw new Error("First");
        },
        async () => {
          throw new Error("Second");
        },
      ]),
    ).rejects.toThrow();
  });

  it("calls onError for each failure", async () => {
    const onError = vi.fn();

    await tryOperations(
      [
        async () => {
          throw new Error("First");
        },
        async () => {
          throw new Error("Second");
        },
        async () => "success",
      ],
      { onError },
    );

    expect(onError).toHaveBeenCalledTimes(2);
  });
});

describe("createCircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows requests when closed", async () => {
    const breaker = createCircuitBreaker({});

    const result = await breaker(async () => "success");

    expect(result).toBe("success");
  });

  it("opens after threshold failures", async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 3,
    });

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker(async () => {
          throw new Error("Failed");
        }),
      ).rejects.toThrow();
    }

    // Circuit should be open
    await expect(breaker(async () => "success")).rejects.toThrow("Circuit breaker is open");
  });

  it("allows request in half-open state after timeout", async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      resetTimeout: 1000,
    });

    // Open the circuit
    await expect(
      breaker(async () => {
        throw new Error("Failed");
      }),
    ).rejects.toThrow();

    // Should be blocked immediately
    await expect(breaker(async () => "success")).rejects.toThrow("Circuit breaker is open");

    // Advance time past reset timeout
    vi.advanceTimersByTime(1100);

    // Should allow request (half-open)
    const result = await breaker(async () => "success");
    expect(result).toBe("success");
  });

  it("closes on success in half-open state", async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      resetTimeout: 1000,
    });

    // Open the circuit
    await expect(
      breaker(async () => {
        throw new Error("Failed");
      }),
    ).rejects.toThrow();

    // Advance time
    vi.advanceTimersByTime(1100);

    // Success closes the circuit
    await breaker(async () => "success");

    // Should continue to work
    const result = await breaker(async () => "another success");
    expect(result).toBe("another success");
  });

  it("calls onStateChange callback", async () => {
    const onStateChange = vi.fn();
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      resetTimeout: 1000,
      onStateChange,
    });

    // Open the circuit
    await expect(
      breaker(async () => {
        throw new Error("Failed");
      }),
    ).rejects.toThrow();

    expect(onStateChange).toHaveBeenCalledWith("open");

    // Advance time
    vi.advanceTimersByTime(1100);

    // Request in half-open
    await breaker(async () => "success");

    expect(onStateChange).toHaveBeenCalledWith("half-open");
    expect(onStateChange).toHaveBeenCalledWith("closed");
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Integration", () => {
  it("full error handling workflow", async () => {
    const errors: AgentError[] = [];

    const handler = createErrorHandler({
      onError: (error) => {
        errors.push(error);
      },
      transform: (error) =>
        wrapError(error, "Handled error", {
          code: "TOOL_ERROR",
          metadata: { handled: true },
        }),
    });

    // Test successful operation
    const success = await handler(async () => "success");
    expect(success).toBe("success");
    expect(errors).toHaveLength(0);

    // Test failed operation
    await expect(
      handler(async () => {
        throw new Error("Original failure");
      }),
    ).rejects.toThrow(AgentError);

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("TOOL_ERROR");
    expect(errors[0].metadata.handled).toBe(true);
  });

  it("nested fallbacks with different strategies", async () => {
    // Try primary -> secondary -> cache
    const result = await withFallbackFn(
      async () => {
        throw new Error("Primary failed");
      },
      async () => {
        return await withFallbackFn(
          async () => {
            throw new Error("Secondary failed");
          },
          () => "cached value",
        );
      },
    );

    expect(result).toBe("cached value");
  });

  it("circuit breaker with retry", async () => {
    vi.useFakeTimers();

    const breaker = createCircuitBreaker({
      failureThreshold: 2,
      resetTimeout: 100,
    });

    let attempts = 0;

    const operation = async () => {
      attempts++;
      if (attempts < 4) {
        throw new Error(`Attempt ${attempts} failed`);
      }
      return "success";
    };

    // First two failures open the circuit
    await expect(breaker(operation)).rejects.toThrow();
    await expect(breaker(operation)).rejects.toThrow();

    // Circuit is open
    await expect(breaker(operation)).rejects.toThrow("Circuit breaker is open");

    // Wait for reset
    vi.advanceTimersByTime(150);

    // Third failure in half-open re-opens
    await expect(breaker(operation)).rejects.toThrow();

    // Wait again
    vi.advanceTimersByTime(150);

    // Fourth attempt succeeds
    const result = await breaker(operation);
    expect(result).toBe("success");
    expect(attempts).toBe(4);
  });

  it("error formatting chain", () => {
    const original = new Error("Network failure");
    const wrapped = wrapError(original, "API call failed", {
      code: "NETWORK_ERROR",
      userMessage: "A network error occurred",
      metadata: { endpoint: "/api/users" },
    });

    const userMsg = getUserMessage(wrapped);
    const logEntry = formatErrorForLogging(wrapped);

    expect(userMsg).toBe("A network error occurred");
    expect(logEntry.code).toBe("NETWORK_ERROR");
    expect(logEntry.metadata).toEqual({ endpoint: "/api/users" });
    expect(logEntry.cause).toBe("Network failure");
  });
});
