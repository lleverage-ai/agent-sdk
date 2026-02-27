/**
 * Minimal interface for a synchronous SQLite database.
 *
 * Compatible with both `bun:sqlite` and `better-sqlite3`.
 * The event store accepts an injected database instance rather than
 * bundling a specific SQLite driver.
 *
 * For best performance, enable WAL mode on the database before passing
 * it to a store:
 *
 * ```ts
 * db.exec("PRAGMA journal_mode=WAL");
 * ```
 *
 * @category Stores
 */
export interface SQLiteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SQLiteStatement;
}

/**
 * Minimal interface for a prepared SQLite statement.
 *
 * @category Stores
 */
export interface SQLiteStatement {
  run(...params: unknown[]): void;
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
}
