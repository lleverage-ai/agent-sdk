/**
 * Environment variable expansion utilities for MCP configuration.
 *
 * @packageDocumentation
 */

/**
 * Expands environment variables in a string using ${VAR} syntax.
 *
 * @param value - String or object containing strings to expand
 * @returns String or object with expanded values
 *
 * @example
 * ```typescript
 * // String expansion
 * expandEnvVars("Bearer ${API_TOKEN}") // "Bearer actual-value"
 *
 * // Object expansion
 * expandEnvVars({ token: "${TOKEN}" }) // { token: "actual-value" }
 * ```
 *
 * @category MCP
 */
export function expandEnvVars(value: string): string;
export function expandEnvVars(value: Record<string, string>): Record<string, string>;
export function expandEnvVars(
  value: string | Record<string, string>,
): string | Record<string, string> {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      return process.env[varName] ?? "";
    });
  }

  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = expandEnvVars(val);
  }
  return result;
}
