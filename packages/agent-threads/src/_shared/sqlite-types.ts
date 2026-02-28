/**
 * Minimal interface for a synchronous SQLite database.
 *
 * Compatible with both `bun:sqlite` and `better-sqlite3`.
 * Store implementations (event store, ledger store) accept an injected
 * database instance rather than bundling a specific SQLite driver.
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
  /** Execute raw SQL (DDL, PRAGMA, or transaction control). For parameterized DML, use {@link prepare} instead. */
  exec(sql: string): void;
  prepare(sql: string): SQLiteStatement;
}

/**
 * Minimal interface for a prepared SQLite statement.
 *
 * Row results are untyped (`Record<string, unknown>`) because this interface
 * must remain driver-agnostic. Consumers are responsible for validating
 * column names and types at their call sites.
 *
 * @category Stores
 */
export interface SQLiteStatement {
  run(...params: unknown[]): void;
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
}
