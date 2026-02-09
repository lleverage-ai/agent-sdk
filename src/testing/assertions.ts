/**
 * Assertion helpers for agent testing.
 *
 * Provides convenient assertion utilities for testing agent behavior,
 * responses, tool calls, and state.
 *
 * @packageDocumentation
 */

import type { LanguageModelUsage } from "ai";
import type { AgentState, TodoItem } from "../backends/state.js";
import type {
  FinishReason,
  GenerateResult,
  GenerateResultComplete,
  StreamPart,
  ToolCallResult,
} from "../types.js";
import type { MockAgent } from "./mock-agent.js";

/**
 * Ensure a GenerateResult is complete, throwing if it's interrupted.
 * @internal
 */
function ensureComplete(result: GenerateResult): GenerateResultComplete {
  if (result.status === "interrupted") {
    throw new AgentAssertionError(
      "Cannot assert on interrupted result",
      "complete",
      "interrupted",
      { interruptType: result.interrupt.type },
    );
  }
  if (result.status === "handoff") {
    throw new AgentAssertionError("Cannot assert on handoff result", "complete", "handoff");
  }
  return result;
}

// =============================================================================
// Assertion Error
// =============================================================================

/**
 * Error thrown when an agent assertion fails.
 *
 * @category Testing
 */
export class AgentAssertionError extends Error {
  /** The expected value */
  readonly expected: unknown;

  /** The actual value */
  readonly actual: unknown;

  /** Additional context */
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    expected: unknown,
    actual: unknown,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgentAssertionError";
    this.expected = expected;
    this.actual = actual;
    this.context = context;
  }
}

// =============================================================================
// Response Assertions
// =============================================================================

/**
 * Assert that a response contains specific text.
 *
 * @param result - The generate result to check
 * @param text - Text that should be present
 * @throws AgentAssertionError if text is not found
 *
 * @example
 * ```typescript
 * const result = await agent.generate({ prompt: "Say hello" });
 * assertResponseContains(result, "hello");
 * ```
 *
 * @category Testing
 */
export function assertResponseContains(result: GenerateResult, text: string): void {
  const complete = ensureComplete(result);
  if (!complete.text.toLowerCase().includes(text.toLowerCase())) {
    throw new AgentAssertionError(`Expected response to contain "${text}"`, text, complete.text, {
      fullText: complete.text,
    });
  }
}

/**
 * Assert that a response matches a regular expression.
 *
 * @param result - The generate result to check
 * @param pattern - Pattern to match against
 * @throws AgentAssertionError if pattern doesn't match
 *
 * @example
 * ```typescript
 * assertResponseMatches(result, /hello.*world/i);
 * ```
 *
 * @category Testing
 */
export function assertResponseMatches(result: GenerateResult, pattern: RegExp): void {
  const complete = ensureComplete(result);
  if (!pattern.test(complete.text)) {
    throw new AgentAssertionError(
      `Expected response to match pattern ${pattern}`,
      pattern.toString(),
      complete.text,
      { fullText: complete.text },
    );
  }
}

/**
 * Assert that a response has a specific finish reason.
 *
 * @param result - The generate result to check
 * @param reason - Expected finish reason
 * @throws AgentAssertionError if reason doesn't match
 *
 * @example
 * ```typescript
 * assertFinishReason(result, "stop");
 * ```
 *
 * @category Testing
 */
export function assertFinishReason(result: GenerateResult, reason: FinishReason): void {
  const complete = ensureComplete(result);
  if (complete.finishReason !== reason) {
    throw new AgentAssertionError(
      `Expected finish reason "${reason}", got "${complete.finishReason}"`,
      reason,
      complete.finishReason,
    );
  }
}

/**
 * Assert that a response has usage information.
 *
 * @param result - The generate result to check
 * @throws AgentAssertionError if usage is missing
 *
 * @example
 * ```typescript
 * assertHasUsage(result);
 * console.log(result.usage.inputTokens);
 * ```
 *
 * @category Testing
 */
export function assertHasUsage(result: GenerateResult): asserts result is GenerateResultComplete & {
  usage: LanguageModelUsage;
} {
  const complete = ensureComplete(result);
  if (!complete.usage) {
    throw new AgentAssertionError(
      "Expected response to have usage information",
      "usage object",
      undefined,
    );
  }
}

/**
 * Assert that token usage is within expected bounds.
 *
 * @param result - The generate result to check
 * @param options - Usage bounds
 * @throws AgentAssertionError if usage is outside bounds
 *
 * @example
 * ```typescript
 * assertUsageWithin(result, {
 *   maxInputTokens: 1000,
 *   maxOutputTokens: 500,
 * });
 * ```
 *
 * @category Testing
 */
export function assertUsageWithin(
  result: GenerateResult,
  options: {
    minInputTokens?: number;
    maxInputTokens?: number;
    minOutputTokens?: number;
    maxOutputTokens?: number;
  },
): void {
  const complete = ensureComplete(result);
  if (!complete.usage) {
    throw new AgentAssertionError(
      "Expected response to have usage information",
      "usage object",
      undefined,
    );
  }

  const inputTokens = complete.usage.inputTokens ?? 0;
  const outputTokens = complete.usage.outputTokens ?? 0;

  if (options.minInputTokens !== undefined && inputTokens < options.minInputTokens) {
    throw new AgentAssertionError(
      `Expected at least ${options.minInputTokens} input tokens, got ${inputTokens}`,
      options.minInputTokens,
      inputTokens,
    );
  }

  if (options.maxInputTokens !== undefined && inputTokens > options.maxInputTokens) {
    throw new AgentAssertionError(
      `Expected at most ${options.maxInputTokens} input tokens, got ${inputTokens}`,
      options.maxInputTokens,
      inputTokens,
    );
  }

  if (options.minOutputTokens !== undefined && outputTokens < options.minOutputTokens) {
    throw new AgentAssertionError(
      `Expected at least ${options.minOutputTokens} output tokens, got ${outputTokens}`,
      options.minOutputTokens,
      outputTokens,
    );
  }

  if (options.maxOutputTokens !== undefined && outputTokens > options.maxOutputTokens) {
    throw new AgentAssertionError(
      `Expected at most ${options.maxOutputTokens} output tokens, got ${outputTokens}`,
      options.maxOutputTokens,
      outputTokens,
    );
  }
}

/**
 * Assert that structured output was generated.
 *
 * @param result - The generate result to check
 * @throws AgentAssertionError if output is missing
 *
 * @example
 * ```typescript
 * assertHasOutput(result);
 * const data = result.output as MySchema;
 * ```
 *
 * @category Testing
 */
export function assertHasOutput(
  result: GenerateResult,
): asserts result is GenerateResultComplete & {
  output: unknown;
} {
  const complete = ensureComplete(result);
  if (complete.output === undefined) {
    throw new AgentAssertionError(
      "Expected response to have structured output",
      "output object",
      undefined,
    );
  }
}

// =============================================================================
// Tool Call Assertions
// =============================================================================

/**
 * Assert that a specific tool was called.
 *
 * @param result - The generate result to check
 * @param toolName - Name of the tool expected to be called
 * @returns The matching tool call
 * @throws AgentAssertionError if tool was not called
 *
 * @example
 * ```typescript
 * const toolCall = assertToolCalled(result, "weather");
 * expect(toolCall.input.city).toBe("Tokyo");
 * ```
 *
 * @category Testing
 */
export function assertToolCalled(result: GenerateResult, toolName: string): ToolCallResult {
  const complete = ensureComplete(result);
  for (const step of complete.steps) {
    for (const toolCall of step.toolCalls) {
      if (toolCall.toolName === toolName) {
        return toolCall;
      }
    }
  }

  const calledTools = complete.steps
    .flatMap((s: { toolCalls: ToolCallResult[] }) => s.toolCalls)
    .map((tc: ToolCallResult) => tc.toolName);

  throw new AgentAssertionError(`Expected tool "${toolName}" to be called`, toolName, calledTools, {
    calledTools,
  });
}

/**
 * Assert that a tool was called with specific input.
 *
 * @param result - The generate result to check
 * @param toolName - Name of the tool
 * @param expectedInput - Expected input (partial match)
 * @returns The matching tool call
 * @throws AgentAssertionError if tool was not called with expected input
 *
 * @example
 * ```typescript
 * assertToolCalledWith(result, "weather", { city: "Tokyo" });
 * ```
 *
 * @category Testing
 */
export function assertToolCalledWith(
  result: GenerateResult,
  toolName: string,
  expectedInput: Record<string, unknown>,
): ToolCallResult {
  const complete = ensureComplete(result);
  for (const step of complete.steps) {
    for (const toolCall of step.toolCalls) {
      if (toolCall.toolName === toolName) {
        const input = toolCall.input as Record<string, unknown>;
        let matches = true;

        for (const [key, value] of Object.entries(expectedInput)) {
          if (input[key] !== value) {
            matches = false;
            break;
          }
        }

        if (matches) {
          return toolCall;
        }
      }
    }
  }

  const toolCalls = complete.steps
    .flatMap((s: { toolCalls: ToolCallResult[] }) => s.toolCalls)
    .filter((tc: ToolCallResult) => tc.toolName === toolName)
    .map((tc: ToolCallResult) => tc.input);

  throw new AgentAssertionError(
    `Expected tool "${toolName}" to be called with ${JSON.stringify(expectedInput)}`,
    expectedInput,
    toolCalls,
    { toolCalls },
  );
}

/**
 * Assert that a tool was NOT called.
 *
 * @param result - The generate result to check
 * @param toolName - Name of the tool that should not be called
 * @throws AgentAssertionError if tool was called
 *
 * @example
 * ```typescript
 * assertToolNotCalled(result, "dangerousTool");
 * ```
 *
 * @category Testing
 */
export function assertToolNotCalled(result: GenerateResult, toolName: string): void {
  const complete = ensureComplete(result);
  for (const step of complete.steps) {
    for (const toolCall of step.toolCalls) {
      if (toolCall.toolName === toolName) {
        throw new AgentAssertionError(
          `Expected tool "${toolName}" to NOT be called`,
          "tool not called",
          toolCall,
          { toolCall },
        );
      }
    }
  }
}

/**
 * Assert the number of times a tool was called.
 *
 * @param result - The generate result to check
 * @param toolName - Name of the tool
 * @param count - Expected call count
 * @throws AgentAssertionError if count doesn't match
 *
 * @example
 * ```typescript
 * assertToolCallCount(result, "search", 3);
 * ```
 *
 * @category Testing
 */
export function assertToolCallCount(result: GenerateResult, toolName: string, count: number): void {
  const complete = ensureComplete(result);
  let actualCount = 0;

  for (const step of complete.steps) {
    for (const toolCall of step.toolCalls) {
      if (toolCall.toolName === toolName) {
        actualCount++;
      }
    }
  }

  if (actualCount !== count) {
    throw new AgentAssertionError(
      `Expected tool "${toolName}" to be called ${count} times, got ${actualCount}`,
      count,
      actualCount,
    );
  }
}

/**
 * Assert that steps were executed.
 *
 * @param result - The generate result to check
 * @param minSteps - Minimum expected steps
 * @param maxSteps - Maximum expected steps (optional)
 * @throws AgentAssertionError if step count is outside bounds
 *
 * @example
 * ```typescript
 * assertStepCount(result, 1, 5);
 * ```
 *
 * @category Testing
 */
export function assertStepCount(result: GenerateResult, minSteps: number, maxSteps?: number): void {
  const complete = ensureComplete(result);
  const stepCount = complete.steps.length;

  if (stepCount < minSteps) {
    throw new AgentAssertionError(
      `Expected at least ${minSteps} steps, got ${stepCount}`,
      minSteps,
      stepCount,
    );
  }

  if (maxSteps !== undefined && stepCount > maxSteps) {
    throw new AgentAssertionError(
      `Expected at most ${maxSteps} steps, got ${stepCount}`,
      maxSteps,
      stepCount,
    );
  }
}

// =============================================================================
// Stream Assertions
// =============================================================================

/**
 * Collect all chunks from a stream into an array.
 *
 * @param stream - The stream to collect
 * @returns Array of all stream parts
 *
 * @example
 * ```typescript
 * const chunks = await collectStreamChunks(agent.stream({ prompt: "Hi" }));
 * assertStreamHasText(chunks);
 * ```
 *
 * @category Testing
 */
export async function collectStreamChunks(
  stream: AsyncGenerator<StreamPart>,
): Promise<StreamPart[]> {
  const chunks: StreamPart[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * Assert that a stream contains text chunks.
 *
 * @param chunks - Collected stream chunks
 * @throws AgentAssertionError if no text chunks found
 *
 * @category Testing
 */
export function assertStreamHasText(chunks: StreamPart[]): void {
  const hasText = chunks.some((c) => c.type === "text-delta");
  if (!hasText) {
    throw new AgentAssertionError(
      "Expected stream to contain text chunks",
      "text-delta chunks",
      chunks.map((c) => c.type),
    );
  }
}

/**
 * Assert that a stream has a finish chunk.
 *
 * @param chunks - Collected stream chunks
 * @param reason - Optional expected finish reason
 * @throws AgentAssertionError if no finish chunk or wrong reason
 *
 * @category Testing
 */
export function assertStreamFinished(chunks: StreamPart[], reason?: FinishReason): void {
  const finishChunk = chunks.find((c) => c.type === "finish");

  if (!finishChunk) {
    throw new AgentAssertionError(
      "Expected stream to have a finish chunk",
      "finish chunk",
      chunks.map((c) => c.type),
    );
  }

  if (reason && finishChunk.type === "finish" && finishChunk.finishReason !== reason) {
    throw new AgentAssertionError(
      `Expected finish reason "${reason}", got "${finishChunk.finishReason}"`,
      reason,
      finishChunk.finishReason,
    );
  }
}

/**
 * Get the combined text from stream chunks.
 *
 * @param chunks - Collected stream chunks
 * @returns Combined text
 *
 * @example
 * ```typescript
 * const chunks = await collectStreamChunks(stream);
 * const text = getStreamText(chunks);
 * expect(text).toContain("hello");
 * ```
 *
 * @category Testing
 */
export function getStreamText(chunks: StreamPart[]): string {
  return chunks
    .filter((c): c is { type: "text-delta"; text: string } => c.type === "text-delta")
    .map((c) => c.text)
    .join("");
}

/**
 * Assert that the combined stream text contains specific content.
 *
 * @param chunks - Collected stream chunks
 * @param text - Text to look for
 * @throws AgentAssertionError if text not found
 *
 * @category Testing
 */
export function assertStreamTextContains(chunks: StreamPart[], text: string): void {
  const fullText = getStreamText(chunks);
  if (!fullText.toLowerCase().includes(text.toLowerCase())) {
    throw new AgentAssertionError(`Expected stream text to contain "${text}"`, text, fullText);
  }
}

// =============================================================================
// Agent State Assertions
// =============================================================================

/**
 * Assert that agent state contains a file.
 *
 * @param state - The agent state to check
 * @param path - File path
 * @throws AgentAssertionError if file doesn't exist
 *
 * @example
 * ```typescript
 * assertStateHasFile(agent.state, "/src/index.ts");
 * ```
 *
 * @category Testing
 */
export function assertStateHasFile(state: AgentState, path: string): void {
  if (!state.files[path]) {
    throw new AgentAssertionError(
      `Expected state to have file "${path}"`,
      path,
      Object.keys(state.files),
    );
  }
}

/**
 * Assert that agent state has a todo item.
 *
 * @param state - The agent state to check
 * @param matcher - Todo content or partial match
 * @returns The matching todo
 * @throws AgentAssertionError if todo not found
 *
 * @example
 * ```typescript
 * const todo = assertStateHasTodo(agent.state, { content: "Fix bug" });
 * expect(todo.status).toBe("completed");
 * ```
 *
 * @category Testing
 */
export function assertStateHasTodo(
  state: AgentState,
  matcher: string | Partial<TodoItem>,
): TodoItem {
  const predicate =
    typeof matcher === "string"
      ? (t: TodoItem) => t.content.includes(matcher)
      : (t: TodoItem) => {
          for (const [key, value] of Object.entries(matcher)) {
            if (t[key as keyof TodoItem] !== value) {
              return false;
            }
          }
          return true;
        };

  const found = state.todos.find(predicate);

  if (!found) {
    throw new AgentAssertionError(`Expected state to have matching todo`, matcher, state.todos);
  }

  return found;
}

/**
 * Assert the number of todos in a state.
 *
 * @param state - The agent state to check
 * @param count - Expected todo count
 * @param status - Optional filter by status
 * @throws AgentAssertionError if count doesn't match
 *
 * @example
 * ```typescript
 * assertTodoCount(agent.state, 3);
 * assertTodoCount(agent.state, 1, "completed");
 * ```
 *
 * @category Testing
 */
export function assertTodoCount(
  state: AgentState,
  count: number,
  status?: TodoItem["status"],
): void {
  const todos = status ? state.todos.filter((t) => t.status === status) : state.todos;

  if (todos.length !== count) {
    throw new AgentAssertionError(
      `Expected ${count} todos${status ? ` with status "${status}"` : ""}, got ${todos.length}`,
      count,
      todos.length,
      { todos },
    );
  }
}

// =============================================================================
// Mock Agent Assertions
// =============================================================================

/**
 * Assert that a mock agent was called.
 *
 * @param agent - The mock agent
 * @param method - Method to check ("generate" or "stream")
 * @throws AgentAssertionError if not called
 *
 * @category Testing
 */
export function assertMockAgentCalled(
  agent: MockAgent,
  method: "generate" | "stream" = "generate",
): void {
  const calls = method === "generate" ? agent.generateCalls : agent.streamCalls;

  if (calls.length === 0) {
    throw new AgentAssertionError(
      `Expected mock agent ${method}() to be called`,
      "at least 1 call",
      0,
    );
  }
}

/**
 * Assert that a mock agent was called a specific number of times.
 *
 * @param agent - The mock agent
 * @param count - Expected call count
 * @param method - Method to check ("generate" or "stream")
 * @throws AgentAssertionError if count doesn't match
 *
 * @category Testing
 */
export function assertMockAgentCallCount(
  agent: MockAgent,
  count: number,
  method: "generate" | "stream" = "generate",
): void {
  const calls = method === "generate" ? agent.generateCalls : agent.streamCalls;

  if (calls.length !== count) {
    throw new AgentAssertionError(
      `Expected mock agent ${method}() to be called ${count} times`,
      count,
      calls.length,
    );
  }
}

/**
 * Assert that a mock agent was called with specific options.
 *
 * @param agent - The mock agent
 * @param options - Expected options (partial match)
 * @param method - Method to check
 * @throws AgentAssertionError if not called with options
 *
 * @category Testing
 */
export function assertMockAgentCalledWith(
  agent: MockAgent,
  options: Record<string, unknown>,
  method: "generate" | "stream" = "generate",
): void {
  const calls = method === "generate" ? agent.generateCalls : agent.streamCalls;

  const found = calls.some((call) => {
    for (const [key, value] of Object.entries(options)) {
      if ((call as Record<string, unknown>)[key] !== value) {
        return false;
      }
    }
    return true;
  });

  if (!found) {
    throw new AgentAssertionError(
      `Expected mock agent ${method}() to be called with matching options`,
      options,
      calls,
    );
  }
}

// =============================================================================
// Composite Assertions
// =============================================================================

/**
 * Options for assertAgentBehavior.
 *
 * @category Testing
 */
export interface AgentBehaviorOptions {
  /** Expected response text (partial match) */
  responseContains?: string | string[];

  /** Expected response pattern */
  responseMatches?: RegExp;

  /** Expected finish reason */
  finishReason?: FinishReason;

  /** Tools that should be called */
  toolsCalled?: string[];

  /** Tools that should NOT be called */
  toolsNotCalled?: string[];

  /** Minimum steps */
  minSteps?: number;

  /** Maximum steps */
  maxSteps?: number;

  /** Has structured output */
  hasOutput?: boolean;

  /** Has usage information */
  hasUsage?: boolean;
}

/**
 * Assert multiple agent behavior expectations at once.
 *
 * This is a convenience function that combines multiple assertions.
 *
 * @param result - The generate result to check
 * @param options - Behavior expectations
 * @throws AgentAssertionError if any expectation fails
 *
 * @example
 * ```typescript
 * assertAgentBehavior(result, {
 *   responseContains: ["hello", "world"],
 *   finishReason: "stop",
 *   toolsCalled: ["search"],
 *   toolsNotCalled: ["delete"],
 *   minSteps: 1,
 *   hasUsage: true,
 * });
 * ```
 *
 * @category Testing
 */
export function assertAgentBehavior(result: GenerateResult, options: AgentBehaviorOptions): void {
  // Response text assertions
  if (options.responseContains) {
    const texts = Array.isArray(options.responseContains)
      ? options.responseContains
      : [options.responseContains];
    for (const text of texts) {
      assertResponseContains(result, text);
    }
  }

  if (options.responseMatches) {
    assertResponseMatches(result, options.responseMatches);
  }

  // Finish reason
  if (options.finishReason) {
    assertFinishReason(result, options.finishReason);
  }

  // Tool assertions
  if (options.toolsCalled) {
    for (const tool of options.toolsCalled) {
      assertToolCalled(result, tool);
    }
  }

  if (options.toolsNotCalled) {
    for (const tool of options.toolsNotCalled) {
      assertToolNotCalled(result, tool);
    }
  }

  // Step count
  if (options.minSteps !== undefined || options.maxSteps !== undefined) {
    assertStepCount(result, options.minSteps ?? 0, options.maxSteps);
  }

  // Output
  if (options.hasOutput) {
    assertHasOutput(result);
  }

  // Usage
  if (options.hasUsage) {
    assertHasUsage(result);
  }
}
