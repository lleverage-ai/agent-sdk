import type { SQLiteDatabase } from "@lleverage-ai/agent-stream";

import type {
  ActiveRunStatus,
  BeginRunOptions,
  CanonicalMessage,
  CanonicalMessageMetadata,
  CanonicalPart,
  FinalizeResult,
  FinalizeRunOptions,
  GetTranscriptOptions,
  RecoverResult,
  RecoverRunOptions,
  RunRecord,
  StaleRunInfo,
  TerminalRunStatus,
} from "../types.js";
import { isActiveRunStatus, isTerminalRunStatus } from "../types.js";
import { ulid } from "../ulid.js";
import type { ILedgerStore } from "./ledger-store.js";

/**
 * SQLite-backed ledger store.
 *
 * Uses three tables: `runs`, `messages`, and `parts`. The database is
 * accessed synchronously (matching both `bun:sqlite` and `better-sqlite3`
 * APIs) but the ILedgerStore interface is async for compatibility.
 *
 * `finalizeRun()` wraps supersession + commit in a single "transaction"
 * via `db.exec("BEGIN")` / `db.exec("COMMIT")`.
 *
 * NOTE: The `exec` method used here is the SQLite database exec (run raw SQL),
 * NOT child_process.exec. No shell commands are involved.
 *
 * @category Stores
 */
export class SQLiteLedgerStore implements ILedgerStore {
  private db: SQLiteDatabase;

  constructor(db: SQLiteDatabase) {
    this.db = db;
    this.db.exec(
      [
        "CREATE TABLE IF NOT EXISTS runs (",
        "  run_id TEXT PRIMARY KEY,",
        "  thread_id TEXT NOT NULL,",
        "  stream_id TEXT NOT NULL,",
        "  fork_from_message_id TEXT,",
        "  status TEXT NOT NULL,",
        "  created_at TEXT NOT NULL,",
        "  finished_at TEXT,",
        "  event_count INTEGER NOT NULL DEFAULT 0",
        ")",
      ].join("\n"),
    );

    this.db.exec(
      [
        "CREATE TABLE IF NOT EXISTS messages (",
        "  id TEXT PRIMARY KEY,",
        "  run_id TEXT NOT NULL,",
        "  thread_id TEXT NOT NULL,",
        "  parent_message_id TEXT,",
        "  role TEXT NOT NULL,",
        "  created_at TEXT NOT NULL,",
        "  metadata TEXT NOT NULL,",
        "  ordinal INTEGER NOT NULL",
        ")",
      ].join("\n"),
    );

    this.db.exec(
      [
        "CREATE TABLE IF NOT EXISTS parts (",
        "  id INTEGER PRIMARY KEY,",
        "  message_id TEXT NOT NULL,",
        "  type TEXT NOT NULL,",
        "  data TEXT NOT NULL,",
        "  ordinal INTEGER NOT NULL",
        ")",
      ].join("\n"),
    );
  }

  async beginRun(options: BeginRunOptions): Promise<RunRecord> {
    const runId = ulid();
    const streamId = `run:${runId}`;
    const createdAt = new Date().toISOString();

    this.db
      .prepare(
        "INSERT INTO runs (run_id, thread_id, stream_id, fork_from_message_id, status, created_at, finished_at, event_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        runId,
        options.threadId,
        streamId,
        options.forkFromMessageId ?? null,
        "created",
        createdAt,
        null,
        0,
      );

    return {
      runId,
      threadId: options.threadId,
      streamId,
      forkFromMessageId: options.forkFromMessageId ?? null,
      status: "created",
      createdAt,
      finishedAt: null,
      eventCount: 0,
    };
  }

  async activateRun(runId: string): Promise<RunRecord> {
    const run = await this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== "created") {
      throw new Error(`Cannot activate run in status "${run.status}", expected "created"`);
    }

    this.db.prepare("UPDATE runs SET status = ? WHERE run_id = ?").run("streaming", runId);

    return { ...run, status: "streaming" };
  }

  async finalizeRun(options: FinalizeRunOptions): Promise<FinalizeResult> {
    const run = await this.getRun(options.runId);
    if (!run) throw new Error(`Run not found: ${options.runId}`);

    // Idempotency
    if (run.status === options.status) {
      return { committed: true, supersededRunIds: [] };
    }

    if (isTerminalRunStatus(run.status)) {
      return { committed: false, supersededRunIds: [] };
    }

    const finishedAt = new Date().toISOString();
    const supersededRunIds: string[] = [];

    this.db.exec("BEGIN");
    try {
      if (options.status === "committed") {
        // Handle fork-based supersession
        if (run.forkFromMessageId) {
          // Remove messages after fork point
          const forkedMessages = this.db
            .prepare("SELECT ordinal FROM messages WHERE thread_id = ? AND id = ?")
            .get(run.threadId, run.forkFromMessageId);

          if (forkedMessages) {
            const forkOrdinal = forkedMessages["ordinal"] as number;
            // Delete parts of messages after fork point
            const afterForkMessages = this.db
              .prepare("SELECT id FROM messages WHERE thread_id = ? AND ordinal > ?")
              .all(run.threadId, forkOrdinal);
            for (const msg of afterForkMessages) {
              this.db.prepare("DELETE FROM parts WHERE message_id = ?").run(msg["id"]);
            }
            this.db
              .prepare("DELETE FROM messages WHERE thread_id = ? AND ordinal > ?")
              .run(run.threadId, forkOrdinal);
          }

          // Supersede other committed runs at same fork point
          const otherRuns = this.db
            .prepare(
              "SELECT run_id FROM runs WHERE thread_id = ? AND run_id != ? AND status = ? AND fork_from_message_id = ?",
            )
            .all(run.threadId, run.runId, "committed", run.forkFromMessageId);
          for (const other of otherRuns) {
            const rid = other["run_id"] as string;
            this.db
              .prepare("UPDATE runs SET status = ?, finished_at = ? WHERE run_id = ?")
              .run("superseded", finishedAt, rid);
            supersededRunIds.push(rid);
          }
        }

        // Get current max ordinal for thread
        const maxRow = this.db
          .prepare("SELECT MAX(ordinal) as max_ord FROM messages WHERE thread_id = ?")
          .get(run.threadId);
        let nextOrdinal =
          maxRow && typeof maxRow["max_ord"] === "number" ? maxRow["max_ord"] + 1 : 0;

        // Insert messages and parts
        const insertMsg = this.db.prepare(
          "INSERT INTO messages (id, run_id, thread_id, parent_message_id, role, created_at, metadata, ordinal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        );
        const insertPart = this.db.prepare(
          "INSERT INTO parts (message_id, type, data, ordinal) VALUES (?, ?, ?, ?)",
        );

        for (const msg of options.messages) {
          insertMsg.run(
            msg.id,
            run.runId,
            run.threadId,
            msg.parentMessageId,
            msg.role,
            msg.createdAt,
            JSON.stringify(msg.metadata),
            nextOrdinal++,
          );
          for (let i = 0; i < msg.parts.length; i++) {
            insertPart.run(msg.id, msg.parts[i]!.type, JSON.stringify(msg.parts[i]), i);
          }
        }
      }

      const eventCount = options.status === "committed" ? options.messages.length : run.eventCount;
      this.db
        .prepare("UPDATE runs SET status = ?, finished_at = ?, event_count = ? WHERE run_id = ?")
        .run(options.status, finishedAt, eventCount, options.runId);

      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }

    return { committed: true, supersededRunIds };
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const row = this.db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId);
    if (!row) return null;
    return rowToRunRecord(row);
  }

  async listRuns(threadId: string): Promise<RunRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM runs WHERE thread_id = ? ORDER BY created_at ASC")
      .all(threadId);
    return rows.map(rowToRunRecord);
  }

  async getTranscript(options: GetTranscriptOptions): Promise<CanonicalMessage[]> {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY ordinal ASC")
      .all(options.threadId);

    const messages: CanonicalMessage[] = [];
    for (const row of rows) {
      const msgId = row["id"] as string;
      const partRows = this.db
        .prepare("SELECT * FROM parts WHERE message_id = ? ORDER BY ordinal ASC")
        .all(msgId);

      const parts: CanonicalPart[] = partRows.map((p: Record<string, unknown>) => {
        const raw = p["data"] as string;
        try {
          return JSON.parse(raw) as CanonicalPart;
        } catch (error) {
          throw new Error(
            `Failed to parse part JSON for message ${msgId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      });

      const metadata = parseCanonicalMessageMetadata(row["metadata"] as string, msgId);

      messages.push({
        id: msgId,
        parentMessageId: (row["parent_message_id"] as string) ?? null,
        role: row["role"] as CanonicalMessage["role"],
        parts,
        createdAt: row["created_at"] as string,
        metadata,
      });
    }

    return messages;
  }

  async listStaleRuns(options: {
    threadId?: string;
    olderThanMs: number;
  }): Promise<StaleRunInfo[]> {
    const now = Date.now();
    let rows: Record<string, unknown>[];

    if (options.threadId) {
      rows = this.db
        .prepare(
          "SELECT * FROM runs WHERE thread_id = ? AND (status = ? OR status = ?) ORDER BY created_at ASC",
        )
        .all(options.threadId, "created", "streaming");
    } else {
      rows = this.db
        .prepare("SELECT * FROM runs WHERE status = ? OR status = ? ORDER BY created_at ASC")
        .all("created", "streaming");
    }

    const results: StaleRunInfo[] = [];
    for (const row of rows) {
      const run = rowToRunRecord(row);
      const createdAt = new Date(run.createdAt).getTime();
      const staleDurationMs = now - createdAt;
      if (staleDurationMs >= options.olderThanMs) {
        results.push({ run, staleDurationMs });
      }
    }

    return results;
  }

  async recoverRun(options: RecoverRunOptions): Promise<RecoverResult> {
    const run = await this.getRun(options.runId);
    if (!run) throw new Error(`Run not found: ${options.runId}`);

    if (!isActiveRunStatus(run.status)) {
      throw new Error(`Cannot recover run in status "${run.status}"`);
    }

    const newStatus: Extract<TerminalRunStatus, "failed" | "cancelled"> =
      options.action === "fail" ? "failed" : "cancelled";
    const previousStatus: ActiveRunStatus = run.status;
    const finishedAt = new Date().toISOString();

    this.db
      .prepare("UPDATE runs SET status = ?, finished_at = ? WHERE run_id = ?")
      .run(newStatus, finishedAt, options.runId);

    return { runId: options.runId, previousStatus, newStatus };
  }

  async deleteThread(threadId: string): Promise<void> {
    this.db.exec("BEGIN");
    try {
      // Delete parts for all messages in thread
      const msgRows = this.db.prepare("SELECT id FROM messages WHERE thread_id = ?").all(threadId);
      for (const row of msgRows) {
        this.db.prepare("DELETE FROM parts WHERE message_id = ?").run(row["id"]);
      }

      this.db.prepare("DELETE FROM messages WHERE thread_id = ?").run(threadId);
      this.db.prepare("DELETE FROM runs WHERE thread_id = ?").run(threadId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function parseCanonicalMessageMetadata(raw: string, msgId: string): CanonicalMessageMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse metadata JSON for message ${msgId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Invalid metadata for message ${msgId}: expected object`);
  }

  const schemaVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (typeof schemaVersion !== "number" || Number.isNaN(schemaVersion)) {
    throw new Error(`Invalid metadata for message ${msgId}: schemaVersion must be a number`);
  }

  return parsed as CanonicalMessageMetadata;
}

function rowToRunRecord(row: Record<string, unknown>): RunRecord {
  return {
    runId: row["run_id"] as string,
    threadId: row["thread_id"] as string,
    streamId: row["stream_id"] as string,
    forkFromMessageId: (row["fork_from_message_id"] as string) ?? null,
    status: row["status"] as RunRecord["status"],
    createdAt: row["created_at"] as string,
    finishedAt: (row["finished_at"] as string) ?? null,
    eventCount: row["event_count"] as number,
  };
}
