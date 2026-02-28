import type { SQLiteDatabase, SQLiteStatement } from "../../_shared/sqlite-types.js";
import type { Logger } from "../../_shared/types.js";
import { defaultLogger } from "../../_shared/types.js";

import type {
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
 * `finalizeRun()` and `deleteThread()` wrap their operations in a single
 * transaction via `db.exec("BEGIN IMMEDIATE")` / `db.exec("COMMIT")`.
 *
 * Prepared statements are cached for hot-path operations.
 *
 * @category Stores
 */
export class SQLiteLedgerStore implements ILedgerStore {
  private readonly db: SQLiteDatabase;
  private readonly logger: Logger;

  // Cached prepared statements
  private readonly stmtInsertRun: SQLiteStatement;
  private readonly stmtGetRun: SQLiteStatement;
  private readonly stmtListRuns: SQLiteStatement;
  private readonly stmtActivateRun: SQLiteStatement;
  private readonly stmtUpdateRunStatus: SQLiteStatement;
  private readonly stmtInsertMsg: SQLiteStatement;
  private readonly stmtInsertPart: SQLiteStatement;
  // Cached statements for finalizeRun transaction
  private readonly stmtFindSupersedableRuns: SQLiteStatement;
  private readonly stmtSupersedeRun: SQLiteStatement;
  private readonly stmtMaxOrdinal: SQLiteStatement;
  // Cached statements for deleteThread transaction
  private readonly stmtDeleteThreadParts: SQLiteStatement;
  private readonly stmtDeleteThreadMessages: SQLiteStatement;
  private readonly stmtDeleteThreadRuns: SQLiteStatement;
  // Cached statements for getTranscript, listStaleRuns, recoverRun
  private readonly stmtGetTranscript: SQLiteStatement;
  private readonly stmtListStaleRunsByThread: SQLiteStatement;
  private readonly stmtListStaleRunsAll: SQLiteStatement;
  private readonly stmtRecoverRun: SQLiteStatement;

  constructor(db: SQLiteDatabase, options?: { logger?: Logger }) {
    this.db = db;
    this.logger = options?.logger ?? defaultLogger;
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
        "  message_count INTEGER NOT NULL DEFAULT 0",
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

    this.db.exec("CREATE INDEX IF NOT EXISTS idx_runs_thread_id ON runs (thread_id)");
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages (thread_id, ordinal)",
    );
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages (parent_message_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_messages_run_id ON messages (run_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_parts_message_id ON parts (message_id, ordinal)");

    // Cache prepared statements for hot-path operations
    this.stmtInsertRun = this.db.prepare(
      "INSERT INTO runs (run_id, thread_id, stream_id, fork_from_message_id, status, created_at, finished_at, message_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.stmtGetRun = this.db.prepare("SELECT * FROM runs WHERE run_id = ?");
    this.stmtListRuns = this.db.prepare(
      "SELECT * FROM runs WHERE thread_id = ? ORDER BY created_at ASC",
    );
    this.stmtActivateRun = this.db.prepare("UPDATE runs SET status = ? WHERE run_id = ?");
    this.stmtUpdateRunStatus = this.db.prepare(
      "UPDATE runs SET status = ?, finished_at = ?, message_count = ? WHERE run_id = ?",
    );
    this.stmtInsertMsg = this.db.prepare(
      "INSERT INTO messages (id, run_id, thread_id, parent_message_id, role, created_at, metadata, ordinal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.stmtInsertPart = this.db.prepare(
      "INSERT INTO parts (message_id, type, data, ordinal) VALUES (?, ?, ?, ?)",
    );
    this.stmtFindSupersedableRuns = this.db.prepare(
      "SELECT run_id FROM runs WHERE thread_id = ? AND run_id != ? AND status = ? AND fork_from_message_id = ?",
    );
    this.stmtSupersedeRun = this.db.prepare(
      "UPDATE runs SET status = ?, finished_at = ? WHERE run_id = ?",
    );
    this.stmtMaxOrdinal = this.db.prepare(
      "SELECT MAX(ordinal) as max_ord FROM messages WHERE thread_id = ?",
    );
    this.stmtDeleteThreadParts = this.db.prepare(
      "DELETE FROM parts WHERE message_id IN (SELECT id FROM messages WHERE thread_id = ?)",
    );
    this.stmtDeleteThreadMessages = this.db.prepare("DELETE FROM messages WHERE thread_id = ?");
    this.stmtDeleteThreadRuns = this.db.prepare("DELETE FROM runs WHERE thread_id = ?");
    this.stmtGetTranscript = this.db.prepare(
      [
        "SELECT m.id, m.parent_message_id, m.role, m.created_at, m.metadata,",
        "       p.data AS part_data, p.ordinal AS part_ordinal",
        "FROM messages m",
        "LEFT JOIN parts p ON p.message_id = m.id",
        "WHERE m.thread_id = ?",
        "ORDER BY m.ordinal ASC, p.ordinal ASC",
      ].join("\n"),
    );
    this.stmtListStaleRunsByThread = this.db.prepare(
      "SELECT * FROM runs WHERE thread_id = ? AND (status = ? OR status = ?) ORDER BY created_at ASC",
    );
    this.stmtListStaleRunsAll = this.db.prepare(
      "SELECT * FROM runs WHERE status = ? OR status = ? ORDER BY created_at ASC",
    );
    this.stmtRecoverRun = this.db.prepare(
      "UPDATE runs SET status = ?, finished_at = ? WHERE run_id = ?",
    );
  }

  async beginRun(options: BeginRunOptions): Promise<RunRecord> {
    const runId = ulid();
    const streamId = `run:${runId}`;
    const createdAt = new Date().toISOString();

    this.stmtInsertRun.run(
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
      messageCount: 0,
    };
  }

  async activateRun(runId: string): Promise<RunRecord> {
    const run = await this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== "created") {
      throw new Error(`Cannot activate run in status "${run.status}", expected "created"`);
    }

    this.stmtActivateRun.run("streaming", runId);

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

    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (options.status === "committed") {
        // Handle fork-based supersession
        if (run.forkFromMessageId) {
          // Supersede other committed runs at same fork point
          const otherRuns = this.stmtFindSupersedableRuns.all(
            run.threadId,
            run.runId,
            "committed",
            run.forkFromMessageId,
          );
          for (const other of otherRuns) {
            const rid = other["run_id"] as string;
            this.stmtSupersedeRun.run("superseded", finishedAt, rid);
            supersededRunIds.push(rid);
          }
        }

        // Get current max ordinal for thread
        const maxRow = this.stmtMaxOrdinal.get(run.threadId);
        let nextOrdinal =
          maxRow && typeof maxRow["max_ord"] === "number" ? maxRow["max_ord"] + 1 : 0;

        // Insert messages and parts
        for (const msg of options.messages) {
          this.stmtInsertMsg.run(
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
            this.stmtInsertPart.run(msg.id, msg.parts[i]!.type, JSON.stringify(msg.parts[i]), i);
          }
        }
      }

      const messageCount =
        options.status === "committed" ? options.messages.length : run.messageCount;
      this.stmtUpdateRunStatus.run(options.status, finishedAt, messageCount, options.runId);

      this.db.exec("COMMIT");
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        this.logger.error("[SQLiteLedgerStore] Rollback failed after finalizeRun error", {
          rollbackError,
        });
      }
      throw e;
    }

    return { committed: true, supersededRunIds };
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const row = this.stmtGetRun.get(runId);
    if (!row) return null;
    return rowToRunRecord(row);
  }

  async listRuns(threadId: string): Promise<RunRecord[]> {
    const rows = this.stmtListRuns.all(threadId);
    return rows.map(rowToRunRecord);
  }

  async getTranscript(options: GetTranscriptOptions): Promise<CanonicalMessage[]> {
    const branch = options.branch ?? "active";
    if (typeof branch === "object") {
      throw new Error("Branch path resolution is not yet implemented");
    }

    const rows = this.stmtGetTranscript.all(options.threadId);

    const messages: CanonicalMessage[] = [];
    let currentMsgId: string | null = null;
    let parts: CanonicalPart[] = [];
    let currentRow: Record<string, unknown> | null = null;

    const flushMessage = () => {
      if (!currentRow || !currentMsgId) return;
      const metadata = parseCanonicalMessageMetadata(
        currentRow["metadata"] as string,
        currentMsgId,
      );
      messages.push({
        id: currentMsgId,
        parentMessageId: (currentRow["parent_message_id"] as string) ?? null,
        role: currentRow["role"] as CanonicalMessage["role"],
        parts,
        createdAt: currentRow["created_at"] as string,
        metadata,
      });
    };

    for (const row of rows) {
      const msgId = row["id"] as string;

      if (msgId !== currentMsgId) {
        flushMessage();
        currentMsgId = msgId;
        currentRow = row;
        parts = [];
      }

      // LEFT JOIN may produce null part_data for messages with no parts
      if (row["part_data"] != null) {
        const raw = row["part_data"] as string;
        try {
          parts.push(JSON.parse(raw) as CanonicalPart);
        } catch (error) {
          throw new Error(
            `Failed to parse part JSON for message ${msgId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    flushMessage();
    return messages;
  }

  async listStaleRuns(options: {
    threadId?: string;
    olderThanMs: number;
  }): Promise<StaleRunInfo[]> {
    const now = Date.now();
    let rows: Record<string, unknown>[];

    if (options.threadId) {
      rows = this.stmtListStaleRunsByThread.all(options.threadId, "created", "streaming");
    } else {
      rows = this.stmtListStaleRunsAll.all("created", "streaming");
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

    const newStatus: TerminalRunStatus = options.action === "fail" ? "failed" : "cancelled";
    const previousStatus = run.status;
    const finishedAt = new Date().toISOString();

    this.stmtRecoverRun.run(newStatus, finishedAt, options.runId);

    return { runId: options.runId, previousStatus, newStatus };
  }

  async deleteThread(threadId: string): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.stmtDeleteThreadParts.run(threadId);
      this.stmtDeleteThreadMessages.run(threadId);
      this.stmtDeleteThreadRuns.run(threadId);
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        this.logger.error("[SQLiteLedgerStore] Rollback failed after deleteThread error", {
          rollbackError,
        });
      }
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
    messageCount: row["message_count"] as number,
  };
}
