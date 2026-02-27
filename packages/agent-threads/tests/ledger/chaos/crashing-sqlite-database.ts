import type { SQLiteDatabase, SQLiteStatement } from "../../../src/stream/stores/sqlite.js";

import { CrashSimulationError } from "./crashing-ledger-store.js";

export type SQLCrashPoint =
  | "after-begin"
  | "after-delete-messages"
  | "after-supersede"
  | "after-insert-messages"
  | "after-update-run"
  | "after-commit";

/**
 * Wraps a MockSQLiteDatabase to intercept SQL operations and simulate
 * crashes at specific points during the finalizeRun transaction.
 *
 * NOTE: The `exec` method here wraps the SQLite database `exec` method
 * (run raw SQL), NOT child_process. No shell commands are involved.
 */
export class CrashingSQLiteDatabase implements SQLiteDatabase {
  private armedPoint: SQLCrashPoint | null = null;
  private inTransaction = false;

  constructor(private inner: SQLiteDatabase & { sqlExec(sql: string): void }) {}

  arm(point: SQLCrashPoint): void {
    this.armedPoint = point;
  }

  disarm(): void {
    this.armedPoint = null;
  }

  private maybeCrash(point: SQLCrashPoint): void {
    if (this.armedPoint === point) {
      throw new CrashSimulationError(point);
    }
  }

  // Wraps the SQLite database exec — no shell commands
  exec(sql: string): void {
    const trimmed = sql.trim();

    if (trimmed.startsWith("BEGIN")) {
      this.inner.sqlExec(sql);
      this.inTransaction = true;
      this.maybeCrash("after-begin");
      return;
    }

    if (trimmed === "COMMIT") {
      this.inner.sqlExec(sql);
      this.inTransaction = false;
      this.maybeCrash("after-commit");
      return;
    }

    if (trimmed === "ROLLBACK") {
      this.inner.sqlExec(sql);
      this.inTransaction = false;
      return;
    }

    this.inner.sqlExec(sql);
  }

  prepare(sql: string): SQLiteStatement {
    const innerStmt = this.inner.prepare(sql);
    const wrapper = this;

    return {
      run(...params: unknown[]): void {
        innerStmt.run(...params);

        if (!wrapper.inTransaction) return;

        // Track DML operations for crash point detection
        if (/DELETE FROM/i.test(sql)) {
          if (/DELETE FROM messages/i.test(sql)) {
            wrapper.maybeCrash("after-delete-messages");
          }
        } else if (/UPDATE/i.test(sql)) {
          if (/UPDATE runs/i.test(sql) && String(params[0]) === "superseded") {
            wrapper.maybeCrash("after-supersede");
          }
          if (/UPDATE runs SET status/i.test(sql) && String(params[0]) !== "superseded") {
            wrapper.maybeCrash("after-update-run");
          }
        } else if (/INSERT INTO/i.test(sql)) {
          if (/INSERT INTO messages/i.test(sql)) {
            wrapper.maybeCrash("after-insert-messages");
          }
        }
      },

      all(...params: unknown[]): Record<string, unknown>[] {
        return innerStmt.all(...params);
      },

      get(...params: unknown[]): Record<string, unknown> | undefined {
        return innerStmt.get(...params);
      },
    };
  }
}
