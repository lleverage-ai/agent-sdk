/**
 * Tests for the failure-as-data tool result contract (#131): the
 * AgentToolResult helpers, toToolFailure classification and safeTool().
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type ToolExecutionOptions, type ToolSet, tool } from "ai";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AgentError,
  createAgent,
  isToolFailure,
  RateLimitError,
  safeTool,
  toolFailure,
  toolSuccess,
  toToolFailure,
} from "../src/index.js";
import { createMockModel, resetMocks } from "./setup.js";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: vi.fn() };
});

import { generateText } from "ai";

const execOpts = {
  toolCallId: "call-1",
  messages: [],
  abortSignal: undefined as unknown as AbortSignal,
  context: undefined,
} as ToolExecutionOptions<unknown>;

/** undici's shape when a response body is cut off mid-stream. */
function undiciTerminated(): TypeError {
  const socketError = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
  return new TypeError("terminated", { cause: socketError });
}

function throwingTool(error: unknown) {
  return tool({
    description: "Always throws",
    inputSchema: z.object({}),
    execute: async (): Promise<string> => {
      throw error;
    },
  });
}

describe("toolSuccess / toolFailure / isToolFailure", () => {
  it("builds both sides of the contract", () => {
    expect(toolSuccess({ id: 1 })).toEqual({ success: true, data: { id: 1 } });
    expect(toolSuccess([], "empty page")).toEqual({ success: true, data: [], note: "empty page" });
    expect(toolFailure("No order 42.", { code: "ORDER_NOT_FOUND", recoverable: true })).toEqual({
      success: false,
      error: "No order 42.",
      code: "ORDER_NOT_FOUND",
      recoverable: true,
    });
  });

  it("recognises failures and nothing else", () => {
    expect(isToolFailure(toolFailure("nope"))).toBe(true);
    expect(isToolFailure(toolSuccess("ok"))).toBe(false);
    expect(isToolFailure({ success: false })).toBe(false);
    expect(isToolFailure("Error: terminated")).toBe(false);
    expect(isToolFailure(null)).toBe(false);
  });
});

describe("toToolFailure", () => {
  it("classifies undici's TypeError: terminated as a recoverable network failure", () => {
    const failure = toToolFailure(undiciTerminated());
    expect(failure).toEqual({
      success: false,
      error: "The connection to the service dropped before the call finished.",
      code: "NETWORK_ERROR",
      recoverable: true,
    });
    expect(JSON.stringify(failure)).not.toContain("terminated");
    // Re-thrown across a workflow boundary, the cause is often gone.
    expect(toToolFailure(new TypeError("terminated"))).toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("classifies Node socket codes found anywhere in the cause chain", () => {
    const reset = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    expect(toToolFailure(new Error("fetch failed", { cause: reset }))).toMatchObject({
      code: "NETWORK_ERROR",
      recoverable: true,
    });
    const headers = Object.assign(new Error("Headers Timeout Error"), {
      code: "UND_ERR_HEADERS_TIMEOUT",
    });
    expect(toToolFailure(headers)).toMatchObject({ code: "TIMEOUT_ERROR", recoverable: true });
  });

  it("treats AbortSignal.timeout() rejections as timeouts, not cancellation", () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(toToolFailure(timeout)).toMatchObject({ code: "TIMEOUT_ERROR", recoverable: true });
  });

  it("keeps an AgentError's code, retryability, delay and user message", () => {
    const failure = toToolFailure(
      new RateLimitError("ERP 429 from erp-internal:8443", { retryAfter: 2000 }),
    );
    expect(failure).toEqual({
      success: false,
      error: "Rate limit reached. Please wait a moment before trying again.",
      code: "RATE_LIMIT_ERROR",
      recoverable: true,
      retryAfterMs: 2000,
    });

    const custom = toToolFailure(
      new AgentError("upstream returned <html>", {
        code: "BACKEND_ERROR",
        userMessage: "The ERP returned an unreadable response.",
        retryable: true,
      }),
    );
    expect(custom).toEqual({
      success: false,
      error: "The ERP returned an unreadable response.",
      code: "BACKEND_ERROR",
      recoverable: true,
    });
  });

  it("never forwards the message or stack of an unclassified error", () => {
    const bug = new Error(
      "Cannot read properties of undefined (reading 'lines') at /srv/app/erp.ts:88",
    );
    const failure = toToolFailure(bug);
    expect(failure).toEqual({
      success: false,
      error: "The tool failed unexpectedly.",
      code: "UNKNOWN_ERROR",
      recoverable: false,
    });
    expect(toToolFailure("raw string thrown")).toMatchObject({ code: "UNKNOWN_ERROR" });
  });

  it("maps message-inferred kinds to fixed messages", () => {
    expect(toToolFailure(new Error("HTTP 429 from https://erp.internal/api"))).toEqual({
      success: false,
      error: "The service is rate limiting requests.",
      code: "RATE_LIMIT_ERROR",
      recoverable: true,
    });
  });
});

describe("toToolFailure with real Node transport failures", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/drop") {
        // Promise a long body, send part of it, then cut the socket.
        res.writeHead(200, { "content-length": "1000" });
        res.write('{"orders":[');
        setTimeout(() => res.socket?.destroy(), 10);
      }
      // "/stall" never responds.
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("classifies a body cut off mid-stream", async () => {
    const error = await fetch(`${baseUrl}/drop`)
      .then((res) => res.text())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe("terminated");
    expect(toToolFailure(error)).toMatchObject({ code: "NETWORK_ERROR", recoverable: true });
  });

  it("classifies a request that hits its own timeout", async () => {
    const error = await fetch(`${baseUrl}/stall`, { signal: AbortSignal.timeout(20) }).catch(
      (e: unknown) => e,
    );
    expect(toToolFailure(error)).toMatchObject({ code: "TIMEOUT_ERROR", recoverable: true });
  });
});

describe("safeTool", () => {
  it("passes successful outputs through unchanged", async () => {
    const plain = safeTool(
      tool({ description: "", inputSchema: z.object({}), execute: async () => "ok" }),
    );
    await expect(plain.execute!({}, execOpts)).resolves.toBe("ok");

    const typed = safeTool(
      tool({
        description: "",
        inputSchema: z.object({}),
        execute: async () => toolFailure("No order 42.", { code: "ORDER_NOT_FOUND" }),
      }),
    );
    await expect(typed.execute!({}, execOpts)).resolves.toEqual({
      success: false,
      error: "No order 42.",
      code: "ORDER_NOT_FOUND",
    });
  });

  it("returns a ToolFailure instead of throwing, and hands the original to onError", async () => {
    const original = undiciTerminated();
    const onError = vi.fn();
    const wrapped = safeTool(throwingTool(original), { onError });

    await expect(wrapped.execute!({}, execOpts)).resolves.toMatchObject({
      success: false,
      code: "NETWORK_ERROR",
      recoverable: true,
    });
    expect(onError).toHaveBeenCalledWith(original, { toolCallId: "call-1" });
  });

  it("re-throws when the run itself was cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException("This operation was aborted", "AbortError");
    const wrapped = safeTool(throwingTool(abortError));

    await expect(
      wrapped.execute!({}, { ...execOpts, abortSignal: controller.signal }),
    ).rejects.toBe(abortError);
  });

  it("leaves tools without execute untouched", () => {
    const clientSide = tool({ description: "client-side", inputSchema: z.object({}) });
    expect(safeTool(clientSide)).toBe(clientSide);
  });
});

describe("safeTool inside the agent tool pipeline", () => {
  beforeEach(() => {
    resetMocks();
    vi.mocked(generateText).mockResolvedValue({
      text: "ok",
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
      steps: [{ text: "ok", toolCalls: [], toolResults: [], finishReason: "stop" }],
      response: { id: "r", timestamp: new Date(), modelId: "m", messages: [] },
    } as never);
  });

  function pipelineTool(name: string): NonNullable<ToolSet[string]> {
    const calls = vi.mocked(generateText).mock.calls;
    const args = calls[calls.length - 1]?.[0] as unknown as { tools: ToolSet };
    return args.tools[name]!;
  }

  it("hands the model a structured failure, so transformToolError never sees it", async () => {
    const transformToolError = vi.fn((error: unknown) => error);
    const agent = createAgent({
      model: createMockModel(),
      transformToolError,
      tools: { run_workflow: safeTool(throwingTool(undiciTerminated())) },
    });

    await agent.generate({ prompt: "go" });
    const output = await pipelineTool("run_workflow").execute!({}, execOpts);

    expect(isToolFailure(output)).toBe(true);
    expect(output).toMatchObject({ code: "NETWORK_ERROR", recoverable: true });
    expect(transformToolError).not.toHaveBeenCalled();
  });

  it("lets interrupts through to the agent", async () => {
    const { MemorySaver } = await import("../src/checkpointer/memory-saver.js");
    const agent = createAgent({
      model: createMockModel(),
      checkpointer: new MemorySaver(),
      tools: {
        ask: safeTool(
          tool({
            description: "Interrupts",
            inputSchema: z.object({}),
            execute: async (_input, options) => {
              const extended = options as {
                interrupt?: (type: string, request: unknown) => Promise<unknown>;
              };
              return extended.interrupt!("question", { question: "which warehouse?" });
            },
          }),
        ),
      },
    });

    await agent.generate({ prompt: "go", threadId: "t-safe-interrupt" });
    await expect(pipelineTool("ask").execute!({}, execOpts)).resolves.toBe("[Interrupt requested]");
  });
});
