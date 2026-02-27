import type { SQLiteDatabase, SQLiteStatement } from "../../../src/stream/stores/sqlite.js";

/**
 * In-memory SQLite mock that simulates the synchronous SQLite API
 * used by both bun:sqlite and better-sqlite3.
 *
 * NOTE: The `exec` method here is the SQLite database `exec` method (run raw SQL),
 * NOT child_process. No shell commands are involved in this mock.
 */
export class MockSQLiteDatabase implements SQLiteDatabase {
  private tables = new Map<string, Record<string, unknown>[]>();
  private autoIncrement = new Map<string, number>();
  private snapshot: Map<string, Record<string, unknown>[]> | null = null;

  // SQLite database exec method — runs raw SQL, not a shell command
  sqlExec(sql: string): void {
    const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
    if (createMatch) {
      const tableName = createMatch[1]!;
      if (!this.tables.has(tableName)) {
        this.tables.set(tableName, []);
      }
      return;
    }

    if (sql.trim() === "BEGIN") {
      this.snapshot = new Map();
      for (const [k, v] of this.tables) {
        this.snapshot.set(k, [...v.map((r) => ({ ...r }))]);
      }
      return;
    }

    if (sql.trim() === "COMMIT") {
      this.snapshot = null;
      return;
    }

    if (sql.trim() === "ROLLBACK") {
      if (this.snapshot) {
        this.tables = this.snapshot;
      }
      this.snapshot = null;
      return;
    }
  }

  // Implements the SQLiteDatabase.exec interface
  exec(sql: string): void {
    this.sqlExec(sql);
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
          // Auto-increment for INTEGER PRIMARY KEY
          if (tableName === "parts" && row["id"] === undefined) {
            const current = db.autoIncrement.get(tableName) ?? 0;
            row["id"] = current + 1;
            db.autoIncrement.set(tableName, current + 1);
          }
          table.push(row);
          return;
        }

        const updateMatch = sql.match(/UPDATE (\w+)\s+SET/);
        if (updateMatch) {
          const tableName = updateMatch[1]!;
          const table = db.tables.get(tableName);
          if (!table) return;

          // Parse SET clauses
          const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/);
          if (!setMatch) return;
          const setClauses = setMatch[1]!.split(",").map((c) => c.trim());
          const setColumns: { col: string; paramIdx: number }[] = [];
          let paramIdx = 0;
          for (const clause of setClauses) {
            const m = clause.match(/(\w+)\s*=\s*\?/);
            if (m) {
              setColumns.push({ col: m[1]!, paramIdx });
              paramIdx++;
            }
          }

          // Parse WHERE clause
          const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/);
          if (!whereMatch) return;
          const whereCol = whereMatch[1]!;
          const whereVal = params[paramIdx];

          for (const row of table) {
            if (row[whereCol] === whereVal) {
              for (const sc of setColumns) {
                row[sc.col] = params[sc.paramIdx];
              }
            }
          }
          return;
        }

        const deleteMatch = sql.match(/DELETE FROM (\w+)/);
        if (deleteMatch) {
          const tableName = deleteMatch[1]!;
          const table = db.tables.get(tableName);
          if (!table) return;

          // Parse all WHERE conditions
          const conditions = [...sql.matchAll(/(\w+)\s*([>=<!=]+)\s*\?/g)];
          const parsedConds = conditions.map((cond, i) => ({
            col: cond[1]!,
            op: cond[2]!,
            val: params[i],
          }));

          // Keep rows that do NOT match ALL conditions (AND semantics for DELETE WHERE)
          const filtered = table.filter((r) => {
            const matchesAll = parsedConds.every(({ col, op, val }) => {
              if (op === "=") return r[col] === val;
              if (op === ">") return (r[col] as number) > (val as number);
              return false;
            });
            return !matchesAll;
          });
          db.tables.set(tableName, filtered);
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

        // Handle OR in WHERE — e.g., (status = ? OR status = ?)
        const orMatch = sql.match(/\((\w+)\s*=\s*\?\s+OR\s+\1\s*=\s*\?\)/);
        if (orMatch) {
          const col = orMatch[1]!;
          // Parse conditions before the OR group
          const preOrPart = sql.substring(sql.indexOf("WHERE") + 5, sql.indexOf("(")).trim();
          const preOrConditions = [...preOrPart.matchAll(/(\w+)\s*=\s*\?/g)];
          let preIdx = 0;
          let preResults = [...table];
          for (const cond of preOrConditions) {
            const c = cond[1]!;
            if (preOrPart.includes(`${c} =`)) {
              const v = params[preIdx++];
              preResults = preResults.filter((r) => r[c] === v);
            }
          }
          const val1 = params[preIdx];
          const val2 = params[preIdx + 1];
          results = preResults.filter((r) => r[col] === val1 || r[col] === val2);
        } else {
          // Parse WHERE clauses (simple AND conditions)
          const whereIdx = sql.indexOf("WHERE");
          if (whereIdx >= 0) {
            const wherePart = sql.substring(whereIdx);
            const conditions = [...wherePart.matchAll(/(\w+)\s*([>=<!=]+)\s*\?/g)];
            let pIdx = 0;
            for (const cond of conditions) {
              const col = cond[1]!;
              const op = cond[2]!;
              const val = params[pIdx++];
              results = results.filter((r) => {
                if (op === "=" || op === "==") return r[col] === val;
                if (op === "!=") return r[col] !== val;
                if (op === ">") return (r[col] as number) > (val as number);
                if (op === ">=") return (r[col] as number) >= (val as number);
                if (op === "<") return (r[col] as number) < (val as number);
                if (op === "<=") return (r[col] as number) <= (val as number);
                return true;
              });
            }
          }
        }

        // Parse ORDER BY
        const orderMatch = sql.match(/ORDER BY (\w+)\s*(ASC|DESC)?/i);
        if (orderMatch) {
          const col = orderMatch[1]!;
          const dir = (orderMatch[2] ?? "ASC").toUpperCase();
          results.sort((a, b) => {
            const av = String(a[col] ?? "");
            const bv = String(b[col] ?? "");
            return dir === "ASC" ? av.localeCompare(bv) : bv.localeCompare(av);
          });
        }

        // Parse SELECT columns (handle aggregates and *)
        const colsMatch = sql.match(/SELECT\s+(.+?)\s+FROM/);
        if (colsMatch && colsMatch[1] !== "*") {
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

export function aggregateRow(
  cols: string[],
  rows: Record<string, unknown>[],
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const col of cols) {
    const maxMatch = col.match(/MAX\((\w+)\)\s*(?:as\s+(\w+))?/i);
    if (maxMatch) {
      const srcCol = maxMatch[1]!;
      const alias = maxMatch[2] ?? `max_${srcCol}`;
      if (rows.length === 0) {
        row[alias] = null;
      } else {
        const nums = rows.map((r) => r[srcCol] as number).filter((n) => typeof n === "number");
        row[alias] = nums.length > 0 ? Math.max(...nums) : null;
      }
    } else {
      row[col] = rows[0]?.[col];
    }
  }
  return row;
}
