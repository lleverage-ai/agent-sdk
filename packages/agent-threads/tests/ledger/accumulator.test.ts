import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { accumulateEvents, createAccumulatorProjector } from "../../src/ledger/accumulator.js";
import type { CanonicalMessage, CanonicalPart } from "../../src/ledger/types.js";
import { createCounterIdGenerator } from "../../src/ledger/ulid.js";
import type { StreamEvent } from "../../src/stream/stream-event.js";
import type { StoredEvent } from "../../src/stream/types.js";

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
  "tool-metadata-fallback",
  "reasoning-with-text",
  "file-attachment",
  "multi-turn-conversation",
  "cancelled-run",
  "failed-run",
  "empty-response",
  "interleaved-reasoning-text",
  "multiple-tool-calls",
  "tool-metadata",
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

    it("links first message to forkFromMessageId when provided", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        { kind: "text-delta", payload: { delta: "Forked reply" } },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen, { forkFromMessageId: "msg-root" });
      expect(messages).toHaveLength(1);
      expect(messages[0]!.parentMessageId).toBe("msg-root");
    });

    it("treats empty forkFromMessageId as unset", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        { kind: "text-delta", payload: { delta: "Root reply" } },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen, { forkFromMessageId: "" });
      expect(messages).toHaveLength(1);
      expect(messages[0]!.parentMessageId).toBeNull();
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

    it("handles user-message events as canonical user messages", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        { kind: "text-delta", payload: { delta: "Assistant draft" } },
        { kind: "user-message", payload: { content: "User follow-up" } },
        { kind: "step-started", payload: { stepIndex: 1 } },
        { kind: "text-delta", payload: { delta: "Assistant reply" } },
        { kind: "step-finished", payload: { stepIndex: 1, finishReason: "stop" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      expect(messages).toHaveLength(3);

      expect(messages[0]!.role).toBe("assistant");
      expect(messages[0]!.parentMessageId).toBeNull();
      expect(messages[0]!.parts).toEqual([{ type: "text", text: "Assistant draft" }]);

      expect(messages[1]!.role).toBe("user");
      expect(messages[1]!.parentMessageId).toBe("msg-1");
      expect(messages[1]!.parts).toEqual([{ type: "text", text: "User follow-up" }]);

      expect(messages[2]!.role).toBe("assistant");
      expect(messages[2]!.parentMessageId).toBe("msg-2");
      expect(messages[2]!.parts).toEqual([{ type: "text", text: "Assistant reply" }]);
    });
  });

  describe("tool metadata", () => {
    it("preserves toolLabel on tool-call parts", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "read_file",
            input: { path: "utils.ts" },
            toolLabel: "Read file: utils.ts",
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
        {
          kind: "tool-result",
          payload: {
            toolCallId: "tc-1",
            toolName: "read_file",
            output: "file contents",
            isError: false,
            toolLabel: "Read file: utils.ts",
          },
        },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      const callPart = messages[0]!.parts[0]!;
      expect(callPart).toMatchObject({
        type: "tool-call",
        toolCallId: "tc-1",
        toolLabel: "Read file: utils.ts",
      });

      const resultPart = messages[1]!.parts[0]!;
      expect(resultPart).toMatchObject({
        type: "tool-result",
        toolCallId: "tc-1",
        toolLabel: "Read file: utils.ts",
      });
    });

    it("preserves skillName and skillIcon on tool parts", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "send_email",
            input: { to: "user@example.com" },
            skillName: "Email",
            skillIcon: "mail",
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
        {
          kind: "tool-result",
          payload: {
            toolCallId: "tc-1",
            toolName: "send_email",
            output: "sent",
            isError: false,
            skillName: "Email",
            skillIcon: "mail",
          },
        },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      const callPart = messages[0]!.parts[0]!;
      expect(callPart).toMatchObject({
        type: "tool-call",
        skillName: "Email",
        skillIcon: "mail",
      });

      const resultPart = messages[1]!.parts[0]!;
      expect(resultPart).toMatchObject({
        type: "tool-result",
        skillName: "Email",
        skillIcon: "mail",
      });
    });

    it("omits metadata fields when not present in event payload", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: { toolCallId: "tc-1", toolName: "bash", input: { command: "ls" } },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
        {
          kind: "tool-result",
          payload: { toolCallId: "tc-1", toolName: "bash", output: "ok", isError: false },
        },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      const callPart = messages[0]!.parts[0]!;
      expect(callPart).toEqual({
        type: "tool-call",
        toolCallId: "tc-1",
        toolName: "bash",
        input: { command: "ls" },
      });

      const resultPart = messages[1]!.parts[0]!;
      expect(resultPart).toEqual({
        type: "tool-result",
        toolCallId: "tc-1",
        toolName: "bash",
        output: "ok",
        isError: false,
      });
    });

    it("updates toolLabel on duplicate tool-call events (async LLM label)", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "web_search",
            input: { query: "weather" },
            toolLabel: "Searching the web...",
          },
        },
        // Second tool-call event with updated LLM-generated label
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "web_search",
            input: { query: "weather" },
            toolLabel: "Looking up the current weather forecast",
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      expect(messages[0]!.parts).toHaveLength(1);
      expect(messages[0]!.parts[0]).toMatchObject({
        type: "tool-call",
        toolCallId: "tc-1",
        toolName: "web_search",
        toolLabel: "Looking up the current weather forecast",
      });
    });

    it("adds metadata via duplicate tool-call when original had none", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "bash",
            input: { command: "ls" },
          },
        },
        // Async label update arrives
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "bash",
            input: { command: "ls" },
            toolLabel: "Listing directory contents",
            skillName: "Shell",
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      expect(messages[0]!.parts).toHaveLength(1);
      expect(messages[0]!.parts[0]).toMatchObject({
        type: "tool-call",
        toolCallId: "tc-1",
        toolLabel: "Listing directory contents",
        skillName: "Shell",
      });
    });

    it("preserves metadata from earlier event when later duplicate omits fields", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            input: { query: "invoice" },
            toolLabel: "Searching your inbox",
            skillName: "Email",
            skillIcon: "mail",
          },
        },
        // Later duplicate carries only an updated label; skillName/skillIcon
        // must survive rather than being erased by the spread.
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            input: { query: "invoice" },
            toolLabel: "Found 3 invoices",
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      expect(messages[0]!.parts).toHaveLength(1);
      expect(messages[0]!.parts[0]).toEqual({
        type: "tool-call",
        toolCallId: "tc-1",
        toolName: "search_emails",
        input: { query: "invoice" },
        toolLabel: "Found 3 invoices",
        skillName: "Email",
        skillIcon: "mail",
      });
    });

    it("preserves metadata on tool-result parts when isError is true", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "read_file",
            input: { path: "missing.ts" },
            toolLabel: "Read file: missing.ts",
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
        {
          kind: "tool-result",
          payload: {
            toolCallId: "tc-1",
            toolName: "read_file",
            output: "ENOENT: no such file",
            isError: true,
            toolLabel: "Failed to read file: missing.ts",
            skillName: "Filesystem",
            skillIcon: "folder",
          },
        },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      const resultPart = messages[1]!.parts[0]!;
      expect(resultPart).toEqual({
        type: "tool-result",
        toolCallId: "tc-1",
        toolName: "read_file",
        output: "ENOENT: no such file",
        isError: true,
        toolLabel: "Failed to read file: missing.ts",
        skillName: "Filesystem",
        skillIcon: "folder",
      });
    });

    it("reuses tool-call metadata when the tool-result payload omits it", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "read_file",
            input: { path: "utils.ts" },
            toolLabel: "Read file: utils.ts",
            skillName: "Filesystem",
            skillIcon: "folder",
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
        {
          kind: "tool-result",
          payload: {
            toolCallId: "tc-1",
            toolName: "read_file",
            output: "file contents",
            isError: false,
          },
        },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      const resultPart = messages[1]!.parts[0]!;
      expect(resultPart).toEqual({
        type: "tool-result",
        toolCallId: "tc-1",
        toolName: "read_file",
        output: "file contents",
        isError: false,
        toolLabel: "Read file: utils.ts",
        skillName: "Filesystem",
        skillIcon: "folder",
      });
    });

    it("propagates duplicate tool-call metadata updates to the eventual tool-result", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            input: { query: "invoice" },
            toolLabel: "Searching your inbox",
            skillName: "Email",
            skillIcon: "mail",
          },
        },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            input: { query: "invoice" },
            toolLabel: "Found 3 invoices",
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
        {
          kind: "tool-result",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            output: "Found 3 emails",
            isError: false,
          },
        },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      const resultPart = messages[1]!.parts[0]!;
      expect(resultPart).toEqual({
        type: "tool-result",
        toolCallId: "tc-1",
        toolName: "search_emails",
        output: "Found 3 emails",
        isError: false,
        toolLabel: "Found 3 invoices",
        skillName: "Email",
        skillIcon: "mail",
      });
    });
  });
});
