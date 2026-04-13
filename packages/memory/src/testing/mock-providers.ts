import type {
  GenerateOptions,
  MemoryEmbeddingProvider,
  MemoryLLMProvider,
} from "../pipeline/types.js";

export type MockLLMResponse = {
  text?: string;
  structured?: unknown;
};

/**
 * Create a mock LLM provider that returns responses from a queue.
 *
 * When the queue is exhausted, returns `{ text: "", structured: {} }`.
 */
export function createMockLLMProvider(responses?: MockLLMResponse[]): MemoryLLMProvider {
  const queue = [...(responses ?? [])];

  return {
    async generate(_prompt: string, _options?: GenerateOptions): Promise<string> {
      const next = queue.shift();
      return next?.text ?? "";
    },
    async generateStructured<T>(
      _prompt: string,
      _schema: unknown,
      _options?: GenerateOptions,
    ): Promise<T> {
      const next = queue.shift();
      return (next?.structured ?? {}) as T;
    },
  };
}

/**
 * Simple non-cryptographic hash for deterministic seeding.
 *
 * Returns a 32-bit integer from the input string.
 */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash >>> 0;
}

/**
 * Seeded PRNG (xorshift32) for deterministic embedding vectors.
 */
function seededRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

/**
 * Create a mock embedding provider that returns deterministic normalised vectors.
 *
 * Uses a seeded random based on the input text hash so the same text
 * always produces the same embedding.
 */
export function createMockEmbeddingProvider(dimensions: number = 128): MemoryEmbeddingProvider {
  return {
    dimensions,
    model: "mock-embedder",

    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((text) => {
        const seed = hashString(text);
        const rng = seededRandom(seed);

        const raw = Array.from({ length: dimensions }, () => rng() * 2 - 1);

        const magnitude = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0));
        if (magnitude === 0) {
          return raw;
        }
        return raw.map((v) => v / magnitude);
      });
    },
  };
}
