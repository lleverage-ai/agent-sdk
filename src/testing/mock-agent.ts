/**
 * Mock agent implementation for testing.
 *
 * Provides a fully configurable mock agent that can be used in tests
 * without making real API calls.
 *
 * @packageDocumentation
 */

import type { LanguageModel, LanguageModelUsage, ModelMessage, ToolSet } from "ai";
import type { BackendProtocol } from "../backend.js";
import type { AgentState } from "../backends/state.js";
import { StateBackend } from "../backends/state.js";
import { TaskManager } from "../task-manager.js";
import type { SkillDefinition } from "../tools/skills.js";
import type {
  Agent,
  AgentOptions,
  FinishReason,
  GenerateOptions,
  GenerateResult,
  GenerateStep,
  StreamPart,
} from "../types.js";

// =============================================================================
// Mock Response Configuration
// =============================================================================

/**
 * Configuration for a mock response.
 *
 * @category Testing
 */
export interface MockResponse {
  /** The text response to return */
  text: string;

  /** Finish reason */
  finishReason?: FinishReason;

  /** Token usage information */
  usage?: LanguageModelUsage;

  /** Structured output if using output schema */
  output?: unknown;

  /** Steps to include in the response */
  steps?: GenerateStep[];

  /** Delay in milliseconds before responding */
  delay?: number;

  /** Error to throw instead of returning a response */
  error?: Error;

  /** Stream chunks for streaming responses */
  streamChunks?: StreamPart[];
}

/**
 * Default mock response configuration.
 */
const DEFAULT_MOCK_RESPONSE: MockResponse = {
  text: "Mock response",
  finishReason: "stop",
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    inputTokenDetails: {
      noCacheTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokenDetails: {
      textTokens: 20,
      reasoningTokens: 0,
    },
  },
  steps: [],
};

// =============================================================================
// Mock Agent Options
// =============================================================================

/**
 * Options for creating a mock agent.
 *
 * @category Testing
 */
export interface MockAgentOptions {
  /** Static response to return for all requests */
  response?: MockResponse;

  /** Function to dynamically generate responses based on input */
  responseHandler?: (options: GenerateOptions) => MockResponse | Promise<MockResponse>;

  /** Queue of responses to return in order */
  responseQueue?: MockResponse[];

  /** Initial state for the agent */
  initialState?: Partial<AgentState>;

  /** Backend to use (defaults to StateBackend) */
  backend?: BackendProtocol;

  /** Tools available to the mock agent */
  tools?: ToolSet;

  /** Skills available to the mock agent */
  skills?: SkillDefinition[];

  /** System prompt for the mock agent */
  systemPrompt?: string;

  /** Max steps configuration */
  maxSteps?: number;

  /** ID for the mock agent */
  id?: string;
}

// =============================================================================
// Mock Agent Implementation
// =============================================================================

/**
 * Module-level counter for generating unique mock agent IDs.
 * This ensures each call to createMockAgent() produces a unique ID.
 */
let mockAgentIdCounter = 0;

/**
 * A mock agent for testing purposes.
 *
 * Extends the standard Agent interface with additional methods
 * for configuring mock behavior and inspecting calls.
 *
 * @category Testing
 */
export interface MockAgent extends Agent {
  /**
   * All calls made to generate().
   */
  readonly generateCalls: GenerateOptions[];

  /**
   * All calls made to stream().
   */
  readonly streamCalls: GenerateOptions[];

  /**
   * Set a static response for all subsequent requests.
   */
  setResponse(response: MockResponse): void;

  /**
   * Set a response handler for dynamic responses.
   */
  setResponseHandler(
    handler: (options: GenerateOptions) => MockResponse | Promise<MockResponse>,
  ): void;

  /**
   * Queue responses to be returned in order.
   */
  queueResponses(...responses: MockResponse[]): void;

  /**
   * Clear all queued responses.
   */
  clearQueue(): void;

  /**
   * Reset all call history.
   */
  resetHistory(): void;

  /**
   * Get the number of times generate was called.
   */
  getGenerateCallCount(): number;

  /**
   * Get the number of times stream was called.
   */
  getStreamCallCount(): number;

  /**
   * Assert that generate was called with specific options.
   */
  assertGenerateCalledWith(expected: Partial<GenerateOptions>): void;

  /**
   * Assert that generate was called a specific number of times.
   */
  assertGenerateCallCount(count: number): void;
}

/**
 * Creates a mock agent for testing.
 *
 * Mock agents provide predictable responses and call tracking
 * without making real API calls. They're useful for unit testing
 * agent-dependent code.
 *
 * @param options - Configuration for the mock agent
 * @returns A mock agent instance
 *
 * @example
 * ```typescript
 * import { createMockAgent } from "@lleverage-ai/agent-sdk/testing";
 *
 * const agent = createMockAgent({
 *   response: { text: "Hello from mock!" },
 * });
 *
 * const result = await agent.generate({ prompt: "Hi" });
 * expect(result.text).toBe("Hello from mock!");
 * expect(agent.generateCalls).toHaveLength(1);
 * ```
 *
 * @example
 * ```typescript
 * // Dynamic responses based on input
 * const agent = createMockAgent({
 *   responseHandler: (opts) => ({
 *     text: `You said: ${opts.prompt}`,
 *   }),
 * });
 *
 * const result = await agent.generate({ prompt: "hello" });
 * expect(result.text).toBe("You said: hello");
 * ```
 *
 * @example
 * ```typescript
 * // Queue multiple responses
 * const agent = createMockAgent();
 * agent.queueResponses(
 *   { text: "First response" },
 *   { text: "Second response" },
 * );
 *
 * const r1 = await agent.generate({ prompt: "1" });
 * const r2 = await agent.generate({ prompt: "2" });
 * expect(r1.text).toBe("First response");
 * expect(r2.text).toBe("Second response");
 * ```
 *
 * @category Testing
 */
export function createMockAgent(options: MockAgentOptions = {}): MockAgent {
  const id = options.id ?? `mock-agent-${++mockAgentIdCounter}`;

  // Initialize state
  const state: AgentState = {
    todos: options.initialState?.todos ?? [],
    files: options.initialState?.files ?? {},
  };

  // Initialize backend
  const backend: BackendProtocol = options.backend ?? new StateBackend(state);

  // Initialize task manager
  const taskManager = new TaskManager();

  // Response configuration
  let currentResponse: MockResponse = options.response ?? DEFAULT_MOCK_RESPONSE;
  let responseHandler = options.responseHandler;
  const responseQueue: MockResponse[] = [...(options.responseQueue ?? [])];

  // Call tracking
  const generateCalls: GenerateOptions[] = [];
  const streamCalls: GenerateOptions[] = [];

  // Mock model (not actually used, but needed for interface)
  const mockModel: LanguageModel = {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock-model",
    defaultObjectGenerationMode: "json",
    doGenerate: async () => ({
      text: currentResponse.text,
      content: [{ type: "text", text: currentResponse.text }],
      toolCalls: [],
      finishReason: currentResponse.finishReason ?? "stop",
      usage: currentResponse.usage ?? DEFAULT_MOCK_RESPONSE.usage!,
      request: { body: {} },
      response: {
        id: "mock-response-id",
        timestamp: new Date(),
        modelId: "mock-model",
        headers: {},
      },
      warnings: [],
      sources: [],
      providerMetadata: undefined,
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "text-delta",
            text: currentResponse.text,
          });
          controller.enqueue({
            type: "finish",
            finishReason: currentResponse.finishReason ?? "stop",
            usage: currentResponse.usage ?? DEFAULT_MOCK_RESPONSE.usage!,
          });
          controller.close();
        },
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  } as unknown as LanguageModel;

  const agentOptions: AgentOptions = {
    model: mockModel,
    systemPrompt: options.systemPrompt,
    tools: options.tools,
    skills: options.skills,
    maxSteps: options.maxSteps,
  };

  /**
   * Get the next response to use.
   */
  async function getNextResponse(genOptions: GenerateOptions): Promise<MockResponse> {
    // Check queue first
    if (responseQueue.length > 0) {
      return responseQueue.shift()!;
    }

    // Use handler if provided
    if (responseHandler) {
      return await responseHandler(genOptions);
    }

    // Fall back to static response
    return currentResponse;
  }

  /**
   * Convert MockResponse to GenerateResult.
   */
  function toGenerateResult(response: MockResponse): GenerateResult {
    return {
      status: "complete",
      text: response.text,
      finishReason: response.finishReason ?? "stop",
      usage: response.usage ?? DEFAULT_MOCK_RESPONSE.usage,
      output: response.output,
      steps: response.steps ?? [],
    };
  }

  /**
   * Convert MockResponse to stream chunks.
   */
  function* toStreamChunks(response: MockResponse): Generator<StreamPart> {
    // Use custom stream chunks if provided
    if (response.streamChunks) {
      for (const chunk of response.streamChunks) {
        yield chunk;
      }
      return;
    }

    // Default: yield text as a single chunk, then finish
    yield { type: "text-delta", text: response.text };
    yield {
      type: "finish",
      finishReason: response.finishReason ?? "stop",
      usage: response.usage,
    };
  }

  const mockAgent: MockAgent = {
    id,
    options: agentOptions,
    backend,
    state,
    taskManager,

    // Call tracking
    generateCalls,
    streamCalls,

    getSkills() {
      return [...(options.skills ?? [])];
    },

    async generate(genOptions: GenerateOptions): Promise<GenerateResult> {
      generateCalls.push({ ...genOptions });

      const response = await getNextResponse(genOptions);

      // Handle delay
      if (response.delay && response.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, response.delay));
      }

      // Handle error
      if (response.error) {
        throw response.error;
      }

      return toGenerateResult(response);
    },

    async *stream(genOptions: GenerateOptions): AsyncGenerator<StreamPart> {
      streamCalls.push({ ...genOptions });

      const response = await getNextResponse(genOptions);

      // Handle delay
      if (response.delay && response.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, response.delay));
      }

      // Handle error
      if (response.error) {
        yield { type: "error", error: response.error };
        return;
      }

      for (const chunk of toStreamChunks(response)) {
        yield chunk;
      }
    },

    async streamResponse(genOptions: GenerateOptions): Promise<Response> {
      streamCalls.push({ ...genOptions });

      const response = await getNextResponse(genOptions);

      // Handle delay
      if (response.delay && response.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, response.delay));
      }

      // Handle error
      if (response.error) {
        return new Response(JSON.stringify({ error: response.error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Return a simple text response
      return new Response(response.text, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    },

    async streamDataResponse(genOptions: GenerateOptions): Promise<Response> {
      // For mock agent, streamDataResponse behaves the same as streamResponse
      // since we don't have real streaming tools to exercise
      return mockAgent.streamResponse(genOptions);
    },

    async streamRaw(genOptions: GenerateOptions) {
      streamCalls.push({ ...genOptions });

      const response = await getNextResponse(genOptions);

      // Return a mock streamText-like result
      return {
        fullStream: (async function* () {
          if (response.error) {
            yield { type: "error" as const, error: response.error };
            return;
          }
          yield { type: "text-delta" as const, text: response.text };
          yield {
            type: "finish" as const,
            finishReason: response.finishReason ?? "stop",
            totalUsage: response.usage,
          };
        })(),
        text: Promise.resolve(response.text),
        usage: Promise.resolve(response.usage ?? DEFAULT_MOCK_RESPONSE.usage!),
        finishReason: Promise.resolve(response.finishReason ?? "stop"),
        steps: Promise.resolve(response.steps ?? []),
        output: Promise.resolve(response.output),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        response: Promise.resolve({
          id: "mock-response-id",
          timestamp: new Date(),
          modelId: "mock-model",
          messages: [] as ModelMessage[],
        }),
        warnings: Promise.resolve([]),
        toUIMessageStreamResponse: () => new Response(response.text),
        toTextStreamResponse: () => new Response(response.text),
      } as never;
    },

    // Configuration methods
    setResponse(response: MockResponse): void {
      currentResponse = response;
    },

    setResponseHandler(
      handler: (options: GenerateOptions) => MockResponse | Promise<MockResponse>,
    ): void {
      responseHandler = handler;
    },

    queueResponses(...responses: MockResponse[]): void {
      responseQueue.push(...responses);
    },

    clearQueue(): void {
      responseQueue.length = 0;
    },

    resetHistory(): void {
      generateCalls.length = 0;
      streamCalls.length = 0;
    },

    getGenerateCallCount(): number {
      return generateCalls.length;
    },

    getStreamCallCount(): number {
      return streamCalls.length;
    },

    assertGenerateCalledWith(expected: Partial<GenerateOptions>): void {
      const found = generateCalls.some((call) => {
        for (const [key, value] of Object.entries(expected)) {
          if (call[key as keyof GenerateOptions] !== value) {
            return false;
          }
        }
        return true;
      });

      if (!found) {
        const callsStr = generateCalls.map((c) => JSON.stringify(c)).join("\n");
        throw new Error(
          `Expected generate to be called with ${JSON.stringify(expected)}, but calls were:\n${callsStr}`,
        );
      }
    },

    assertGenerateCallCount(count: number): void {
      if (generateCalls.length !== count) {
        throw new Error(
          `Expected generate to be called ${count} times, but was called ${generateCalls.length} times`,
        );
      }
    },

    getActiveTools() {
      return { ...(options.tools ?? {}) };
    },

    loadTools(_toolNames: string[]) {
      // Mock agent doesn't support lazy loading
      return { loaded: [], notFound: _toolNames };
    },

    setPermissionMode(_mode) {
      // Mock agent permission mode setter (no-op in mock)
    },

    async getInterrupt(_threadId: string) {
      // Mock agent always returns undefined (no pending interrupts)
      return undefined;
    },

    async resume(
      threadId: string,
      _interruptId: string,
      _response: unknown,
      genOptions?: Partial<GenerateOptions>,
    ): Promise<GenerateResult> {
      // Mock implementation: just call generate with the threadId
      return mockAgent.generate({
        threadId,
        ...genOptions,
      });
    },

    async dispose(): Promise<void> {
      // Kill all running background tasks
      await taskManager.killAllTasks();
    },

    // Mock agent is always ready immediately
    ready: Promise.resolve(),
  };

  return mockAgent;
}

// =============================================================================
// Mock Model
// =============================================================================

/**
 * Options for creating a mock language model.
 *
 * @category Testing
 */
export interface MockModelOptions {
  /** Default text response */
  text?: string;

  /** Default tool calls to return */
  toolCalls?: Array<{ toolName: string; input: unknown }>;

  /** Default finish reason */
  finishReason?: FinishReason;

  /** Default usage */
  usage?: LanguageModelUsage;

  /** Provider name */
  provider?: string;

  /** Model ID */
  modelId?: string;
}

/**
 * Creates a mock language model for testing.
 *
 * This is a lower-level utility for creating mock models that can be
 * passed to createAgent() when you need more control over the model behavior.
 *
 * @param options - Configuration for the mock model
 * @returns A mock LanguageModel instance
 *
 * @example
 * ```typescript
 * import { createMockModel } from "@lleverage-ai/agent-sdk/testing";
 * import { createAgent } from "@lleverage-ai/agent-sdk";
 *
 * const model = createMockModel({ text: "Custom response" });
 * const agent = createAgent({ model });
 * ```
 *
 * @category Testing
 */
export function createMockModel(options: MockModelOptions = {}): LanguageModel {
  const text = options.text ?? "Mock response";
  const finishReason = options.finishReason ?? "stop";
  const usage: LanguageModelUsage = options.usage ?? {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    inputTokenDetails: {
      noCacheTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokenDetails: {
      textTokens: 20,
      reasoningTokens: 0,
    },
  };

  return {
    specificationVersion: "v3" as const,
    provider: options.provider ?? "mock",
    modelId: options.modelId ?? "mock-model",
    defaultObjectGenerationMode: "json" as const,

    doGenerate: async () => ({
      text,
      content: [{ type: "text", text }],
      toolCalls: options.toolCalls ?? [],
      finishReason,
      usage,
      request: { body: {} },
      response: {
        id: "mock-response-id",
        timestamp: new Date(),
        modelId: options.modelId ?? "mock-model",
        headers: {},
      },
      warnings: [],
      sources: [],
      providerMetadata: undefined,
    }),

    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", text });
          controller.enqueue({
            type: "finish",
            finishReason,
            usage,
            providerMetadata: undefined,
          });
          controller.close();
        },
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  } as unknown as LanguageModel;
}
