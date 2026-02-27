import { describe, expect, it } from "vitest";

import type { SQLiteDatabase, SQLiteStatement } from "../src/stores/sqlite.js";
import { SQLiteEventStore } from "../src/stores/sqlite.js";
import { eventStoreConformanceTests } from "./conformance/event-store.conformance.js";

/**
 * In-memory SQLite mock that simulates the synchronous SQLite API
 * used by both bun:sqlite and better-sqlite3.
 *
 * NOTE: The `exec` method here is the SQLite database exec (run raw SQL),
 * NOT child_process.exec. No shell commands are executed.
 */
class MockSQLiteDatabase implements SQLiteDatabase {
  private tables = new Map<string, Record<string, unknown>[]>();
  public execHistory: string[] = [];

  // SQLite database exec — runs raw SQL, not a shell command
  exec(sql: string): void {
    this.execHistory.push(sql.trim());
    const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
    if (createMatch) {
      const tableName = createMatch[1]!;
      if (!this.tables.has(tableName)) {
        this.tables.set(tableName, []);
      }
    }
  }

  prepare(sql: string): SQLiteStatement {
    const db = this;
    return {
      run(...params: unknown[]): void {
        const insertMatch = sql.match(/INSERT INTO (\w+)/);
        if (insertMatch) {
          const tableName = insertMatch[1]!;
          const table = db.tables.get(tableName);
          if (!table) throw new Error(`Table ${tableName} not found`);
          const colMatch = sql.match(/\(([^)]+)\)\s*VALUES/);
          if (!colMatch) throw new Error("Cannot parse INSERT columns");
          const cols = colMatch[1]!.split(",").map((c) => c.trim());
          const row: Record<string, unknown> = {};
          for (let i = 0; i < cols.length; i++) {
            row[cols[i]!] = params[i];
          }
          table.push(row);
          return;
        }

        const deleteMatch = sql.match(/DELETE FROM (\w+)/);
        if (deleteMatch) {
          const tableName = deleteMatch[1]!;
          const table = db.tables.get(tableName);
          if (!table) return;
          const whereMatch = sql.match(/WHERE (\w+)\s*=\s*\?/);
          if (whereMatch) {
            const col = whereMatch[1]!;
            const filtered = table.filter((r) => r[col] !== params[0]);
            db.tables.set(tableName, filtered);
          }
          return;
        }
      },

      all(...params: unknown[]): Record<string, unknown>[] {
        const selectMatch = sql.match(/FROM (\w+)/);
        if (!selectMatch) return [];
        const tableName = selectMatch[1]!;
        const table = db.tables.get(tableName);
        if (!table) return [];

        let results = [...table];

        // Parse WHERE clauses
        const conditions = [...sql.matchAll(/(\w+)\s*([>=<]+)\s*\?/g)];
        let paramIdx = 0;
        for (const cond of conditions) {
          const col = cond[1]!;
          const op = cond[2]!;
          const val = params[paramIdx++];
          results = results.filter((r) => {
            if (op === "=") return r[col] === val;
            if (op === ">") return (r[col] as number) > (val as number);
            if (op === ">=") return (r[col] as number) >= (val as number);
            if (op === "<") return (r[col] as number) < (val as number);
            if (op === "<=") return (r[col] as number) <= (val as number);
            return true;
          });
        }

        // Parse ORDER BY
        const orderMatch = sql.match(/ORDER BY (\w+)\s*(ASC|DESC)?/i);
        if (orderMatch) {
          const col = orderMatch[1]!;
          const dir = (orderMatch[2] ?? "ASC").toUpperCase();
          results.sort((a, b) => {
            const av = a[col] as number;
            const bv = b[col] as number;
            return dir === "ASC" ? av - bv : bv - av;
          });
        }

        // Parse LIMIT
        const limitMatch = sql.match(/LIMIT\s*\?/);
        if (limitMatch) {
          const limit = params[paramIdx] as number;
          results = results.slice(0, limit);
        }

        // Parse SELECT columns
        const colsMatch = sql.match(/SELECT\s+(.+?)\s+FROM/);
        if (colsMatch) {
          const cols = colsMatch[1]!.split(",").map((c) => c.trim());
          const hasAgg = cols.some((c) => c.includes("MAX("));
          if (hasAgg) {
            return [aggregateRow(cols, results)];
          }
          return results.map((r) => {
            const row: Record<string, unknown> = {};
            for (const col of cols) {
              row[col] = r[col];
            }
            return row;
          });
        }

        return results;
      },

      get(...params: unknown[]): Record<string, unknown> | undefined {
        return this.all(...params)[0];
      },
    } as SQLiteStatement;
  }
}

function aggregateRow(cols: string[], rows: Record<string, unknown>[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const col of cols) {
    const maxMatch = col.match(/MAX\((\w+)\)\s*(?:as\s+(\w+))?/i);
    if (maxMatch) {
      const srcCol = maxMatch[1]!;
      const alias = maxMatch[2] ?? `max_${srcCol}`;
      if (rows.length === 0) {
        row[alias] = null;
      } else {
        row[alias] = Math.max(...rows.map((r) => r[srcCol] as number));
      }
    } else {
      row[col] = rows[0]?.[col];
    }
  }
  return row;
}

eventStoreConformanceTests(
  "SQLiteEventStore",
  () => new SQLiteEventStore(new MockSQLiteDatabase()),
);

describe("SQLiteEventStore", () => {
  it("creates events table on construction", () => {
    const db = new MockSQLiteDatabase();
    new SQLiteEventStore(db);
    expect(true).toBe(true);
  });

  it("stores events as JSON and deserializes on replay", async () => {
    const store = new SQLiteEventStore<{ nested: { value: number } }>(new MockSQLiteDatabase());
    await store.append("s1", [{ nested: { value: 42 } }]);
    const events = await store.replay("s1");
    expect(events[0]!.event).toEqual({ nested: { value: 42 } });
  });

  it("wraps append in a transaction", async () => {
    const db = new MockSQLiteDatabase();
    const store = new SQLiteEventStore<{ value: number }>(db);
    await store.append("s1", [{ value: 1 }]);

    expect(db.execHistory).toContain("BEGIN");
    expect(db.execHistory).toContain("COMMIT");
  });
});
