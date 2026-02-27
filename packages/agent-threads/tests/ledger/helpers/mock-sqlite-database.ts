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
  private execCalls: string[] = [];

  /** Returns all SQL strings passed to the database exec method, for test assertions. */
  getExecHistory(): string[] {
    return [...this.execCalls];
  }

  // SQLite database exec method — runs raw SQL, not a shell command
  sqlExec(sql: string): void {
    this.execCalls.push(sql.trim());
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

          // Handle DELETE with IN subquery: WHERE col IN (SELECT col FROM table WHERE ...)
          const inSubqueryMatch = sql.match(
            /WHERE\s+(\w+)\s+IN\s*\(\s*SELECT\s+(\w+)\s+FROM\s+(\w+)\s+WHERE\s+(.+?)\s*\)/i,
          );
          if (inSubqueryMatch) {
            const filterCol = inSubqueryMatch[1]!;
            const selectCol = inSubqueryMatch[2]!;
            const subTable = db.tables.get(inSubqueryMatch[3]!);
            const subWhereClause = inSubqueryMatch[4]!;
            if (!subTable) return;

            // Parse subquery WHERE conditions
            const subConditions = [...subWhereClause.matchAll(/(\w+)\s*([>=<!=]+)\s*\?/g)];
            let subResults = [...subTable];
            let pIdx = 0;
            for (const cond of subConditions) {
              const col = cond[1]!;
              const op = cond[2]!;
              const val = params[pIdx++];
              subResults = subResults.filter((r) => {
                if (op === "=") return r[col] === val;
                if (op === ">") return (r[col] as number) > (val as number);
                if (op === ">=") return (r[col] as number) >= (val as number);
                return true;
              });
            }

            const matchingIds = new Set(subResults.map((r) => r[selectCol]));
            db.tables.set(
              tableName,
              table.filter((r) => !matchingIds.has(r[filterCol])),
            );
            return;
          }

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
        // Handle LEFT JOIN queries:
        // FROM tableName alias LEFT JOIN tableName2 alias2 ON alias2.col = alias.col
        const joinMatch = sql.match(
          /FROM\s+(\w+)\s+(\w+)\s+LEFT\s+JOIN\s+(\w+)\s+(\w+)\s+ON\s+(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/i,
        );
        if (joinMatch) {
          const leftTable = db.tables.get(joinMatch[1]!);
          const leftAlias = joinMatch[2]!;
          const rightTable = db.tables.get(joinMatch[3]!);
          const rightAlias = joinMatch[4]!;
          const onRightAlias = joinMatch[5]!;
          const onRightCol = joinMatch[6]!;
          const onLeftAlias = joinMatch[7]!;
          const onLeftCol = joinMatch[8]!;
          if (!leftTable) return [];

          // Determine which side is which
          const joinLeftCol = onLeftAlias === leftAlias ? onLeftCol : onRightCol;
          const joinRightCol = onRightAlias === rightAlias ? onRightCol : onLeftCol;

          // Build joined results
          let joined: Record<string, unknown>[] = [];
          for (const leftRow of leftTable) {
            const matching = (rightTable ?? []).filter(
              (r) => r[joinRightCol] === leftRow[joinLeftCol],
            );
            if (matching.length === 0) {
              // LEFT JOIN: produce one row with nulls for right side
              const row: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(leftRow)) {
                row[`${leftAlias}.${k}`] = v;
              }
              joined.push(row);
            } else {
              for (const rightRow of matching) {
                const row: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(leftRow)) {
                  row[`${leftAlias}.${k}`] = v;
                }
                for (const [k, v] of Object.entries(rightRow)) {
                  row[`${rightAlias}.${k}`] = v;
                }
                joined.push(row);
              }
            }
          }

          // Apply WHERE on joined results
          const whereIdx = sql.indexOf("WHERE");
          if (whereIdx >= 0) {
            const wherePart = sql.substring(whereIdx);
            const conditions = [...wherePart.matchAll(/(\w+)\.(\w+)\s*=\s*\?/g)];
            let pIdx = 0;
            for (const cond of conditions) {
              const alias = cond[1]!;
              const col = cond[2]!;
              const val = params[pIdx++];
              joined = joined.filter((r) => r[`${alias}.${col}`] === val);
            }
          }

          // Apply ORDER BY (multi-column)
          const orderMatches = [...sql.matchAll(/(\w+)\.(\w+)\s+(ASC|DESC)/gi)];
          if (orderMatches.length > 0) {
            joined.sort((a, b) => {
              for (const om of orderMatches) {
                const key = `${om[1]!}.${om[2]!}`;
                const dir = om[3]!.toUpperCase();
                const av = a[key];
                const bv = b[key];
                // Handle nulls: sort nulls last
                if (av == null && bv == null) continue;
                if (av == null) return 1;
                if (bv == null) return -1;
                const cmp =
                  typeof av === "number" && typeof bv === "number"
                    ? av - bv
                    : String(av).localeCompare(String(bv));
                if (cmp !== 0) return dir === "ASC" ? cmp : -cmp;
              }
              return 0;
            });
          }

          // Apply SELECT columns with alias resolution
          const colsMatch = sql.match(/SELECT\s+(.+?)\s+FROM/s);
          if (colsMatch) {
            const cols = colsMatch[1]!
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean);
            return joined.map((r) => {
              const row: Record<string, unknown> = {};
              for (const col of cols) {
                const asMatch = col.match(/(\w+\.\w+)\s+AS\s+(\w+)/i);
                if (asMatch) {
                  row[asMatch[2]!] = r[asMatch[1]!] ?? null;
                } else if (col.includes(".")) {
                  // "alias.col" -> output as just "col"
                  const parts = col.split(".");
                  row[parts[1]!] = r[col] ?? null;
                } else {
                  row[col] = r[col] ?? null;
                }
              }
              return row;
            });
          }

          return joined;
        }

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
