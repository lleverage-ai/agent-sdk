import { tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentPlugin, StreamingContext } from "../src/index.js";
import { createAgent, definePlugin } from "../src/index.js";
import { createMockModel, resetMocks } from "./setup.js";

// Mock the AI SDK functions
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
    createUIMessageStream: vi.fn(),
    createUIMessageStreamResponse: vi.fn(),
  };
});

import { createUIMessageStream, createUIMessageStreamResponse, streamText } from "ai";

const execOpts = {
  toolCallId: "test",
  messages: [],
  abortSignal: undefined as unknown as AbortSignal,
};

describe("Streaming Tools", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe("StreamingContext type", () => {
    it("accepts null writer when not streaming", () => {
      const context: StreamingContext = { writer: null };
      expect(context.writer).toBeNull();
    });

    it("can be created with a writer object", () => {
      const mockWriter = {
        write: vi.fn(),
        merge: vi.fn(),
        onError: undefined,
      };
      const context: StreamingContext = { writer: mockWriter };
      expect(context.writer).toBe(mockWriter);
    });
  });

  describe("Function-based plugin tools", () => {
    it("creates plugin with static tools", () => {
      const staticTool = tool({
        description: "A static tool",
        parameters: z.object({ input: z.string() }),
        execute: async ({ input }) => `Static: ${input}`,
      });

      const plugin = definePlugin({
        name: "static-plugin",
        description: "Plugin with static tools",
        tools: { staticTool },
      });

      expect(plugin.name).toBe("static-plugin");
      expect(typeof plugin.tools).toBe("object");
      expect(plugin.tools).toHaveProperty("staticTool");
    });

    it("creates plugin with streaming-aware tools (function)", () => {
      const plugin = definePlugin({
        name: "streaming-plugin",
        description: "Plugin with streaming tools",
        tools: (ctx: StreamingContext) => ({
          streamingTool: tool({
            description: "A streaming tool",
            parameters: z.object({ data: z.string() }),
            execute: async ({ data }) => {
              // Write to stream if available
              if (ctx.writer) {
                ctx.writer.write({ type: "text", text: `Progress: ${data}` });
              }
              return { success: true, data };
            },
          }),
        }),
      });

      expect(plugin.name).toBe("streaming-plugin");
      expect(typeof plugin.tools).toBe("function");
    });

    it("function-based tools receive streaming context", () => {
      const toolFactory = vi.fn((ctx: StreamingContext) => ({
        testTool: tool({
          description: "Test tool",
          parameters: z.object({}),
          execute: async () => ({ writer: ctx.writer }),
        }),
      }));

      const plugin = definePlugin({
        name: "test-plugin",
        tools: toolFactory,
      });

      // Invoke the tools factory with a context
      const mockWriter = { write: vi.fn(), merge: vi.fn(), onError: undefined };
      const streamingContext: StreamingContext = { writer: mockWriter };
      const tools = (plugin.tools as (ctx: StreamingContext) => Record<string, unknown>)(
        streamingContext,
      );

      expect(toolFactory).toHaveBeenCalledWith(streamingContext);
      expect(tools).toHaveProperty("testTool");
    });
  });

  describe("Agent with streaming-aware plugins", () => {
    it("creates agent with static plugin tools", () => {
      const model = createMockModel();
      const plugin: AgentPlugin = {
        name: "static-plugin",
        tools: {
          myTool: tool({
            description: "My tool",
            parameters: z.object({ input: z.string() }),
            execute: async ({ input }) => input,
          }),
        },
      };

      const agent = createAgent({
        model,
        plugins: [plugin],
      });

      expect(agent).toBeDefined();
    });

    it("creates agent with streaming-aware plugin tools", () => {
      const model = createMockModel();
      const plugin: AgentPlugin = {
        name: "streaming-plugin",
        tools: (ctx: StreamingContext) => ({
          streamTool: tool({
            description: "Streaming tool",
            parameters: z.object({ data: z.string() }),
            execute: async ({ data }) => {
              ctx.writer?.write({ type: "text", text: data });
              return { success: true };
            },
          }),
        }),
      };

      const agent = createAgent({
        model,
        plugins: [plugin],
      });

      expect(agent).toBeDefined();
    });

    it("creates agent with mixed static and streaming plugins", () => {
      const model = createMockModel();

      const staticPlugin: AgentPlugin = {
        name: "static",
        tools: {
          staticTool: tool({
            description: "Static tool",
            parameters: z.object({}),
            execute: async () => "static",
          }),
        },
      };

      const streamingPlugin: AgentPlugin = {
        name: "streaming",
        tools: (ctx) => ({
          streamingTool: tool({
            description: "Streaming tool",
            parameters: z.object({}),
            execute: async () => {
              ctx.writer?.write({ type: "text", text: "streaming" });
              return "streaming";
            },
          }),
        }),
      };

      const agent = createAgent({
        model,
        plugins: [staticPlugin, streamingPlugin],
      });

      expect(agent).toBeDefined();
    });
  });

  describe("streamDataResponse", () => {
    beforeEach(() => {
      // Mock the streaming functions to return proper values
      const mockStream = new ReadableStream();
      vi.mocked(createUIMessageStream).mockReturnValue(mockStream);
      vi.mocked(createUIMessageStreamResponse).mockReturnValue(
        new Response("mock stream", {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    });

    it("returns a Response object", async () => {
      const model = createMockModel();
      const agent = createAgent({ model });

      // Mock streamText to return a proper result
      vi.mocked(streamText).mockReturnValue({
        toUIMessageStream: () => new ReadableStream(),
        text: Promise.resolve("test"),
        usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
        finishReason: Promise.resolve("stop"),
        steps: Promise.resolve([]),
        fullStream: (async function* () {
          yield { type: "text-delta" as const, text: "test", id: "1" };
        })(),
      } as ReturnType<typeof streamText>);

      const response = await agent.streamDataResponse({ prompt: "Hello" });

      expect(response).toBeInstanceOf(Response);
    });

    it("calls createUIMessageStream", async () => {
      const model = createMockModel();
      const agent = createAgent({ model });

      vi.mocked(streamText).mockReturnValue({
        toUIMessageStream: () => new ReadableStream(),
        text: Promise.resolve("test"),
        usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
        finishReason: Promise.resolve("stop"),
        steps: Promise.resolve([]),
        fullStream: (async function* () {
          yield { type: "text-delta" as const, text: "test", id: "1" };
        })(),
      } as ReturnType<typeof streamText>);

      await agent.streamDataResponse({ prompt: "Hello" });

      expect(createUIMessageStream).toHaveBeenCalled();
    });

    it("calls createUIMessageStreamResponse with the stream", async () => {
      const model = createMockModel();
      const agent = createAgent({ model });

      const mockStream = new ReadableStream();
      vi.mocked(createUIMessageStream).mockReturnValue(mockStream);

      vi.mocked(streamText).mockReturnValue({
        toUIMessageStream: () => new ReadableStream(),
        text: Promise.resolve("test"),
        usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
        finishReason: Promise.resolve("stop"),
        steps: Promise.resolve([]),
        fullStream: (async function* () {
          yield { type: "text-delta" as const, text: "test", id: "1" };
        })(),
      } as ReturnType<typeof streamText>);

      await agent.streamDataResponse({ prompt: "Test" });

      expect(createUIMessageStreamResponse).toHaveBeenCalledWith({
        stream: mockStream,
      });
    });

    it("passes the live writer to deferred function-based tools invoked via call_tool", async () => {
      const writer = {
        write: vi.fn(),
        merge: vi.fn(),
        onError: undefined,
      };

      vi.mocked(createUIMessageStream).mockImplementation(({ execute }) => {
        void execute({ writer });
        return new ReadableStream();
      });

      const plugin = definePlugin({
        name: "streaming-plugin",
        deferred: true,
        tools: (ctx: StreamingContext) => ({
          deferredWidget: tool({
            description: "Render a deferred widget",
            inputSchema: z.object({ data: z.string() }),
            execute: async ({ data }) => {
              ctx.writer?.write({ type: "text", text: `widget:${data}` });
              return `widget:${data}`;
            },
          }),
        }),
      });

      vi.mocked(streamText).mockImplementation((params) => {
        expect(params.tools).toHaveProperty("call_tool");
        expect(params.tools).not.toHaveProperty("deferredWidget");
        expect(params.tools).not.toHaveProperty("streaming-plugin__deferredWidget");

        const proxiedCall = params.tools.call_tool.execute!(
          {
            tool_name: "streaming-plugin__deferredWidget",
            arguments: { data: "hello" },
          },
          execOpts,
        );

        return {
          toUIMessageStream: () => new ReadableStream(),
          text: proxiedCall.then(() => "ok"),
          response: Promise.resolve({ messages: [] }),
          usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
          finishReason: Promise.resolve("stop"),
          steps: Promise.resolve([]),
          fullStream: (async function* () {
            yield { type: "text-delta" as const, text: "ok", id: "1" };
          })(),
        } as ReturnType<typeof streamText>;
      });

      const agent = createAgent({
        model: createMockModel(),
        plugins: [plugin],
      });

      await agent.streamDataResponse({ prompt: "Render the widget" });

      expect(writer.write).toHaveBeenCalledWith({ type: "text", text: "widget:hello" });
    });
  });

  describe("getActiveTools with streaming plugins", () => {
    it("includes static plugin tools", () => {
      const model = createMockModel();
      const plugin: AgentPlugin = {
        name: "static-plugin",
        tools: {
          myTool: tool({
            description: "My tool",
            parameters: z.object({}),
            execute: async () => "result",
          }),
        },
      };

      const agent = createAgent({
        model,
        plugins: [plugin],
        pluginLoading: "eager",
      });

      // Note: Static tools should be in getActiveTools
      const tools = agent.getActiveTools();
      // Static plugin tools are namespaced as <plugin>__<tool> when registered through MCPManager
      expect(tools).toBeDefined();
    });

    it("includes function-based plugin tools in the active tool set under their qualified names", () => {
      const model = createMockModel();
      const plugin: AgentPlugin = {
        name: "streaming-plugin",
        tools: (ctx) => ({
          streamingTool: tool({
            description: "Streaming tool",
            parameters: z.object({}),
            execute: async () => "stream",
          }),
        }),
      };

      const agent = createAgent({
        model,
        plugins: [plugin],
      });

      // Outside streaming responses these tools still exist, but run with a
      // null writer until a live streaming context is provided.
      const tools = agent.getActiveTools();
      expect(tools).not.toHaveProperty("streamingTool");
      expect(tools).toHaveProperty("streaming-plugin__streamingTool");
    });
  });
});

describe("definePlugin with streaming tools", () => {
  it("marks plugin with function-based tools correctly", () => {
    const plugin = definePlugin({
      name: "streaming-plugin",
      tools: (ctx) => ({
        tool1: tool({
          description: "Tool 1",
          parameters: z.object({}),
          execute: async () => "1",
        }),
      }),
    });

    // The tools property should be a function
    expect(typeof plugin.tools).toBe("function");
  });

  it("preserves static tools format", () => {
    const plugin = definePlugin({
      name: "static-plugin",
      tools: {
        tool1: tool({
          description: "Tool 1",
          parameters: z.object({}),
          execute: async () => "1",
        }),
      },
    });

    // The tools property should be an object
    expect(typeof plugin.tools).toBe("object");
    expect(plugin.tools).not.toBeInstanceOf(Function);
  });
});
