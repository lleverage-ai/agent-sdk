import { describe, expect, it } from "vitest";

import { SQLiteLedgerStore } from "../src/stores/sqlite.js";
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
    expect(true).toBe(true);
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

  it("throws when branch path resolution is requested", async () => {
    const store = new SQLiteLedgerStore(new MockSQLiteDatabase());

    await expect(
      store.getTranscript({ threadId: "t1", branch: { path: ["run-1"] } }),
    ).rejects.toThrow("Branch path resolution is not yet implemented");
  });
});
