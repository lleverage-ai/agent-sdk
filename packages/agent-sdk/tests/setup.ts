import type { LanguageModel } from "ai";
import { vi } from "vitest";

/**
 * Creates a mock language model for testing
 * This mock properly implements the LanguageModelV3 interface expected by AI SDK v6
 */
export function createMockModel(options?: {
  text?: string;
  toolCalls?: Array<{ toolName: string; input: unknown }>;
}): LanguageModel {
  const text = options?.text ?? "Mock response";

  // Create a mock that satisfies the LanguageModelV3 interface
  const mockModel = {
    specificationVersion: "v3" as const,
    provider: "mock",
    modelId: "mock-model",
    defaultObjectGenerationMode: "json" as const,

    doGenerate: vi.fn().mockResolvedValue({
      text,
      content: [{ type: "text", text }],
      toolCalls: options?.toolCalls ?? [],
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {
          noCacheTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        outputTokenDetails: {
          reasoningTokens: 0,
        },
      },
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

    doStream: vi.fn().mockImplementation(async () => ({
      stream: createMockStream(text),
      rawCall: { rawPrompt: null, rawSettings: {} },
    })),
  };

  return mockModel as unknown as LanguageModel;
}

/**
 * Creates a mock async iterable stream for streaming tests
 */
function createMockStream(text: string) {
  const chunks = [
    {
      type: "text-delta" as const,
      id: "chunk-1",
      text,
    },
    {
      type: "finish" as const,
      finishReason: "stop" as const,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        inputTokenDetails: {
          noCacheTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        outputTokenDetails: {
          reasoningTokens: 0,
        },
      },
      providerMetadata: undefined,
    },
  ];

  // Create a proper ReadableStream that the AI SDK expects
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

/**
 * Resets all mocks between tests
 */
export function resetMocks(): void {
  vi.clearAllMocks();
}
