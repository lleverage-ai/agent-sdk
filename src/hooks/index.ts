/**
 * Hook utility factories.
 *
 * This module provides convenience factories that create hooks for common
 * use cases like caching, retries, rate limiting, and content filtering.
 *
 * @packageDocumentation
 * @category Hooks
 */

// Audit hooks
export {
  type AuditEvent,
  type AuditEventCategory,
  type AuditEventHandler,
  type AuditHooksOptions,
  createAuditHooks,
  createInMemoryAuditStore,
  exportAuditEventsJSONLines,
} from "./audit.js";
// Cache hooks
export {
  type CacheEntry,
  type CacheHooksOptions,
  type CacheStore,
  createCacheHooks,
  createManagedCacheHooks,
  InMemoryCacheStore,
} from "./cache.js";
// Guardrails hooks
export {
  createGuardrailsHooks,
  createManagedGuardrailsHooks,
  type GuardrailsHooksOptions,
} from "./guardrails.js";

// Logging hooks
export {
  createCompactionLoggingHooks,
  createComprehensiveLoggingHooks,
  createLoggingHooks,
  createToolLoggingHooks,
  type LoggingHooksOptions,
} from "./logging.js";
// Guardrails (composable content moderation)
export {
  type BufferedGuardrailState,
  BufferedOutputGuardrail,
  // Buffered output guardrails
  createBufferedOutputGuardrail,
  // Helpers
  createRegexGuardrail,
  extractTextFromMessages,
  findLastUserMessageId,
  type Guardrail,
  type GuardrailCheckResult,
  type OutputGuardrailConfig,
  type RaceGuardrailsOptions,
  // Core
  raceGuardrails,
  runWithGuardrails,
  withTimeout,
  wrapStreamWithOutputGuardrail,
} from "./parallel-guardrails.js";
// Rate limit hooks
export {
  createManagedRateLimitHooks,
  createRateLimitHooks,
  extractStandardRateLimitHeaders,
  type RateLimitHooksOptions,
  type ServerRateLimitInfo,
  TokenBucketRateLimiter,
} from "./rate-limit.js";
// Retry hooks
export {
  createManagedRetryHooks,
  createRetryHooks,
  type RetryHooksOptions,
} from "./retry.js";
// Secrets filter hooks
export {
  COMMON_SECRET_PATTERNS,
  createManagedSecretsFilterHooks,
  createSecretsFilterHooks,
  type SecretsFilterHooksOptions,
} from "./secrets.js";
