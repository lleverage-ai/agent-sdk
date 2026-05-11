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

function makeCarrier(
  id: string,
  parentMessageId: string,
  runId: string,
  order: number,
): ThreadMessageRecord {
  const message: CanonicalMessage = {
    id,
    parentMessageId,
    role: "system",
    parts: [{ type: "text", text: `carrier:${id}` }],
    createdAt: new Date(1_700_000_000_000 + order).toISOString(),
    metadata: { schemaVersion: 2, isCompactionCarrier: true },
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

  describe("compaction carrier annotations", () => {
    it("emits carrier annotations after their parent on the active path", () => {
      const records = [
        makeRecord("m1", null, "run-1", 0),
        makeRecord("m2", "m1", "run-2", 1),
        makeCarrier("s1", "m2", "run-carrier", 2),
        makeRecord("m3", "m2", "run-3", 3),
      ];
      const statuses = statusMap([
        ["run-1", "committed"],
        ["run-2", "committed"],
        ["run-carrier", "committed"],
        ["run-3", "committed"],
      ]);

      const transcript = resolveTranscript(records, statuses, "active");
      expect(transcript.map((message) => message.id)).toEqual(["m1", "m2", "s1", "m3"]);
    });

    it("does not let a carrier win active-child resolution against a real conversation child", () => {
      // Carrier committed AFTER the real next message — the bug case before the fix.
      const records = [
        makeRecord("m1", null, "run-1", 0),
        makeRecord("m2", "m1", "run-2", 1),
        makeRecord("m3", "m2", "run-3", 2),
        makeCarrier("s1", "m2", "run-carrier", 3),
      ];
      const statuses = statusMap([
        ["run-1", "committed"],
        ["run-2", "committed"],
        ["run-3", "committed"],
        ["run-carrier", "committed"],
      ]);

      const transcript = resolveTranscript(records, statuses, "active");
      expect(transcript.map((message) => message.id)).toEqual(["m1", "m2", "s1", "m3"]);
    });

    it("does not emit carriers attached to messages off the active path", () => {
      const records = [
        makeRecord("m1", null, "run-1", 0),
        makeRecord("m2-a", "m1", "run-2a", 1),
        makeCarrier("s-a", "m2-a", "run-carrier-a", 2),
        makeRecord("m2-b", "m1", "run-2b", 3),
      ];
      const statuses = statusMap([
        ["run-1", "committed"],
        ["run-2a", "committed"],
        ["run-carrier-a", "committed"],
        ["run-2b", "committed"],
      ]);

      const transcript = resolveTranscript(records, statuses, "active");
      // run-2b is more recent than run-2a, so the active branch follows m2-b;
      // s-a is a carrier on m2-a (off-path) and must not be emitted.
      expect(transcript.map((message) => message.id)).toEqual(["m1", "m2-b"]);
    });

    it("does not report a carrier-only sibling as a fork point", () => {
      const records = [
        makeRecord("m1", null, "run-1", 0),
        makeRecord("m2", "m1", "run-2", 1),
        makeCarrier("s1", "m2", "run-carrier", 2),
        makeRecord("m3", "m2", "run-3", 3),
      ];
      const statuses = statusMap([
        ["run-1", "committed"],
        ["run-2", "committed"],
        ["run-carrier", "committed"],
        ["run-3", "committed"],
      ]);

      // m2 has two children: the carrier and m3. With carriers excluded from
      // fork detection, m2 should not be reported as a fork.
      const tree = buildThreadTree(records, statuses);
      expect(tree.forkPoints).toEqual([]);
    });

    it("reports a fork point only when at least two non-carrier children exist", () => {
      const records = [
        makeRecord("m1", null, "run-1", 0),
        makeRecord("m2", "m1", "run-2", 1),
        makeCarrier("s1", "m2", "run-carrier", 2),
        makeRecord("m3-a", "m2", "run-3a", 3),
        makeRecord("m3-b", "m2", "run-3b", 4),
      ];
      const statuses = statusMap([
        ["run-1", "committed"],
        ["run-2", "committed"],
        ["run-carrier", "committed"],
        ["run-3a", "committed"],
        ["run-3b", "committed"],
      ]);

      const tree = buildThreadTree(records, statuses);
      expect(tree.forkPoints).toEqual([
        {
          forkMessageId: "m2",
          children: ["m3-a", "m3-b"],
          activeChildId: "m3-b",
        },
      ]);
    });
  });
});
