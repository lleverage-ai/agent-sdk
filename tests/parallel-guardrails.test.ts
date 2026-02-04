import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import {
  BufferedOutputGuardrail,
  // Buffered Output Guardrails
  createBufferedOutputGuardrail,
  createRegexGuardrail,
  extractTextFromMessages,
  findLastUserMessageId,
  GeneratePermissionDeniedError,
  type Guardrail,
  raceGuardrails,
  runWithGuardrails,
  withTimeout,
  wrapStreamWithOutputGuardrail,
} from "../src/index.js";

// Helper to create mock UIMessages
function createMockMessages(texts: string[]): UIMessage[] {
  return texts.map((text, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    content: text,
    parts: [{ type: "text" as const, text }],
    createdAt: new Date(),
  }));
}

describe("Composable Guardrails", () => {
  describe("Guardrail type", () => {
    it("accepts sync guardrail functions", async () => {
      const guardrail: Guardrail = (text) => ({
        blocked: text.includes("SECRET"),
        reason: "Contains secret",
      });

      const result = await guardrail("Hello world");
      expect(result.blocked).toBe(false);

      const blockedResult = await guardrail("My SECRET key");
      expect(blockedResult.blocked).toBe(true);
      expect(blockedResult.reason).toBe("Contains secret");
    });

    it("accepts async guardrail functions", async () => {
      const guardrail: Guardrail = async (text) => {
        await new Promise((r) => setTimeout(r, 1));
        return {
          blocked: text.includes("BAD"),
          reason: "Contains bad word",
        };
      };

      const result = await guardrail("Hello world");
      expect(result.blocked).toBe(false);
    });

    it("receives abort signal", async () => {
      let receivedSignal: AbortSignal | undefined;
      const guardrail: Guardrail = async (text, signal) => {
        receivedSignal = signal;
        return { blocked: false };
      };

      const controller = new AbortController();
      await guardrail("test", controller.signal);

      expect(receivedSignal).toBe(controller.signal);
    });
  });

  describe("raceGuardrails", () => {
    it("passes when no guardrails are provided", async () => {
      await expect(raceGuardrails("test", [])).resolves.toBeUndefined();
    });

    it("passes when all guardrails pass", async () => {
      const guardrail1: Guardrail = () => ({ blocked: false });
      const guardrail2: Guardrail = () => ({ blocked: false });

      await expect(raceGuardrails("test", [guardrail1, guardrail2])).resolves.toBeUndefined();
    });

    it("throws GeneratePermissionDeniedError when any guardrail blocks", async () => {
      const passingGuardrail: Guardrail = () => ({ blocked: false });
      const blockingGuardrail: Guardrail = () => ({
        blocked: true,
        reason: "Blocked by test",
      });

      await expect(raceGuardrails("test", [passingGuardrail, blockingGuardrail])).rejects.toThrow(
        GeneratePermissionDeniedError,
      );
    });

    it("includes reason in error", async () => {
      const guardrail: Guardrail = () => ({
        blocked: true,
        reason: "Contains sensitive data",
      });

      try {
        await raceGuardrails("test", [guardrail]);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(GeneratePermissionDeniedError);
        const gpde = error as GeneratePermissionDeniedError;
        expect(gpde.reason).toBe("Contains sensitive data");
      }
    });

    it("includes blockedMessageIds from guardrail result", async () => {
      const guardrail: Guardrail = () => ({
        blocked: true,
        reason: "Blocked",
        blockedMessageIds: ["msg-1", "msg-2"],
      });

      try {
        await raceGuardrails("test", [guardrail]);
        expect.fail("Should have thrown");
      } catch (error) {
        const gpde = error as GeneratePermissionDeniedError;
        expect(gpde.blockedMessageIds).toEqual(["msg-1", "msg-2"]);
      }
    });

    it("uses options.blockedMessageIds as fallback", async () => {
      const guardrail: Guardrail = () => ({
        blocked: true,
        reason: "Blocked",
        // No blockedMessageIds
      });

      try {
        await raceGuardrails("test", [guardrail], undefined, {
          blockedMessageIds: ["fallback-id"],
        });
        expect.fail("Should have thrown");
      } catch (error) {
        const gpde = error as GeneratePermissionDeniedError;
        expect(gpde.blockedMessageIds).toEqual(["fallback-id"]);
      }
    });

    it("uses options.blockedMessage when guardrail has no reason", async () => {
      const guardrail: Guardrail = () => ({ blocked: true });

      try {
        await raceGuardrails("test", [guardrail], undefined, {
          blockedMessage: "Custom blocked message",
        });
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toBe("Custom blocked message");
      }
    });

    it("runs all guardrails in parallel", async () => {
      const startTimes: number[] = [];
      const createTimingGuardrail =
        (index: number): Guardrail =>
        async () => {
          startTimes.push(Date.now());
          await new Promise((r) => setTimeout(r, 10));
          return { blocked: false };
        };

      const guardrails = [
        createTimingGuardrail(0),
        createTimingGuardrail(1),
        createTimingGuardrail(2),
      ];

      await raceGuardrails("test", guardrails);

      // All should have started within a few ms of each other
      const maxDiff = Math.max(...startTimes) - Math.min(...startTimes);
      expect(maxDiff).toBeLessThan(5);
    });

    it("passes abort signal to all guardrails", async () => {
      const receivedSignals: (AbortSignal | undefined)[] = [];
      const guardrail: Guardrail = async (text, signal) => {
        receivedSignals.push(signal);
        return { blocked: false };
      };

      const controller = new AbortController();
      await raceGuardrails("test", [guardrail, guardrail], controller.signal);

      expect(receivedSignals).toHaveLength(2);
      expect(receivedSignals[0]).toBe(controller.signal);
      expect(receivedSignals[1]).toBe(controller.signal);
    });
  });

  describe("runWithGuardrails", () => {
    it("runs generate function when guardrails pass", async () => {
      const guardrail: Guardrail = () => ({ blocked: false });
      const generateFn = vi.fn().mockResolvedValue({ text: "Hello!" });

      const result = await runWithGuardrails("test input", [guardrail], generateFn);

      expect(generateFn).toHaveBeenCalledWith(expect.any(AbortSignal));
      expect(result).toEqual({ text: "Hello!" });
    });

    it("throws when guardrail blocks", async () => {
      const guardrail: Guardrail = () => ({
        blocked: true,
        reason: "Blocked",
      });
      const generateFn = vi.fn().mockResolvedValue({ text: "Hello!" });

      await expect(runWithGuardrails("test input", [guardrail], generateFn)).rejects.toThrow(
        GeneratePermissionDeniedError,
      );
    });

    it("aborts generation when guardrail fails", async () => {
      let capturedSignal: AbortSignal | undefined;
      const slowGuardrail: Guardrail = async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { blocked: true, reason: "Late block" };
      };

      const generateFn = vi.fn().mockImplementation(async (signal) => {
        capturedSignal = signal;
        // Simulate slow generation
        await new Promise((r) => setTimeout(r, 100));
        return { text: "Hello!" };
      });

      await expect(runWithGuardrails("test input", [slowGuardrail], generateFn)).rejects.toThrow(
        GeneratePermissionDeniedError,
      );

      // Signal should have been aborted
      expect(capturedSignal?.aborted).toBe(true);
    });

    it("propagates non-guardrail errors", async () => {
      const guardrail: Guardrail = () => ({ blocked: false });
      const generateFn = vi.fn().mockRejectedValue(new Error("Network error"));

      await expect(runWithGuardrails("test input", [guardrail], generateFn)).rejects.toThrow(
        "Network error",
      );
    });
  });

  describe("createRegexGuardrail", () => {
    it("creates a guardrail that blocks matching patterns", async () => {
      const guardrail = createRegexGuardrail([/SECRET/i, /PASSWORD/i]);

      const safe = await guardrail("Hello world");
      expect(safe.blocked).toBe(false);

      const blocked1 = await guardrail("My SECRET key");
      expect(blocked1.blocked).toBe(true);

      const blocked2 = await guardrail("password=123");
      expect(blocked2.blocked).toBe(true);
    });

    it("uses custom reason when provided", async () => {
      const guardrail = createRegexGuardrail([/SECRET/i], "Contains sensitive data");

      const result = await guardrail("SECRET data");
      expect(result.reason).toBe("Contains sensitive data");
    });

    it("includes pattern in default reason", async () => {
      const guardrail = createRegexGuardrail([/SECRET/i]);

      const result = await guardrail("SECRET data");
      expect(result.reason).toContain("SECRET");
    });
  });

  describe("withTimeout", () => {
    it("returns guardrail result if it completes in time", async () => {
      const fastGuardrail: Guardrail = async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { blocked: true, reason: "Fast block" };
      };

      const timedGuardrail = withTimeout(fastGuardrail, 1000);
      const result = await timedGuardrail("test");

      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("Fast block");
    });

    it("returns non-blocking result on timeout (fail-open)", async () => {
      const slowGuardrail: Guardrail = async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return { blocked: true, reason: "Slow block" };
      };

      const timedGuardrail = withTimeout(slowGuardrail, 10);
      const result = await timedGuardrail("test");

      expect(result.blocked).toBe(false);
    });

    it("returns blocking result on timeout when failOpen=false", async () => {
      const slowGuardrail: Guardrail = async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return { blocked: false };
      };

      const timedGuardrail = withTimeout(slowGuardrail, 10, false);
      const result = await timedGuardrail("test");

      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("Guardrail check timed out");
    });
  });

  describe("extractTextFromMessages", () => {
    it("extracts text from message parts", () => {
      const messages = createMockMessages(["Hello", "World", "Test"]);
      const text = extractTextFromMessages(messages);

      expect(text).toBe("Hello\nWorld\nTest");
    });

    it("handles messages without text parts", () => {
      const messages: UIMessage[] = [
        {
          id: "msg-1",
          role: "user",
          content: "Has parts",
          parts: [{ type: "text", text: "Has parts" }],
          createdAt: new Date(),
        },
        {
          id: "msg-2",
          role: "assistant",
          content: "No text part",
          parts: [],
          createdAt: new Date(),
        },
      ];

      const text = extractTextFromMessages(messages);
      expect(text).toBe("Has parts");
    });

    it("returns empty string for empty messages", () => {
      const text = extractTextFromMessages([]);
      expect(text).toBe("");
    });
  });

  describe("findLastUserMessageId", () => {
    it("finds the last user message ID", () => {
      const messages = createMockMessages(["User 1", "Assistant", "User 2", "Assistant", "User 3"]);

      const id = findLastUserMessageId(messages);
      expect(id).toBe("msg-4");
    });

    it("returns undefined for empty messages", () => {
      const id = findLastUserMessageId([]);
      expect(id).toBeUndefined();
    });

    it("returns undefined when no user messages exist", () => {
      const messages: UIMessage[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: "Hello",
          parts: [{ type: "text", text: "Hello" }],
          createdAt: new Date(),
        },
      ];

      const id = findLastUserMessageId(messages);
      expect(id).toBeUndefined();
    });
  });

  describe("integration: multiple guardrails racing", () => {
    it("first blocking guardrail wins", async () => {
      const guardrail1: Guardrail = () => ({
        blocked: true,
        reason: "Guardrail 1 blocks",
      });
      const guardrail2: Guardrail = () => ({
        blocked: true,
        reason: "Guardrail 2 blocks",
      });

      try {
        await raceGuardrails("test", [guardrail1, guardrail2]);
        expect.fail("Should have thrown");
      } catch (error) {
        const gpde = error as GeneratePermissionDeniedError;
        // First blocking result wins
        expect(gpde.reason).toBe("Guardrail 1 blocks");
      }
    });

    it("combines regex and custom guardrails", async () => {
      const regexGuardrail = createRegexGuardrail([/SECRET/i]);
      const customGuardrail: Guardrail = (text) => ({
        blocked: text.length > 1000,
        reason: "Text too long",
      });

      // Should pass
      await expect(
        raceGuardrails("Hello world", [regexGuardrail, customGuardrail]),
      ).resolves.toBeUndefined();

      // Should block on regex
      await expect(
        raceGuardrails("SECRET data", [regexGuardrail, customGuardrail]),
      ).rejects.toThrow(GeneratePermissionDeniedError);

      // Should block on length
      await expect(
        raceGuardrails("x".repeat(1001), [regexGuardrail, customGuardrail]),
      ).rejects.toThrow(GeneratePermissionDeniedError);
    });
  });
});

// =============================================================================
// Buffered Output Guardrails Tests
// =============================================================================

describe("Buffered Output Guardrails", () => {
  describe("createBufferedOutputGuardrail", () => {
    it("creates a BufferedOutputGuardrail instance", () => {
      const guardrail = createBufferedOutputGuardrail({
        guardrails: () => ({ blocked: false }),
      });
      expect(guardrail).toBeInstanceOf(BufferedOutputGuardrail);
    });

    it("starts in buffering state", () => {
      const guardrail = createBufferedOutputGuardrail({
        guardrails: () => ({ blocked: false }),
      });
      expect(guardrail.currentState).toBe("buffering");
      expect(guardrail.isBuffering()).toBe(true);
      expect(guardrail.hasPassed()).toBe(false);
      expect(guardrail.hasBlocked()).toBe(false);
    });

    it("accepts single guardrail", () => {
      const guardrail = createBufferedOutputGuardrail({
        guardrails: () => ({ blocked: false }),
      });
      expect(guardrail).toBeInstanceOf(BufferedOutputGuardrail);
    });

    it("accepts array of guardrails", () => {
      const guardrail = createBufferedOutputGuardrail({
        guardrails: [() => ({ blocked: false }), () => ({ blocked: false })],
      });
      expect(guardrail).toBeInstanceOf(BufferedOutputGuardrail);
    });
  });

  describe("BufferedOutputGuardrail.addContent", () => {
    it("adds content to buffer", () => {
      const guardrail = createBufferedOutputGuardrail({
        guardrails: () => ({ blocked: false }),
      });

      expect(guardrail.addContent("Hello ")).toBe(true);
      expect(guardrail.addContent("World")).toBe(true);
      expect(guardrail.getBuffer()).toBe("Hello World");
    });

    it("returns false after blocking via finalize", async () => {
      const guardrail = createBufferedOutputGuardrail({
        guardrails: (text) => ({
          blocked: text.includes("BAD"),
          reason: "Bad content",
        }),
      });

      expect(guardrail.addContent("BAD content")).toBe(true);

      // Finalize triggers the check
      await expect(guardrail.finalize()).rejects.toThrow(GeneratePermissionDeniedError);
      expect(guardrail.hasBlocked()).toBe(true);

      // After blocking, new content should be rejected
      expect(guardrail.addContent("more")).toBe(false);
    });
  });

  describe("BufferedOutputGuardrail.addChunk", () => {
    it("buffers chunks when not blocked", () => {
      const guardrail = createBufferedOutputGuardrail({
        guardrails: () => ({ blocked: false }),
      });

      const chunk1 = { type: "text-delta", delta: "Hello" };
      const chunk2 = { type: "text-delta", delta: " World" };

      expect(guardrail.addChunk(chunk1)).toBe(true);
      expect(guardrail.addChunk(chunk2)).toBe(true);
      expect(guardrail.getChunks()).toEqual([chunk1, chunk2]);
    });
  });

  describe("BufferedOutputGuardrail.finalize", () => {
    it("sets state to passed when guardrails pass", async () => {
      const guardrail = createBufferedOutputGuardrail({
        guardrails: () => ({ blocked: false }),
      });
      guardrail.addContent("Safe content");

      await guardrail.finalize();

      expect(guardrail.hasPassed()).toBe(true);
      expect(guardrail.currentState).toBe("passed");
    });

    it("throws when guardrail blocks on finalize", async () => {
      const guardrail = createBufferedOutputGuardrail({
        guardrails: (text) => ({
          blocked: text.includes("SECRET"),
          reason: "Contains secret",
        }),
      });

      guardrail.addContent("Has SECRET data");

      await expect(guardrail.finalize()).rejects.toThrow(GeneratePermissionDeniedError);
      expect(guardrail.hasBlocked()).toBe(true);
    });

    it("runs all guardrails in array", async () => {
      const called: string[] = [];
      const guardrail1: Guardrail = () => {
        called.push("g1");
        return { blocked: false };
      };
      const guardrail2: Guardrail = () => {
        called.push("g2");
        return { blocked: false };
      };

      const buffered = createBufferedOutputGuardrail({
        guardrails: [guardrail1, guardrail2],
      });

      buffered.addContent("Content");
      await buffered.finalize();

      expect(called).toContain("g1");
      expect(called).toContain("g2");
    });
  });

  describe("BufferedOutputGuardrail.clear", () => {
    it("clears buffer and chunks", () => {
      const guardrail = createBufferedOutputGuardrail({
        guardrails: () => ({ blocked: false }),
      });

      guardrail.addContent("Some content");
      guardrail.addChunk({ type: "text" });

      guardrail.clear();

      expect(guardrail.getBuffer()).toBe("");
      expect(guardrail.getChunks()).toEqual([]);
    });
  });

  describe("BufferedOutputGuardrail.abort", () => {
    it("aborts the signal and sets error state", () => {
      const guardrail = createBufferedOutputGuardrail({
        guardrails: () => ({ blocked: false }),
      });

      expect(guardrail.signal.aborted).toBe(false);
      guardrail.abort();
      expect(guardrail.signal.aborted).toBe(true);
      expect(guardrail.currentState).toBe("error");
    });
  });

  describe("async guardrail triggering", () => {
    it("triggers guardrail when buffer exceeds minBufferSize", async () => {
      const checkCalled = vi.fn().mockReturnValue({ blocked: false });
      const guardrail = createBufferedOutputGuardrail({
        guardrails: checkCalled,
        minBufferSize: 10,
      });

      // Add content below threshold
      guardrail.addContent("short");
      await new Promise((r) => setTimeout(r, 10));
      expect(checkCalled).not.toHaveBeenCalled();

      // Add content to exceed threshold
      guardrail.addContent(" longer content");
      await new Promise((r) => setTimeout(r, 50));

      expect(checkCalled).toHaveBeenCalled();
    });
  });

  describe("wrapStreamWithOutputGuardrail", () => {
    it("passes through content when guardrail passes", async () => {
      const chunks = [
        { type: "text-delta", delta: "Hello " },
        { type: "text-delta", delta: "World" },
      ];

      const sourceStream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      const guardedStream = wrapStreamWithOutputGuardrail(sourceStream, {
        guardrails: () => ({ blocked: false }),
      });

      const reader = guardedStream.getReader();
      const results: unknown[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        results.push(value);
      }

      expect(results).toEqual(chunks);
    });

    it("errors stream when guardrail blocks", async () => {
      const chunks = [
        { type: "text-delta", delta: "Hello " },
        { type: "text-delta", delta: "SECRET_DATA" },
      ];

      const sourceStream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      const guardedStream = wrapStreamWithOutputGuardrail(sourceStream, {
        guardrails: (text) => ({
          blocked: text.includes("SECRET"),
          reason: "Contains secret",
        }),
      });

      const reader = guardedStream.getReader();

      let error: unknown = null;
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(GeneratePermissionDeniedError);
    });
  });

  describe("withTimeout integration", () => {
    it("works with buffered guardrails", async () => {
      const slowGuardrail: Guardrail = async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return { blocked: true, reason: "Should timeout" };
      };

      const timedGuardrail = withTimeout(slowGuardrail, 10);

      const buffered = createBufferedOutputGuardrail({
        guardrails: timedGuardrail,
        timeout: 10,
      });

      buffered.addContent("Test content");

      // Should pass because timeout means fail-open
      await expect(buffered.finalize()).resolves.toBeUndefined();
      expect(buffered.hasPassed()).toBe(true);
    });
  });
});
