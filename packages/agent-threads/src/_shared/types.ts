/**
 * Minimal logger interface for routing diagnostics through the host application's
 * logging pipeline instead of writing directly to the console.
 *
 * @category Types
 */
export interface Logger {
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/** @internal */
export const defaultLogger: Logger = {
  warn: (message, meta) => console.warn(message, meta),
  error: (message, meta) => console.error(message, meta),
};
