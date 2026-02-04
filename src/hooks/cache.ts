/**
 * Cache hook utilities.
 *
 * Provides cache hooks that replace the cache middleware functionality
 * using the unified hook system.
 *
 * @packageDocumentation
 */

import type {
  HookCallback,
  HookCallbackContext,
  PostGenerateInput,
  PreGenerateInput,
} from "../types.js";

/**
 * Cache entry with timestamp for TTL enforcement.
 *
 * @category Hooks
 */
export interface CacheEntry {
  /** Cached result */
  result: unknown;
  /** Timestamp when cached (milliseconds since epoch) */
  timestamp: number;
}

/**
 * Cache storage interface.
 *
 * Implement this interface to provide custom cache backends
 * (Redis, file-based, etc.).
 *
 * @category Hooks
 */
export interface CacheStore {
  /** Get a cached entry by key */
  get(key: string): Promise<CacheEntry | undefined> | CacheEntry | undefined;
  /** Store a cache entry */
  set(key: string, value: CacheEntry): Promise<void> | void;
  /** Delete a cache entry */
  delete(key: string): Promise<boolean> | boolean;
  /** Clear all cache entries */
  clear(): Promise<void> | void;
}

/**
 * Default in-memory cache store implementation with LRU eviction.
 *
 * @category Hooks
 */
export class InMemoryCacheStore implements CacheStore {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  get(key: string): CacheEntry | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: CacheEntry): void {
    // LRU eviction: remove oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  /** Get current cache size */
  get size(): number {
    return this.cache.size;
  }
}

/**
 * Options for creating cache hooks.
 *
 * @category Hooks
 */
export interface CacheHooksOptions {
  /**
   * Time-to-live in milliseconds. Cached entries older than this are ignored.
   * @defaultValue 300000 (5 minutes)
   */
  ttl?: number;

  /**
   * Maximum number of cache entries (for in-memory store).
   * @defaultValue 100
   */
  maxSize?: number;

  /**
   * Custom cache key generator.
   * @defaultValue Hashes messages, model, temperature, and maxTokens
   */
  keyGenerator?: (input: PreGenerateInput, context?: HookCallbackContext) => string;

  /**
   * Cache storage backend.
   * @defaultValue New InMemoryCacheStore
   */
  store?: CacheStore;

  /**
   * Optional predicate to determine if a request should be cached.
   * @defaultValue Always cache
   */
  shouldCache?: (input: PreGenerateInput) => boolean;
}

/**
 * Default cache key generator.
 *
 * Creates a stable key from generation options including model identifier.
 * Addresses the cache key issue mentioned in CODE_REVIEW.md.
 */
function defaultKeyGenerator(input: PreGenerateInput, context?: HookCallbackContext): string {
  const opts = input.options;
  // Extract model identifier from agent context
  // The AI SDK LanguageModel may have modelId as a property or be a string
  const model = context?.agent?.options?.model;
  let modelId = "unknown";
  if (model) {
    if (typeof model === "string") {
      modelId = model;
    } else if ("modelId" in model && typeof (model as { modelId?: string }).modelId === "string") {
      modelId = (model as { modelId: string }).modelId;
    } else if ("specificationVersion" in model) {
      // For LanguageModel objects, try to extract identifier from provider
      modelId = String(model);
    }
  }
  const keyData = {
    // Include model to differentiate between different models
    model: modelId,
    // Include session to differentiate conversations
    session: input.session_id,
    messages: opts.messages,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
  };
  return JSON.stringify(keyData);
}

/**
 * Creates cache hooks for PreGenerate and PostGenerate events.
 *
 * The PreGenerate hook checks for cached results and returns them via
 * `respondWith` to short-circuit generation. The PostGenerate hook stores
 * results in the cache.
 *
 * This replaces the cache middleware with hook-based caching that works
 * correctly with streaming (hooks fire at lifecycle boundaries).
 *
 * @param options - Configuration options
 * @returns Array of two hooks: [PreGenerate cache check, PostGenerate cache store]
 *
 * @example
 * ```typescript
 * const [cacheCheck, cacheStore] = createCacheHooks({
 *   ttl: 60000,  // 1 minute
 *   maxSize: 50,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PreGenerate: [{ hooks: [cacheCheck] }],
 *     PostGenerate: [{ hooks: [cacheStore] }],
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Custom cache key based on last message
 * const hooks = createCacheHooks({
 *   keyGenerator: (input) => {
 *     const lastMsg = input.options.messages?.[input.options.messages.length - 1];
 *     return JSON.stringify(lastMsg);
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Conditional caching (only cache when no tools)
 * const hooks = createCacheHooks({
 *   shouldCache: (input) => !input.options.tools || Object.keys(input.options.tools).length === 0,
 *   ttl: 300000,
 * });
 * ```
 *
 * @category Hooks
 */
export function createCacheHooks(options: CacheHooksOptions = {}): [HookCallback, HookCallback] {
  const {
    ttl = 300000, // 5 minutes
    maxSize = 100,
    keyGenerator = defaultKeyGenerator,
    store = new InMemoryCacheStore(maxSize),
    shouldCache = () => true,
  } = options;

  // PreGenerate: Check cache and short-circuit if hit
  const cacheCheck: HookCallback = async (input, _toolUseId, context) => {
    if (input.hook_event_name !== "PreGenerate") return {};

    const preGenInput = input as PreGenerateInput;

    // Check if this request should be cached
    if (!shouldCache(preGenInput)) {
      return {};
    }

    const key = keyGenerator(preGenInput, context);

    // Check cache
    const cached = await store.get(key);
    if (cached && Date.now() - cached.timestamp < ttl) {
      // Cache hit - return cached result via respondWith
      return {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          respondWith: cached.result,
        },
      };
    }

    // Cache miss - continue with generation
    return {};
  };

  // PostGenerate: Store result in cache
  const cacheStore: HookCallback = async (input, _toolUseId, context) => {
    if (input.hook_event_name !== "PostGenerate") return {};

    const postGenInput = input as PostGenerateInput;

    // Check if this request should be cached
    // Convert PostGenerateInput to PreGenerateInput format for key generation
    const preGenFormat: PreGenerateInput = {
      hook_event_name: "PreGenerate",
      session_id: postGenInput.session_id,
      cwd: postGenInput.cwd,
      options: postGenInput.options,
    };

    if (!shouldCache(preGenFormat)) {
      return {};
    }

    const key = keyGenerator(preGenFormat, context);

    // Store result in cache
    await store.set(key, {
      result: postGenInput.result,
      timestamp: Date.now(),
    });

    return {};
  };

  return [cacheCheck, cacheStore];
}

/**
 * Creates managed cache hooks with programmatic cache control.
 *
 * Returns hooks along with functions to clear cache, delete entries,
 * and get statistics.
 *
 * @param options - Configuration options
 * @returns Object with hooks and cache control functions
 *
 * @example
 * ```typescript
 * const { hooks, clearCache, getStats } = createManagedCacheHooks();
 *
 * const agent = createAgent({
 *   model,
 *   hooks: {
 *     PreGenerate: [{ hooks: [hooks[0]] }],
 *     PostGenerate: [{ hooks: [hooks[1]] }],
 *   },
 * });
 *
 * // Clear cache when needed
 * await clearCache();
 *
 * // Get cache statistics
 * const { size, hits, misses } = getStats();
 * console.log(`Cache hit rate: ${hits / (hits + misses)}`);
 * ```
 *
 * @category Hooks
 */
export function createManagedCacheHooks(options: CacheHooksOptions = {}): {
  hooks: [HookCallback, HookCallback];
  clearCache: () => Promise<void> | void;
  deleteEntry: (key: string) => Promise<boolean> | boolean;
  getStats: () => { size: number; hits: number; misses: number };
} {
  const {
    ttl = 300000,
    maxSize = 100,
    keyGenerator = defaultKeyGenerator,
    store = new InMemoryCacheStore(maxSize),
    shouldCache = () => true,
  } = options;

  let hits = 0;
  let misses = 0;

  // PreGenerate: Check cache with stats tracking
  const cacheCheck: HookCallback = async (input, _toolUseId, context) => {
    if (input.hook_event_name !== "PreGenerate") return {};

    const preGenInput = input as PreGenerateInput;

    if (!shouldCache(preGenInput)) {
      return {};
    }

    const key = keyGenerator(preGenInput, context);
    const cached = await store.get(key);

    if (cached && Date.now() - cached.timestamp < ttl) {
      hits++;
      return {
        hookSpecificOutput: {
          hookEventName: "PreGenerate",
          respondWith: cached.result,
        },
      };
    }

    misses++;
    return {};
  };

  // PostGenerate: Store result
  const cacheStore: HookCallback = async (input, _toolUseId, context) => {
    if (input.hook_event_name !== "PostGenerate") return {};

    const postGenInput = input as PostGenerateInput;

    // Convert PostGenerateInput to PreGenerateInput format for key generation
    const preGenFormat: PreGenerateInput = {
      hook_event_name: "PreGenerate",
      session_id: postGenInput.session_id,
      cwd: postGenInput.cwd,
      options: postGenInput.options,
    };

    if (!shouldCache(preGenFormat)) {
      return {};
    }

    const key = keyGenerator(preGenFormat, context);
    await store.set(key, {
      result: postGenInput.result,
      timestamp: Date.now(),
    });

    return {};
  };

  return {
    hooks: [cacheCheck, cacheStore],
    clearCache: () => store.clear(),
    deleteEntry: (key: string) => store.delete(key),
    getStats: () => ({
      size: store instanceof InMemoryCacheStore ? store.size : -1,
      hits,
      misses,
    }),
  };
}
