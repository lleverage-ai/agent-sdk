/**
 * JSON helpers for context log stores.
 *
 * @packageDocumentation
 */

import { ContextLogInvalidError } from "./errors.js";

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Throws a {@link ContextLogInvalidError} unless `value` survives a JSON round
 * trip unchanged: plain objects, arrays, strings, finite numbers, booleans and
 * `null`. Object properties whose value is `undefined` are allowed and dropped.
 *
 * Binary data (for example a `Uint8Array` file part), dates and URLs must be
 * encoded as strings before they are logged.
 *
 * @param value - The value to check
 * @param path - Location used in the error message
 *
 * @experimental
 * @category Context Log
 */
export function assertContextJson(value: unknown, path = "value"): void {
  const seen = new Set<object>();
  const visit = (current: unknown, at: string, inObject: boolean): void => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new ContextLogInvalidError("not_json", `${at} is not a finite number`);
      }
      return;
    }
    if (current === undefined && inObject) return;
    if (typeof current !== "object") {
      throw new ContextLogInvalidError("not_json", `${at} is not JSON-serialisable`);
    }
    if (seen.has(current)) {
      throw new ContextLogInvalidError("not_json", `${at} is circular`);
    }
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        visit(item, `${at}[${index}]`, false);
      });
    } else if (isPlainObject(current)) {
      for (const [key, item] of Object.entries(current)) visit(item, `${at}.${key}`, true);
    } else {
      throw new ContextLogInvalidError(
        "not_json",
        `${at} is not a plain JSON value (encode binary data, dates and URLs as strings)`,
      );
    }
    seen.delete(current);
  };
  visit(value, path, false);
}

/**
 * Serialises a JSON value with object keys sorted, so equal values always
 * produce equal strings. Use it for digests and request comparison, never to
 * store content (stored content keeps its own key order).
 *
 * @param value - A JSON-serialisable value
 * @returns The canonical JSON text
 *
 * @experimental
 * @category Context Log
 */
export function canonicalContextJson(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return current;
    // A null prototype keeps a "__proto__" key as an ordinary property.
    const sorted: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(current).sort()) {
      sorted[key] = (current as Record<string, unknown>)[key];
    }
    return sorted;
  });
}
