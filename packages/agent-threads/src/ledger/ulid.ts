/**
 * Self-contained ULID generator with no external dependencies.
 *
 * Produces lexicographically sortable, unique identifiers compatible
 * with the ULID specification: 10 chars timestamp + 16 chars random.
 *
 * @category Utilities
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number, len: number): string {
  let str = "";
  let remaining = now;
  for (let i = len; i > 0; i--) {
    const mod = remaining % ENCODING_LEN;
    str = ENCODING[mod]! + str;
    remaining = Math.floor(remaining / ENCODING_LEN);
  }
  return str;
}

function encodeRandom(len: number): string {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let str = "";
  for (let i = 0; i < len; i++) {
    // No modulo bias: 256 is evenly divisible by 32 (ENCODING_LEN)
    str += ENCODING[bytes[i]! % ENCODING_LEN]!;
  }
  return str;
}

/**
 * Generate a ULID string.
 *
 * @param now - Optional timestamp override (milliseconds since epoch)
 * @returns A 26-character ULID string
 *
 * @category Utilities
 */
export function ulid(now?: number): string {
  const timestamp = now ?? Date.now();
  return encodeTime(timestamp, TIME_LEN) + encodeRandom(RANDOM_LEN);
}

/**
 * An ID generator function that returns unique string identifiers.
 *
 * @category Types
 */
export type IdGenerator = () => string;

/**
 * Creates a counter-based ID generator for deterministic testing.
 *
 * @param prefix - Prefix for generated IDs
 * @returns An IdGenerator that produces sequential IDs like "msg-1", "msg-2", etc.
 *
 * @category Utilities
 */
export function createCounterIdGenerator(prefix = "id"): IdGenerator {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}
