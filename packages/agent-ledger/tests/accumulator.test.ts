import * as fs from "node:fs";
import * as path from "node:path";
import type { StoredEvent, StreamEvent } from "@lleverage-ai/agent-stream";
import { describe, expect, it } from "vitest";

import { accumulateEvents, createAccumulatorProjector } from "../src/accumulator.js";
import type { CanonicalMessage, CanonicalPart } from "../src/types.js";
import { createCounterIdGenerator } from "../src/ulid.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapEvents(events: StreamEvent[]): StoredEvent<StreamEvent>[] {
  return events.map((event, i) => ({
    seq: i + 1,
    timestamp: new Date().toISOString(),
    streamId: "test-stream",
    event,
  }));
}

interface GoldenFixture {
  description: string;
  events: StreamEvent[];
  expectedMessages: Array<{ role: string; parts: CanonicalPart[] }>;
}

interface BranchedRegenFixture {
  description: string;
  run1Events: StreamEvent[];
  run2Events: StreamEvent[];
  run1ExpectedMessages: Array<{ role: string; parts: CanonicalPart[] }>;
  run2ExpectedMessages: Array<{ role: string; parts: CanonicalPart[] }>;
}

function loadGoldenFixture(name: string): GoldenFixture {
  const fixturePath = path.join(import.meta.dirname, "fixtures", "golden", `${name}.json`);
  return JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as GoldenFixture;
}

function normalizeMessages(
  messages: CanonicalMessage[],
): Array<{ role: string; parts: CanonicalPart[] }> {
  return messages.map((m) => ({
    role: m.role,
    parts: [...m.parts],
  }));
}

// ---------------------------------------------------------------------------
// Golden fixture tests
// ---------------------------------------------------------------------------

const goldenFixtures = [
  "simple-text",
  "multi-step-tool-use",
  "tool-error",
  "reasoning-with-text",
  "file-attachment",
  "multi-turn-conversation",
  "cancelled-run",
  "failed-run",
  "empty-response",
  "interleaved-reasoning-text",
  "multiple-tool-calls",
];

describe("Accumulator", () => {
  describe("golden fixtures", () => {
    for (const fixtureName of goldenFixtures) {
      it(`handles ${fixtureName}`, () => {
        const fixture = loadGoldenFixture(fixtureName);
        const storedEvents = wrapEvents(fixture.events);
        const idGen = createCounterIdGenerator("msg");
        const messages = accumulateEvents(storedEvents, idGen);
        const normalized = normalizeMessages(messages);

        expect(normalized).toEqual(fixture.expectedMessages);
      });
    }

    it("handles branched regeneration fixture with divergent runs", () => {
      const fixturePath = path.join(
        import.meta.dirname,
        "fixtures",
        "golden",
        "branched-regen.json",
      );
      const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as BranchedRegenFixture;

      const run1Messages = normalizeMessages(
        accumulateEvents(wrapEvents(fixture.run1Events), createCounterIdGenerator("msg-r1")),
      );
      expect(run1Messages).toEqual(fixture.run1ExpectedMessages);

      const run2Messages = normalizeMessages(
        accumulateEvents(wrapEvents(fixture.run2Events), createCounterIdGenerator("msg-r2")),
      );
      expect(run2Messages).toEqual(fixture.run2ExpectedMessages);
    });
  });

  describe("projector integration", () => {
    it("createAccumulatorProjector returns a usable projector", () => {
      const idGen = createCounterIdGenerator("msg");
      const projector = createAccumulatorProjector(idGen);

      const events = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        { kind: "text-delta", payload: { delta: "Hello" } },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
      ]);

      projector.apply(events);
      const state = projector.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]!.role).toBe("assistant");
    });

    it("projector tracks lastSeq and skips duplicates", () => {
      const idGen = createCounterIdGenerator("msg");
      const projector = createAccumulatorProjector(idGen);

      const events = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        { kind: "text-delta", payload: { delta: "First" } },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
      ]);

      projector.apply(events);
      projector.apply(events); // Second apply should be a no-op (dedup)

      const state = projector.getState();
      expect(state.messages).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("handles empty event list", () => {
      const messages = accumulateEvents([]);
      expect(messages).toEqual([]);
    });

    it("creates an assistant message from text-delta without step-started", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([{ kind: "text-delta", payload: { delta: "Orphan text" } }]);
      const messages = accumulateEvents(storedEvents, idGen);

      expect(messages).toHaveLength(1);
      expect(messages[0]!.role).toBe("assistant");
      expect(messages[0]!.parts).toEqual([{ type: "text", text: "Orphan text" }]);
    });

    it("ignores unknown event kinds", () => {
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        { kind: "custom-unknown-event", payload: { data: "ignored" } },
        { kind: "text-delta", payload: { delta: "Text" } },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
      ]);
      const idGen = createCounterIdGenerator("msg");
      const messages = accumulateEvents(storedEvents, idGen);
      expect(messages).toHaveLength(1);
      expect(messages[0]!.parts).toHaveLength(1);
      expect(messages[0]!.parts[0]!.type).toBe("text");
    });

    it("assigns sequential IDs with counter generator", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        { kind: "text-delta", payload: { delta: "Text" } },
        { kind: "tool-call", payload: { toolCallId: "tc-1", toolName: "test", input: {} } },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
        {
          kind: "tool-result",
          payload: { toolCallId: "tc-1", toolName: "test", output: "ok", isError: false },
        },
      ]);
      const messages = accumulateEvents(storedEvents, idGen);
      expect(messages[0]!.id).toBe("msg-1");
      expect(messages[1]!.id).toBe("msg-2");
    });

    it("sets parentMessageId linking", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        { kind: "text-delta", payload: { delta: "First" } },
        { kind: "tool-call", payload: { toolCallId: "tc-1", toolName: "test", input: {} } },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
        {
          kind: "tool-result",
          payload: { toolCallId: "tc-1", toolName: "test", output: "ok", isError: false },
        },
        { kind: "step-started", payload: { stepIndex: 1 } },
        { kind: "text-delta", payload: { delta: "Second" } },
        { kind: "step-finished", payload: { stepIndex: 1, finishReason: "stop" } },
      ]);
      const messages = accumulateEvents(storedEvents, idGen);

      expect(messages[0]!.parentMessageId).toBeNull();
      expect(messages[1]!.parentMessageId).toBe("msg-1");
      expect(messages[2]!.parentMessageId).toBe("msg-2");
    });

    it("coalesces consecutive text-deltas into single TextPart", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        { kind: "text-delta", payload: { delta: "A" } },
        { kind: "text-delta", payload: { delta: "B" } },
        { kind: "text-delta", payload: { delta: "C" } },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
      ]);
      const messages = accumulateEvents(storedEvents, idGen);
      expect(messages[0]!.parts).toHaveLength(1);
      expect(messages[0]!.parts[0]).toEqual({ type: "text", text: "ABC" });
    });

    it("includes schemaVersion in metadata", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        { kind: "text-delta", payload: { delta: "text" } },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
      ]);
      const messages = accumulateEvents(storedEvents, idGen);
      expect(messages[0]!.metadata).toHaveProperty("schemaVersion", 1);
    });
  });
});
