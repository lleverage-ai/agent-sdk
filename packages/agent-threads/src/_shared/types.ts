/**
 * Minimal logger interface for routing diagnostics through the host application's
 * logging pipeline instead of writing directly to the console.
 *
 * @category Types
 */
export interface Logger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** @internal Fallback that writes to the console when no logger is injected. */
export const defaultLogger: Logger = {
  warn: (message, meta) => {
    meta !== undefined ? console.warn(message, meta) : console.warn(message);
  },
  error: (message, meta) => {
    meta !== undefined ? console.error(message, meta) : console.error(message);
  },
};
