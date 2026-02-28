import { describe, expect, it } from "vitest";

import { SQLiteLedgerStore } from "../../src/ledger/stores/sqlite.js";
import { ledgerStoreConformanceTests } from "./conformance/ledger-store.conformance.js";
import { MockSQLiteDatabase } from "./helpers/mock-sqlite-database.js";

ledgerStoreConformanceTests(
  "SQLiteLedgerStore",
  () => new SQLiteLedgerStore(new MockSQLiteDatabase()),
);

describe("SQLiteLedgerStore", () => {
  it("creates tables on construction", () => {
    const db = new MockSQLiteDatabase();
    new SQLiteLedgerStore(db);
    const execCalls = db.getExecHistory();
    expect(execCalls.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS runs"))).toBe(true);
    expect(execCalls.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS messages"))).toBe(true);
    expect(execCalls.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS parts"))).toBe(true);
    expect(execCalls.some((sql) => sql.includes("idx_messages_parent"))).toBe(true);
    expect(execCalls.some((sql) => sql.includes("idx_messages_run_id"))).toBe(true);
  });

  it("persists message parts as JSON and round-trips correctly", async () => {
    const store = new SQLiteLedgerStore(new MockSQLiteDatabase());
    const run = await store.beginRun({ threadId: "t1" });
    await store.activateRun(run.runId);
    await store.finalizeRun({
      runId: run.runId,
      status: "committed",
      messages: [
        {
          id: "m1",
          parentMessageId: null,
          role: "assistant",
          parts: [
            { type: "text", text: "Hello" },
            { type: "tool-call", toolCallId: "tc-1", toolName: "test", input: { nested: true } },
          ],
          createdAt: new Date().toISOString(),
          metadata: { schemaVersion: 1 },
        },
      ],
    });

    const transcript = await store.getTranscript({ threadId: "t1" });
    expect(transcript).toHaveLength(1);
    expect(transcript[0]!.parts).toHaveLength(2);
    expect(transcript[0]!.parts[0]).toEqual({ type: "text", text: "Hello" });
    expect(transcript[0]!.parts[1]).toEqual({
      type: "tool-call",
      toolCallId: "tc-1",
      toolName: "test",
      input: { nested: true },
    });
  });

  it("rejects transcript rows with metadata missing schemaVersion", async () => {
    const db = new MockSQLiteDatabase();
    const store = new SQLiteLedgerStore(db);

    db.prepare(
      "INSERT INTO messages (id, run_id, thread_id, parent_message_id, role, created_at, metadata, ordinal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("m1", "r1", "t1", null, "assistant", new Date().toISOString(), JSON.stringify({}), 0);

    await expect(store.getTranscript({ threadId: "t1" })).rejects.toThrow(
      "schemaVersion must be a number",
    );
  });

  it("throws when branch selector shape is invalid", async () => {
    const store = new SQLiteLedgerStore(new MockSQLiteDatabase());

    await expect(
      store.getTranscript({
        threadId: "t1",
        branch: { selections: "invalid" } as unknown as { selections: Record<string, string> },
      }),
    ).rejects.toThrow("Invalid branch selector");
  });
});
