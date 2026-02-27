import type { IEventStore, ReplayOptions, StoredEvent } from "../types.js";

/**
 * Minimal interface for a synchronous SQLite database.
 *
 * Compatible with both `bun:sqlite` and `better-sqlite3`.
 * The event store accepts an injected database instance rather than
 * bundling a specific SQLite driver.
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
 * @category Stores
 */
export class SQLiteEventStore<TEvent> implements IEventStore<TEvent> {
  private db: SQLiteDatabase;

  constructor(db: SQLiteDatabase) {
    this.db = db;
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
  }

  async append(streamId: string, events: TEvent[]): Promise<StoredEvent<TEvent>[]> {
    if (events.length === 0) return [];

    this.db.exec("BEGIN");
    try {
      const headRow = this.db
        .prepare("SELECT MAX(seq) as max_seq FROM events WHERE stream_id = ?")
        .get(streamId);
      const lastSeq = headRow && typeof headRow["max_seq"] === "number" ? headRow["max_seq"] : 0;
      const timestamp = new Date().toISOString();

      const insert = this.db.prepare(
        "INSERT INTO events (stream_id, seq, timestamp, event) VALUES (?, ?, ?, ?)",
      );

      const stored: StoredEvent<TEvent>[] = [];
      for (let i = 0; i < events.length; i++) {
        const seq = lastSeq + i + 1;
        const eventJson = JSON.stringify(events[i]);
        insert.run(streamId, seq, timestamp, eventJson);
        stored.push({ seq, timestamp, streamId, event: events[i]! });
      }

      this.db.exec("COMMIT");
      return stored;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Ignore rollback failures; original append error is more actionable.
      }
      throw error;
    }
  }

  async replay(streamId: string, options?: ReplayOptions): Promise<StoredEvent<TEvent>[]> {
    const afterSeq = options?.afterSeq ?? 0;
    const limit = options?.limit;

    let sql = "SELECT seq, timestamp, event FROM events WHERE stream_id = ? AND seq > ?";
    const params: unknown[] = [streamId, afterSeq];

    sql += " ORDER BY seq ASC";

    if (limit !== undefined && limit >= 0) {
      sql += " LIMIT ?";
      params.push(limit);
    }

    const rows = this.db.prepare(sql).all(...params);
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
    const row = this.db
      .prepare("SELECT MAX(seq) as max_seq FROM events WHERE stream_id = ?")
      .get(streamId);
    return row && typeof row["max_seq"] === "number" ? row["max_seq"] : 0;
  }

  async delete(streamId: string): Promise<void> {
    this.db.prepare("DELETE FROM events WHERE stream_id = ?").run(streamId);
  }
}
