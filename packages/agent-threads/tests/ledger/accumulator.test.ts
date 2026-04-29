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

    it("discards empty assistant messages at step boundaries", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "stop" } },
        { kind: "step-started", payload: { stepIndex: 1 } },
        { kind: "text-delta", payload: { delta: "Next step" } },
        { kind: "step-finished", payload: { stepIndex: 1, finishReason: "stop" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        id: "msg-2",
        parentMessageId: null,
        role: "assistant",
        parts: [{ type: "text", text: "Next step" }],
      });
    });

    it("does not commit assistant turns on tool-result before step-finished", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        { kind: "text-delta", payload: { delta: "I'll check." } },
        {
          kind: "tool-call",
          payload: { toolCallId: "tc-1", toolName: "search", input: { query: "weather" } },
        },
        {
          kind: "tool-result",
          payload: {
            toolCallId: "tc-1",
            toolName: "search",
            output: "Sunny",
            isError: false,
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
        { kind: "step-started", payload: { stepIndex: 1 } },
        { kind: "text-delta", payload: { delta: "It is sunny." } },
        { kind: "step-finished", payload: { stepIndex: 1, finishReason: "stop" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);

      expect(messages).toHaveLength(3);
      expect(messages[0]).toMatchObject({
        id: "msg-1",
        parentMessageId: null,
        role: "assistant",
        parts: [
          { type: "text", text: "I'll check." },
          {
            type: "tool-call",
            toolCallId: "tc-1",
            toolName: "search",
            input: { query: "weather" },
          },
        ],
        metadata: {
          stepFinish: { stepIndex: 0, finishReason: "tool-calls" },
        },
      });
      expect(messages[1]).toMatchObject({
        id: "msg-2",
        parentMessageId: "msg-1",
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: "tc-1",
            toolName: "search",
            output: "Sunny",
            isError: false,
          },
        ],
      });
      expect(messages[2]).toMatchObject({
        id: "msg-3",
        parentMessageId: "msg-2",
        role: "assistant",
        parts: [{ type: "text", text: "It is sunny." }],
      });
    });

    it("queues multiple early tool results until the assistant step boundary", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: { toolCallId: "tc-1", toolName: "read", input: { path: "/a.txt" } },
        },
        {
          kind: "tool-call",
          payload: { toolCallId: "tc-2", toolName: "read", input: { path: "/b.txt" } },
        },
        {
          kind: "tool-result",
          payload: { toolCallId: "tc-1", toolName: "read", output: "a", isError: false },
        },
        {
          kind: "tool-result",
          payload: { toolCallId: "tc-2", toolName: "read", output: "b", isError: false },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);

      expect(messages.map((message) => message.role)).toEqual(["assistant", "tool", "tool"]);
      expect(messages.map((message) => message.parentMessageId)).toEqual([null, "msg-1", "msg-2"]);
      expect(messages[1]!.parts[0]).toMatchObject({ toolCallId: "tc-1", output: "a" });
      expect(messages[2]!.parts[0]).toMatchObject({ toolCallId: "tc-2", output: "b" });
    });

    it("flushes queued early tool results when accumulation ends mid-step", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: { toolCallId: "tc-1", toolName: "read", input: { path: "/a.txt" } },
        },
        {
          kind: "tool-result",
          payload: { toolCallId: "tc-1", toolName: "read", output: "a", isError: false },
        },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);

      expect(messages.map((message) => message.role)).toEqual(["assistant", "tool"]);
      expect(messages[1]).toMatchObject({
        parentMessageId: "msg-1",
        parts: [{ type: "tool-result", toolCallId: "tc-1", output: "a" }],
      });
    });

    it("flushes queued early tool results before user messages", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: { toolCallId: "tc-1", toolName: "read", input: { path: "/a.txt" } },
        },
        {
          kind: "tool-result",
          payload: { toolCallId: "tc-1", toolName: "read", output: "a", isError: false },
        },
        { kind: "user-message", payload: { content: "Next user turn" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);

      expect(messages.map((message) => message.role)).toEqual(["assistant", "tool", "user"]);
      expect(messages.map((message) => message.parentMessageId)).toEqual([null, "msg-1", "msg-2"]);
      expect(messages[2]!.parts).toEqual([{ type: "text", text: "Next user turn" }]);
    });
  });

  describe("tool metadata", () => {
    it("preserves generic metadata on tool-call and tool-result parts", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "gmail_send",
            input: { subject: "Hello" },
            metadata: {
              toolLabel: "Send email",
              skillId: "skl-gmail",
              componentId: "cmp-compose",
            },
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
        {
          kind: "tool-result",
          payload: {
            toolCallId: "tc-1",
            toolName: "gmail_send",
            output: "sent",
            isError: false,
            metadata: {
              toolLabel: "Sent email",
              skillId: "skl-gmail",
              componentId: "cmp-compose",
            },
          },
        },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      const callPart = messages[0]!.parts[0]!;
      expect(callPart).toMatchObject({
        type: "tool-call",
        toolCallId: "tc-1",
        metadata: {
          toolLabel: "Send email",
          skillId: "skl-gmail",
          componentId: "cmp-compose",
        },
      });

      const resultPart = messages[1]!.parts[0]!;
      expect(resultPart).toMatchObject({
        type: "tool-result",
        toolCallId: "tc-1",
        metadata: {
          toolLabel: "Sent email",
          skillId: "skl-gmail",
          componentId: "cmp-compose",
        },
      });
    });

    it("normalizes legacy top-level metadata fields into metadata for compatibility", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            input: { query: "invoice" },
            toolLabel: "Searching inbox",
            skillName: "Email",
            skillIcon: "mail",
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
        {
          kind: "tool-result",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            output: "ok",
            isError: false,
            toolLabel: "Found 3 invoices",
          },
        },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      const callPart = messages[0]!.parts[0]!;
      expect(callPart).toMatchObject({
        type: "tool-call",
        metadata: {
          toolLabel: "Searching inbox",
          skillName: "Email",
          skillIcon: "mail",
        },
      });

      const resultPart = messages[1]!.parts[0]!;
      expect(resultPart).toMatchObject({
        type: "tool-result",
        metadata: {
          toolLabel: "Found 3 invoices",
          skillName: "Email",
          skillIcon: "mail",
        },
      });
    });

    it("omits metadata when not present in event payload", () => {
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

    it("updates metadata on duplicate tool-call events", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "web_search",
            input: { query: "weather" },
            metadata: {
              toolLabel: "Searching the web...",
              skillId: "skl-search",
            },
          },
        },
        // Second tool-call event with updated LLM-generated label
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "web_search",
            input: { query: "weather" },
            metadata: {
              toolLabel: "Looking up the current weather forecast",
            },
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
        metadata: {
          toolLabel: "Looking up the current weather forecast",
          skillId: "skl-search",
        },
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
            metadata: {
              toolLabel: "Listing directory contents",
              skillName: "Shell",
            },
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      expect(messages[0]!.parts).toHaveLength(1);
      expect(messages[0]!.parts[0]).toMatchObject({
        type: "tool-call",
        toolCallId: "tc-1",
        metadata: {
          toolLabel: "Listing directory contents",
          skillName: "Shell",
        },
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
            metadata: {
              toolLabel: "Searching your inbox",
              skillName: "Email",
              skillIcon: "mail",
            },
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
            metadata: {
              toolLabel: "Found 3 invoices",
            },
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
        metadata: {
          toolLabel: "Found 3 invoices",
          skillName: "Email",
          skillIcon: "mail",
        },
      });
    });

    it("deep-merges nested metadata on duplicate tool-call updates", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            input: { query: "invoice" },
            metadata: {
              ui: {
                label: "Searching your inbox",
                icon: "mail",
              },
              provenance: {
                skillId: "skl-email",
              },
            },
          },
        },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            input: { query: "invoice" },
            metadata: {
              ui: {
                label: "Found 3 invoices",
              },
            },
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      expect(messages[0]!.parts[0]).toEqual({
        type: "tool-call",
        toolCallId: "tc-1",
        toolName: "search_emails",
        input: { query: "invoice" },
        metadata: {
          ui: {
            label: "Found 3 invoices",
            icon: "mail",
          },
          provenance: {
            skillId: "skl-email",
          },
        },
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
            metadata: {
              toolLabel: "Read file: missing.ts",
            },
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
            metadata: {
              toolLabel: "Failed to read file: missing.ts",
              skillName: "Filesystem",
              skillIcon: "folder",
            },
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
        metadata: {
          toolLabel: "Failed to read file: missing.ts",
          skillName: "Filesystem",
          skillIcon: "folder",
        },
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
            metadata: {
              toolLabel: "Read file: utils.ts",
              skillName: "Filesystem",
              skillIcon: "folder",
            },
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
        metadata: {
          toolLabel: "Read file: utils.ts",
          skillName: "Filesystem",
          skillIcon: "folder",
        },
      });
    });

    it("falls back to pending tool-call toolName when tool-result omits it", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "read_file",
            input: { path: "utils.ts" },
            metadata: {
              toolLabel: "Read file: utils.ts",
            },
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
        {
          kind: "tool-result",
          payload: {
            toolCallId: "tc-1",
            output: "file contents",
            isError: false,
          },
        },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      expect(messages[1]!.parts[0]).toEqual({
        type: "tool-result",
        toolCallId: "tc-1",
        toolName: "read_file",
        output: "file contents",
        isError: false,
        metadata: {
          toolLabel: "Read file: utils.ts",
        },
      });
    });

    it("filters unsafe metadata keys during normalization", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "web_search",
            input: { query: "weather" },
            metadata: {
              toolLabel: "Searching the web...",
              ["__proto__"]: { polluted: true },
            },
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      expect(messages[0]!.parts[0]).toEqual({
        type: "tool-call",
        toolCallId: "tc-1",
        toolName: "web_search",
        input: { query: "weather" },
        metadata: {
          toolLabel: "Searching the web...",
        },
      });
      expect(Object.prototype).not.toHaveProperty("polluted");
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
            metadata: {
              toolLabel: "Searching your inbox",
              skillName: "Email",
              skillIcon: "mail",
            },
          },
        },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            input: { query: "invoice" },
            metadata: {
              toolLabel: "Found 3 invoices",
            },
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
        metadata: {
          toolLabel: "Found 3 invoices",
          skillName: "Email",
          skillIcon: "mail",
        },
      });
    });

    it("propagates duplicate tool-call metadata updates after an early tool-result", () => {
      const idGen = createCounterIdGenerator("msg");
      const storedEvents = wrapEvents([
        { kind: "step-started", payload: { stepIndex: 0 } },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            input: { query: "invoice" },
            metadata: {
              toolLabel: "Searching your inbox",
              skillName: "Email",
              skillIcon: "mail",
            },
          },
        },
        {
          kind: "tool-result",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            output: "Found 3 emails",
            isError: false,
          },
        },
        {
          kind: "tool-call",
          payload: {
            toolCallId: "tc-1",
            toolName: "search_emails",
            input: { query: "invoice" },
            metadata: {
              toolLabel: "Found 3 invoices",
            },
          },
        },
        { kind: "step-finished", payload: { stepIndex: 0, finishReason: "tool-calls" } },
      ]);

      const messages = accumulateEvents(storedEvents, idGen);
      const resultPart = messages[1]!.parts[0]!;
      expect(resultPart).toEqual({
        type: "tool-result",
        toolCallId: "tc-1",
        toolName: "search_emails",
        output: "Found 3 emails",
        isError: false,
        metadata: {
          toolLabel: "Found 3 invoices",
          skillName: "Email",
          skillIcon: "mail",
        },
      });
    });
  });
});
