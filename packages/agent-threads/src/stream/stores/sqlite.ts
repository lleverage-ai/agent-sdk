import type { IEventStore, Logger, ReplayOptions, StoredEvent } from "../types.js";
import { defaultLogger } from "../types.js";

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

/**
 * SQLite-backed event store.
 *
 * Uses a single `events` table with `(stream_id, seq)` as primary key.
 * Events are stored as JSON text. The database is accessed synchronously
 * (matching both `bun:sqlite` and `better-sqlite3` APIs) but the
 * IEventStore interface is async for compatibility.
 *
 * Prepared statements are cached for hot-path operations.
 *
 * @category Stores
 */
export class SQLiteEventStore<TEvent> implements IEventStore<TEvent> {
  private readonly db: SQLiteDatabase;
  private readonly logger: Logger;

  // Cached prepared statements
  private readonly stmtHead: SQLiteStatement;
  private readonly stmtInsert: SQLiteStatement;
  private readonly stmtReplay: SQLiteStatement;
  private readonly stmtReplayWithLimit: SQLiteStatement;
  private readonly stmtDelete: SQLiteStatement;

  constructor(db: SQLiteDatabase, options?: { logger?: Logger }) {
    this.db = db;
    this.logger = options?.logger ?? defaultLogger;
    this.db.exec(
      [
        "CREATE TABLE IF NOT EXISTS events (",
        "  stream_id TEXT NOT NULL,",
        "  seq INTEGER NOT NULL,",
        "  timestamp TEXT NOT NULL,",
        "  event TEXT NOT NULL,",
        "  PRIMARY KEY (stream_id, seq)",
        ")",
      ].join("\n"),
    );

    this.stmtHead = this.db.prepare("SELECT MAX(seq) as max_seq FROM events WHERE stream_id = ?");
    this.stmtInsert = this.db.prepare(
      "INSERT INTO events (stream_id, seq, timestamp, event) VALUES (?, ?, ?, ?)",
    );
    this.stmtReplay = this.db.prepare(
      "SELECT seq, timestamp, event FROM events WHERE stream_id = ? AND seq > ? ORDER BY seq ASC",
    );
    this.stmtReplayWithLimit = this.db.prepare(
      "SELECT seq, timestamp, event FROM events WHERE stream_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
    );
    this.stmtDelete = this.db.prepare("DELETE FROM events WHERE stream_id = ?");
  }

  async append(streamId: string, events: TEvent[]): Promise<StoredEvent<TEvent>[]> {
    if (events.length === 0) return [];

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const lastSeq = this.readHead(streamId);
      const timestamp = new Date().toISOString();

      const stored: StoredEvent<TEvent>[] = [];
      for (let i = 0; i < events.length; i++) {
        const seq = lastSeq + i + 1;
        const eventJson = JSON.stringify(events[i]);
        this.stmtInsert.run(streamId, seq, timestamp, eventJson);
        stored.push({ seq, timestamp, streamId, event: events[i]! });
      }

      this.db.exec("COMMIT");
      return stored;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        this.logger.error("[SQLiteEventStore] Rollback failed after append error", {
          rollbackError,
        });
      }
      throw error;
    }
  }

  async replay(streamId: string, options?: ReplayOptions): Promise<StoredEvent<TEvent>[]> {
    const afterSeq = options?.afterSeq ?? 0;
    const limit = options?.limit;

    const rows =
      limit !== undefined && limit >= 0
        ? this.stmtReplayWithLimit.all(streamId, afterSeq, limit)
        : this.stmtReplay.all(streamId, afterSeq);

    return rows.map((row) => {
      const raw = row["event"] as string;
      try {
        return {
          seq: row["seq"] as number,
          timestamp: row["timestamp"] as string,
          streamId,
          event: JSON.parse(raw) as TEvent,
        };
      } catch (error) {
        throw new Error(
          `Failed to parse event JSON for stream ${streamId} at seq ${String(row["seq"])}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
  }

  async head(streamId: string): Promise<number> {
    return this.readHead(streamId);
  }

  private readHead(streamId: string): number {
    const row = this.stmtHead.get(streamId);
    return row && typeof row["max_seq"] === "number" ? row["max_seq"] : 0;
  }

  async delete(streamId: string): Promise<void> {
    this.stmtDelete.run(streamId);
  }
}
