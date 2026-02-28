import { describe, expect, it } from "vitest";

import {
  buildThreadTree,
  resolveTranscript,
  type ThreadMessageRecord,
} from "../../src/ledger/branch-resolution.js";
import type { CanonicalMessage, RunStatus } from "../../src/ledger/types.js";

function makeRecord(
  id: string,
  parentMessageId: string | null,
  runId: string,
  order: number,
): ThreadMessageRecord {
  const message: CanonicalMessage = {
    id,
    parentMessageId,
    role: "assistant",
    parts: [{ type: "text", text: id }],
    createdAt: new Date(1_700_000_000_000 + order).toISOString(),
    metadata: { schemaVersion: 1 },
  };

  return { message, runId, order };
}

function statusMap(entries: Array<[string, RunStatus]>): Map<string, RunStatus> {
  return new Map(entries);
}

describe("branch-resolution", () => {
  it("throws when a message references a run without a status", () => {
    const records = [
      makeRecord("root", null, "run-root", 0),
      makeRecord("left", "root", "run-left", 1),
      makeRecord("right", "root", "run-right", 2),
    ];
    expect(() => resolveTranscript(records, new Map(), "active")).toThrow("Missing run status");
  });

  it('returns empty transcript when records are empty and branch is "all"', () => {
    expect(resolveTranscript([], new Map(), "all")).toEqual([]);
  });

  it("handles orphan parent chains when no root message exists", () => {
    const records = [
      makeRecord("orphan", "missing-parent", "run-1", 0),
      makeRecord("leaf", "orphan", "run-2", 1),
    ];
    const statuses = statusMap([
      ["run-1", "committed"],
      ["run-2", "committed"],
    ]);

    const transcript = resolveTranscript(records, statuses, "active");
    expect(transcript.map((message) => message.id)).toEqual(["orphan", "leaf"]);
  });

  it("walks multiple roots in insertion order", () => {
    const records = [
      makeRecord("root-1", null, "run-r1", 0),
      makeRecord("root-1-child", "root-1", "run-r1c", 1),
      makeRecord("root-2", null, "run-r2", 2),
      makeRecord("root-2-child", "root-2", "run-r2c", 3),
    ];
    const statuses = statusMap([
      ["run-r1", "committed"],
      ["run-r1c", "committed"],
      ["run-r2", "committed"],
      ["run-r2c", "committed"],
    ]);

    const transcript = resolveTranscript(records, statuses, "active");
    expect(transcript.map((message) => message.id)).toEqual([
      "root-1",
      "root-1-child",
      "root-2",
      "root-2-child",
    ]);
  });

  it("falls back to latest child when no fork children are committed", () => {
    const records = [
      makeRecord("root", null, "run-root", 0),
      makeRecord("fork-a", "root", "run-a", 1),
      makeRecord("fork-b", "root", "run-b", 2),
    ];
    const statuses = statusMap([
      ["run-root", "committed"],
      ["run-a", "failed"],
      ["run-b", "superseded"],
    ]);

    const transcript = resolveTranscript(records, statuses, "active");
    expect(transcript.map((message) => message.id)).toEqual(["root", "fork-b"]);
  });

  it("chooses the most recent child when all fork children are committed", () => {
    const records = [
      makeRecord("root", null, "run-root", 0),
      makeRecord("fork-a", "root", "run-a", 1),
      makeRecord("fork-b", "root", "run-b", 2),
    ];
    const statuses = statusMap([
      ["run-root", "committed"],
      ["run-a", "committed"],
      ["run-b", "committed"],
    ]);

    const transcript = resolveTranscript(records, statuses, "active");
    expect(transcript.map((message) => message.id)).toEqual(["root", "fork-b"]);
  });

  it("prevents infinite traversal when corrupted data introduces self-reference", () => {
    const records = [
      makeRecord("dup", null, "run-root", 0),
      // Corrupted duplicate id references itself as a child; visited set must stop looping.
      makeRecord("dup", "dup", "run-root", 1),
    ];
    const statuses = statusMap([["run-root", "committed"]]);

    const transcript = resolveTranscript(records, statuses, "active");
    expect(transcript.map((message) => message.id)).toEqual(["dup"]);
  });

  it("throws when branch selections contain non-string values", () => {
    const records = [makeRecord("root", null, "run-root", 0)];
    const statuses = statusMap([["run-root", "committed"]]);

    expect(() =>
      resolveTranscript(records, statuses, {
        selections: {
          root: 123 as unknown as string,
        },
      }),
    ).toThrow('selection value for "root" must be a string');
  });

  it("throws when branch selections contain array values", () => {
    const records = [makeRecord("root", null, "run-root", 0)];
    const statuses = statusMap([["run-root", "committed"]]);

    expect(() =>
      resolveTranscript(records, statuses, {
        selections: {
          root: ["fork-a"] as unknown as string,
        },
      }),
    ).toThrow('selection value for "root" must be a string');
  });

  it("buildThreadTree reports active child based on committed preference", () => {
    const records = [
      makeRecord("root", null, "run-root", 0),
      makeRecord("left", "root", "run-left", 1),
      makeRecord("right", "root", "run-right", 2),
    ];
    const statuses = statusMap([
      ["run-root", "committed"],
      ["run-left", "superseded"],
      ["run-right", "committed"],
    ]);

    const tree = buildThreadTree(records, statuses);
    expect(tree.nodes).toHaveLength(3);
    expect(tree.forkPoints).toHaveLength(1);
    expect(tree.forkPoints[0]).toEqual({
      forkMessageId: "root",
      children: ["left", "right"],
      activeChildId: "right",
    });
  });

  it("buildThreadTree throws when a node references an unknown run status", () => {
    const records = [
      makeRecord("root", null, "run-root", 0),
      makeRecord("left", "root", "run-left", 1),
      makeRecord("right", "root", "run-right", 2),
    ];

    expect(() => buildThreadTree(records, statusMap([["run-root", "committed"]]))).toThrow(
      "Missing run status",
    );
  });

  it("applies selections for orphan parent fork points", () => {
    const records = [
      makeRecord("orphan-left", "missing-parent", "run-left", 0),
      makeRecord("orphan-right", "missing-parent", "run-right", 1),
      makeRecord("orphan-left-leaf", "orphan-left", "run-left-leaf", 2),
      makeRecord("orphan-right-leaf", "orphan-right", "run-right-leaf", 3),
    ];
    const statuses = statusMap([
      ["run-left", "committed"],
      ["run-right", "committed"],
      ["run-left-leaf", "committed"],
      ["run-right-leaf", "committed"],
    ]);

    const transcript = resolveTranscript(records, statuses, {
      selections: { "missing-parent": "orphan-left" },
    });
    expect(transcript.map((message) => message.id)).toEqual(["orphan-left", "orphan-left-leaf"]);
  });

  it("does not report root siblings as a fork point", () => {
    const records = [
      makeRecord("root-1", null, "run-1", 0),
      makeRecord("root-2", null, "run-2", 1),
    ];
    const statuses = statusMap([
      ["run-1", "committed"],
      ["run-2", "committed"],
    ]);

    const tree = buildThreadTree(records, statuses);
    expect(tree.nodes).toHaveLength(2);
    expect(tree.forkPoints).toEqual([]);
  });

  it("buildThreadTree treats orphan siblings as fork points", () => {
    const records = [
      makeRecord("orphan-left", "missing-parent", "run-left", 0),
      makeRecord("orphan-right", "missing-parent", "run-right", 1),
    ];
    const statuses = statusMap([
      ["run-left", "committed"],
      ["run-right", "committed"],
    ]);

    const tree = buildThreadTree(records, statuses);
    expect(tree.nodes).toHaveLength(2);
    expect(tree.forkPoints).toEqual([
      {
        forkMessageId: "missing-parent",
        children: ["orphan-left", "orphan-right"],
        activeChildId: "orphan-right",
      },
    ]);
  });
});
