import { beforeEach, describe, expect, it } from "vitest";
import {
  // Assertions
  AgentAssertionError,
  assertAgentBehavior,
  assertFinishReason,
  assertHasOutput,
  assertHasUsage,
  assertMockAgentCallCount,
  assertMockAgentCalled,
  assertMockAgentCalledWith,
  assertResponseContains,
  assertResponseMatches,
  assertStateHasFile,
  assertStateHasTodo,
  assertStepCount,
  assertStreamFinished,
  assertStreamHasText,
  assertStreamTextContains,
  assertTodoCount,
  assertToolCallCount,
  assertToolCalled,
  assertToolCalledWith,
  assertToolNotCalled,
  assertUsageWithin,
  collectStreamChunks,
  // Mock Agent
  createMockAgent,
  createMockModel,
  createPlaybackAgent,
  createRecording,
  // Recording and Playback
  createRecordingAgent,
  filterRecording,
  getStreamText,
  mergeRecordings,
  parseRecording,
  type Recording,
} from "../src/testing/index.js";

// =============================================================================
// Mock Agent Tests
// =============================================================================

describe("createMockAgent", () => {
  it("creates a mock agent with default response", async () => {
    const agent = createMockAgent();

    const result = await agent.generate({ prompt: "Hello" });

    expect(result.text).toBe("Mock response");
    expect(result.finishReason).toBe("stop");
  });

  it("generates unique IDs for each mock agent", () => {
    const agent1 = createMockAgent();
    const agent2 = createMockAgent();
    const agent3 = createMockAgent();

    // All IDs should be unique
    expect(agent1.id).not.toBe(agent2.id);
    expect(agent2.id).not.toBe(agent3.id);
    expect(agent1.id).not.toBe(agent3.id);

    // All should follow the mock-agent-N pattern
    expect(agent1.id).toMatch(/^mock-agent-\d+$/);
    expect(agent2.id).toMatch(/^mock-agent-\d+$/);
    expect(agent3.id).toMatch(/^mock-agent-\d+$/);
  });

  it("allows custom ID to be specified", () => {
    const agent = createMockAgent({ id: "custom-id" });

    expect(agent.id).toBe("custom-id");
  });

  it("creates a mock agent with custom static response", async () => {
    const agent = createMockAgent({
      response: { text: "Custom response", finishReason: "length" },
    });

    const result = await agent.generate({ prompt: "Hello" });

    expect(result.text).toBe("Custom response");
    expect(result.finishReason).toBe("length");
  });

  it("tracks generate calls", async () => {
    const agent = createMockAgent();

    await agent.generate({ prompt: "First" });
    await agent.generate({ prompt: "Second" });

    expect(agent.generateCalls).toHaveLength(2);
    expect(agent.generateCalls[0].prompt).toBe("First");
    expect(agent.generateCalls[1].prompt).toBe("Second");
    expect(agent.getGenerateCallCount()).toBe(2);
  });

  it("tracks stream calls", async () => {
    const agent = createMockAgent();

    const chunks1 = [];
    for await (const chunk of agent.stream({ prompt: "Stream 1" })) {
      chunks1.push(chunk);
    }

    expect(agent.streamCalls).toHaveLength(1);
    expect(agent.streamCalls[0].prompt).toBe("Stream 1");
    expect(agent.getStreamCallCount()).toBe(1);
  });

  it("uses response handler for dynamic responses", async () => {
    const agent = createMockAgent({
      responseHandler: (opts) => ({
        text: `You said: ${opts.prompt}`,
      }),
    });

    const r1 = await agent.generate({ prompt: "Hello" });
    const r2 = await agent.generate({ prompt: "World" });

    expect(r1.text).toBe("You said: Hello");
    expect(r2.text).toBe("You said: World");
  });

  it("queues multiple responses", async () => {
    const agent = createMockAgent();
    agent.queueResponses({ text: "First" }, { text: "Second" }, { text: "Third" });

    const r1 = await agent.generate({ prompt: "1" });
    const r2 = await agent.generate({ prompt: "2" });
    const r3 = await agent.generate({ prompt: "3" });

    expect(r1.text).toBe("First");
    expect(r2.text).toBe("Second");
    expect(r3.text).toBe("Third");
  });

  it("falls back to static response when queue is empty", async () => {
    const agent = createMockAgent({
      response: { text: "Default" },
    });
    agent.queueResponses({ text: "Queued" });

    const r1 = await agent.generate({ prompt: "1" });
    const r2 = await agent.generate({ prompt: "2" });

    expect(r1.text).toBe("Queued");
    expect(r2.text).toBe("Default");
  });

  it("clears response queue", async () => {
    const agent = createMockAgent({
      response: { text: "Default" },
    });
    agent.queueResponses({ text: "Queued" });
    agent.clearQueue();

    const result = await agent.generate({ prompt: "Hi" });

    expect(result.text).toBe("Default");
  });

  it("resets call history", async () => {
    const agent = createMockAgent();
    await agent.generate({ prompt: "1" });
    await agent.generate({ prompt: "2" });

    agent.resetHistory();

    expect(agent.generateCalls).toHaveLength(0);
    expect(agent.streamCalls).toHaveLength(0);
  });

  it("sets response dynamically", async () => {
    const agent = createMockAgent();

    const r1 = await agent.generate({ prompt: "1" });
    agent.setResponse({ text: "New response" });
    const r2 = await agent.generate({ prompt: "2" });

    expect(r1.text).toBe("Mock response");
    expect(r2.text).toBe("New response");
  });

  it("sets response handler dynamically", async () => {
    const agent = createMockAgent();

    const r1 = await agent.generate({ prompt: "Hello" });
    agent.setResponseHandler((opts) => ({ text: `Echo: ${opts.prompt}` }));
    const r2 = await agent.generate({ prompt: "World" });

    expect(r1.text).toBe("Mock response");
    expect(r2.text).toBe("Echo: World");
  });

  it("throws error when response has error", async () => {
    const agent = createMockAgent({
      response: { text: "", error: new Error("API error") },
    });

    await expect(agent.generate({ prompt: "Hi" })).rejects.toThrow("API error");
  });

  it("respects delay in response", async () => {
    const agent = createMockAgent({
      response: { text: "Delayed", delay: 50 },
    });

    const start = Date.now();
    await agent.generate({ prompt: "Hi" });
    const duration = Date.now() - start;

    expect(duration).toBeGreaterThanOrEqual(45); // Allow some tolerance
  });

  it("streams with custom chunks", async () => {
    const agent = createMockAgent({
      response: {
        text: "Hello World",
        streamChunks: [
          { type: "text-delta", text: "Hello " },
          { type: "text-delta", text: "World" },
          { type: "finish", finishReason: "stop" },
        ],
      },
    });

    const chunks = await collectStreamChunks(agent.stream({ prompt: "Hi" }));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ type: "text-delta", text: "Hello " });
    expect(chunks[1]).toEqual({ type: "text-delta", text: "World" });
  });

  it("includes usage in response", async () => {
    const agent = createMockAgent({
      response: {
        text: "Response",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          inputTokenDetails: {},
          outputTokenDetails: {},
        },
      },
    });

    const result = await agent.generate({ prompt: "Hi" });

    expect(result.usage?.inputTokens).toBe(100);
    expect(result.usage?.outputTokens).toBe(50);
  });

  it("includes output in response", async () => {
    const agent = createMockAgent({
      response: {
        text: "Response",
        output: { name: "Test", value: 42 },
      },
    });

    const result = await agent.generate({ prompt: "Hi" });

    expect(result.output).toEqual({ name: "Test", value: 42 });
  });

  it("includes steps in response", async () => {
    const agent = createMockAgent({
      response: {
        text: "Response",
        steps: [
          {
            text: "Step 1",
            toolCalls: [{ toolCallId: "1", toolName: "test", input: { a: 1 } }],
            toolResults: [{ toolCallId: "1", toolName: "test", output: "result" }],
            finishReason: "tool-calls",
          },
        ],
      },
    });

    const result = await agent.generate({ prompt: "Hi" });

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].toolCalls).toHaveLength(1);
  });

  it("provides assertGenerateCalledWith", async () => {
    const agent = createMockAgent();
    await agent.generate({ prompt: "Hello", threadId: "t1" });

    agent.assertGenerateCalledWith({ prompt: "Hello" });
    agent.assertGenerateCalledWith({ threadId: "t1" });

    expect(() => agent.assertGenerateCalledWith({ prompt: "World" })).toThrow();
  });

  it("provides assertGenerateCallCount", async () => {
    const agent = createMockAgent();
    await agent.generate({ prompt: "1" });
    await agent.generate({ prompt: "2" });

    agent.assertGenerateCallCount(2);

    expect(() => agent.assertGenerateCallCount(3)).toThrow();
  });

  it("has initial state", async () => {
    const agent = createMockAgent({
      initialState: {
        todos: [
          { id: "1", content: "Test", status: "pending", createdAt: new Date().toISOString() },
        ],
        files: { "/test.txt": { content: ["Hello"], created_at: "", modified_at: "" } },
      },
    });

    expect(agent.state.todos).toHaveLength(1);
    expect(agent.state.files["/test.txt"]).toBeDefined();
  });

  it("returns streamResponse", async () => {
    const agent = createMockAgent({
      response: { text: "Response text" },
    });

    const response = await agent.streamResponse({ prompt: "Hi" });

    expect(response).toBeInstanceOf(Response);
    const text = await response.text();
    expect(text).toBe("Response text");
  });

  it("returns streamRaw", async () => {
    const agent = createMockAgent({
      response: { text: "Raw response" },
    });

    const result = await agent.streamRaw({ prompt: "Hi" });

    const text = await result.text;
    expect(text).toBe("Raw response");
  });
});

describe("createMockModel", () => {
  it("creates a mock model", () => {
    const model = createMockModel();

    expect(model.specificationVersion).toBe("v3");
    expect(model.provider).toBe("mock");
    expect(model.modelId).toBe("mock-model");
  });

  it("accepts custom configuration", () => {
    const model = createMockModel({
      text: "Custom",
      provider: "test-provider",
      modelId: "test-model",
    });

    expect(model.provider).toBe("test-provider");
    expect(model.modelId).toBe("test-model");
  });
});

// =============================================================================
// Recording and Playback Tests
// =============================================================================

describe("createRecordingAgent", () => {
  it("records generate calls", async () => {
    const mockAgent = createMockAgent({
      response: { text: "Recorded response" },
    });

    const recordingAgent = createRecordingAgent(mockAgent, {
      description: "Test recording",
    });

    await recordingAgent.generate({ prompt: "Hello" });
    await recordingAgent.generate({ prompt: "World" });

    const recording = recordingAgent.getRecording();

    expect(recording.interactions).toHaveLength(2);
    expect(recording.interactions[0].request.prompt).toBe("Hello");
    expect(recording.interactions[0].response.text).toBe("Recorded response");
    expect(recording.interactions[1].request.prompt).toBe("World");
    expect(recording.description).toBe("Test recording");
  });

  it("records stream calls", async () => {
    const mockAgent = createMockAgent({
      response: {
        text: "Streamed",
        streamChunks: [
          { type: "text-delta", text: "Streamed" },
          { type: "finish", finishReason: "stop" },
        ],
      },
    });

    const recordingAgent = createRecordingAgent(mockAgent);

    const chunks = [];
    for await (const chunk of recordingAgent.stream({ prompt: "Test" })) {
      chunks.push(chunk);
    }

    const recording = recordingAgent.getRecording();

    expect(recording.interactions).toHaveLength(1);
    expect(recording.interactions[0].method).toBe("stream");
    expect(recording.interactions[0].response.text).toBe("Streamed");
  });

  it("records errors", async () => {
    const mockAgent = createMockAgent({
      response: { text: "", error: new Error("Test error") },
    });

    const recordingAgent = createRecordingAgent(mockAgent);

    await expect(recordingAgent.generate({ prompt: "Fail" })).rejects.toThrow();

    const recording = recordingAgent.getRecording();

    expect(recording.interactions).toHaveLength(1);
    expect(recording.interactions[0].error).toBeDefined();
    expect(recording.interactions[0].error?.message).toBe("Test error");
  });

  it("exports recording as JSON", async () => {
    const mockAgent = createMockAgent();
    const recordingAgent = createRecordingAgent(mockAgent);

    await recordingAgent.generate({ prompt: "Test" });

    const json = recordingAgent.exportRecording();
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe("1.0.0");
    expect(parsed.interactions).toHaveLength(1);
  });

  it("clears recording", async () => {
    const mockAgent = createMockAgent();
    const recordingAgent = createRecordingAgent(mockAgent);

    await recordingAgent.generate({ prompt: "Test" });
    recordingAgent.clearRecording();

    const recording = recordingAgent.getRecording();

    expect(recording.interactions).toHaveLength(0);
  });

  it("records duration", async () => {
    const mockAgent = createMockAgent({
      response: { text: "Response", delay: 50 },
    });

    const recordingAgent = createRecordingAgent(mockAgent);
    await recordingAgent.generate({ prompt: "Test" });

    const recording = recordingAgent.getRecording();

    expect(recording.interactions[0].duration).toBeGreaterThanOrEqual(45);
  });
});

describe("createPlaybackAgent", () => {
  let recording: Recording;

  beforeEach(() => {
    recording = createRecording([
      {
        request: { prompt: "Hello" },
        response: { text: "Hi there!", finishReason: "stop" },
      },
      {
        request: { prompt: "How are you?" },
        response: { text: "I'm good!", finishReason: "stop" },
      },
      {
        request: { prompt: "Goodbye" },
        response: { text: "See you!", finishReason: "stop" },
      },
    ]);
  });

  it("plays back in sequence mode", async () => {
    const agent = createPlaybackAgent({
      recording,
      matchMode: "sequence",
    });

    const r1 = await agent.generate({ prompt: "Any" });
    const r2 = await agent.generate({ prompt: "Prompt" });
    const r3 = await agent.generate({ prompt: "Works" });

    expect(r1.text).toBe("Hi there!");
    expect(r2.text).toBe("I'm good!");
    expect(r3.text).toBe("See you!");
    expect(agent.isComplete()).toBe(true);
  });

  it("plays back in prompt match mode", async () => {
    const agent = createPlaybackAgent({
      recording,
      matchMode: "prompt",
    });

    const r1 = await agent.generate({ prompt: "How are you?" });
    const r2 = await agent.generate({ prompt: "Hello" });

    expect(r1.text).toBe("I'm good!");
    expect(r2.text).toBe("Hi there!");
  });

  it("plays back in fuzzy match mode", async () => {
    const agent = createPlaybackAgent({
      recording,
      matchMode: "fuzzy",
    });

    const r1 = await agent.generate({ prompt: "hello there" });

    expect(r1.text).toBe("Hi there!");
  });

  it("throws in strict mode when no match", async () => {
    const agent = createPlaybackAgent({
      recording,
      matchMode: "prompt",
      strict: true,
    });

    await expect(agent.generate({ prompt: "Unmatched prompt" })).rejects.toThrow(
      "No matching recording",
    );
  });

  it("returns fallback in non-strict mode", async () => {
    const agent = createPlaybackAgent({
      recording,
      matchMode: "prompt",
      strict: false,
    });

    const result = await agent.generate({ prompt: "Unmatched" });

    expect(result.text).toBe("No recording found");
  });

  it("tracks playback position", async () => {
    const agent = createPlaybackAgent({ recording });

    expect(agent.getPlaybackPosition()).toBe(0);
    expect(agent.getRemainingCount()).toBe(3);

    await agent.generate({ prompt: "1" });

    expect(agent.getPlaybackPosition()).toBe(1);
    expect(agent.getRemainingCount()).toBe(2);
  });

  it("resets playback", async () => {
    const agent = createPlaybackAgent({ recording });

    await agent.generate({ prompt: "1" });
    await agent.generate({ prompt: "2" });

    agent.resetPlayback();

    expect(agent.getPlaybackPosition()).toBe(0);
    expect(agent.getRemainingCount()).toBe(3);

    const result = await agent.generate({ prompt: "x" });
    expect(result.text).toBe("Hi there!");
  });

  it("replays errors", async () => {
    const errorRecording = createRecording([
      {
        request: { prompt: "Fail" },
        response: { text: "", finishReason: "error" },
        error: { name: "Error", message: "Recorded error" },
      },
    ]);

    const agent = createPlaybackAgent({ recording: errorRecording });

    await expect(agent.generate({ prompt: "Fail" })).rejects.toThrow("Recorded error");
  });
});

describe("parseRecording", () => {
  it("parses JSON string", () => {
    const json = JSON.stringify({
      version: "1.0.0",
      createdAt: "2024-01-01T00:00:00.000Z",
      interactions: [],
    });

    const recording = parseRecording(json);

    expect(recording.version).toBe("1.0.0");
    expect(recording.interactions).toEqual([]);
  });

  it("accepts object directly", () => {
    const obj = {
      version: "1.0.0",
      createdAt: "2024-01-01T00:00:00.000Z",
      interactions: [],
    };

    const recording = parseRecording(obj);

    expect(recording.version).toBe("1.0.0");
  });

  it("throws on invalid format", () => {
    expect(() => parseRecording({ invalid: true })).toThrow("Invalid recording format");
  });
});

describe("mergeRecordings", () => {
  it("merges multiple recordings", () => {
    const r1 = createRecording([
      { request: { prompt: "A" }, response: { text: "1", finishReason: "stop" } },
    ]);
    const r2 = createRecording([
      { request: { prompt: "B" }, response: { text: "2", finishReason: "stop" } },
    ]);

    const merged = mergeRecordings([r1, r2]);

    expect(merged.interactions).toHaveLength(2);
  });

  it("combines tags", () => {
    const r1 = createRecording([], { tags: ["auth"] });
    const r2 = createRecording([], { tags: ["user"] });

    const merged = mergeRecordings([r1, r2]);

    expect(merged.tags).toContain("auth");
    expect(merged.tags).toContain("user");
  });
});

describe("filterRecording", () => {
  it("filters by predicate", () => {
    const recording = createRecording([
      { request: { prompt: "A" }, response: { text: "1", finishReason: "stop" } },
      {
        request: { prompt: "B" },
        response: { text: "2", finishReason: "stop" },
        error: { name: "Error", message: "Failed" },
      },
      { request: { prompt: "C" }, response: { text: "3", finishReason: "stop" } },
    ]);

    const filtered = filterRecording(recording, (i) => !i.error);

    expect(filtered.interactions).toHaveLength(2);
    expect(filtered.interactions[0].request.prompt).toBe("A");
    expect(filtered.interactions[1].request.prompt).toBe("C");
  });
});

describe("createRecording", () => {
  it("creates recording from interactions", () => {
    const recording = createRecording(
      [{ request: { prompt: "Hello" }, response: { text: "Hi", finishReason: "stop" } }],
      {
        description: "Test",
        tags: ["unit"],
      },
    );

    expect(recording.version).toBe("1.0.0");
    expect(recording.description).toBe("Test");
    expect(recording.tags).toContain("unit");
    expect(recording.interactions).toHaveLength(1);
    expect(recording.interactions[0].method).toBe("generate");
  });
});

// =============================================================================
// Assertion Tests
// =============================================================================

describe("AgentAssertionError", () => {
  it("stores expected and actual values", () => {
    const error = new AgentAssertionError("Test", "expected", "actual", { key: "value" });

    expect(error.message).toBe("Test");
    expect(error.expected).toBe("expected");
    expect(error.actual).toBe("actual");
    expect(error.context).toEqual({ key: "value" });
  });
});

describe("assertResponseContains", () => {
  it("passes when text is found", () => {
    const result = { text: "Hello world", finishReason: "stop", steps: [] } as const;

    expect(() => assertResponseContains(result, "world")).not.toThrow();
    expect(() => assertResponseContains(result, "Hello")).not.toThrow();
  });

  it("is case insensitive", () => {
    const result = { text: "Hello WORLD", finishReason: "stop", steps: [] } as const;

    expect(() => assertResponseContains(result, "world")).not.toThrow();
  });

  it("throws when text not found", () => {
    const result = { text: "Hello", finishReason: "stop", steps: [] } as const;

    expect(() => assertResponseContains(result, "world")).toThrow(AgentAssertionError);
  });
});

describe("assertResponseMatches", () => {
  it("passes when pattern matches", () => {
    const result = { text: "The answer is 42", finishReason: "stop", steps: [] } as const;

    expect(() => assertResponseMatches(result, /\d+/)).not.toThrow();
    expect(() => assertResponseMatches(result, /answer.*42/)).not.toThrow();
  });

  it("throws when pattern doesn't match", () => {
    const result = { text: "No numbers here", finishReason: "stop", steps: [] } as const;

    expect(() => assertResponseMatches(result, /\d+/)).toThrow(AgentAssertionError);
  });
});

describe("assertFinishReason", () => {
  it("passes when reason matches", () => {
    const result = { text: "Done", finishReason: "stop", steps: [] } as const;

    expect(() => assertFinishReason(result, "stop")).not.toThrow();
  });

  it("throws when reason differs", () => {
    const result = { text: "Done", finishReason: "length", steps: [] } as const;

    expect(() => assertFinishReason(result, "stop")).toThrow(AgentAssertionError);
  });
});

describe("assertHasUsage", () => {
  it("passes when usage is present", () => {
    const result = {
      text: "Response",
      finishReason: "stop",
      steps: [],
      usage: { inputTokens: 10, outputTokens: 20, inputTokenDetails: {}, outputTokenDetails: {} },
    } as const;

    expect(() => assertHasUsage(result)).not.toThrow();
  });

  it("throws when usage is missing", () => {
    const result = { text: "Response", finishReason: "stop", steps: [] } as const;

    expect(() => assertHasUsage(result)).toThrow(AgentAssertionError);
  });
});

describe("assertUsageWithin", () => {
  const result = {
    text: "Response",
    finishReason: "stop" as const,
    steps: [],
    usage: { inputTokens: 50, outputTokens: 25, inputTokenDetails: {}, outputTokenDetails: {} },
  };

  it("passes when within bounds", () => {
    expect(() =>
      assertUsageWithin(result, { minInputTokens: 40, maxInputTokens: 60 }),
    ).not.toThrow();
    expect(() =>
      assertUsageWithin(result, { minOutputTokens: 20, maxOutputTokens: 30 }),
    ).not.toThrow();
  });

  it("throws when below minimum", () => {
    expect(() => assertUsageWithin(result, { minInputTokens: 100 })).toThrow();
    expect(() => assertUsageWithin(result, { minOutputTokens: 50 })).toThrow();
  });

  it("throws when above maximum", () => {
    expect(() => assertUsageWithin(result, { maxInputTokens: 40 })).toThrow();
    expect(() => assertUsageWithin(result, { maxOutputTokens: 20 })).toThrow();
  });
});

describe("assertHasOutput", () => {
  it("passes when output is present", () => {
    const result = {
      text: "Response",
      finishReason: "stop",
      steps: [],
      output: { data: "value" },
    } as const;

    expect(() => assertHasOutput(result)).not.toThrow();
  });

  it("throws when output is undefined", () => {
    const result = { text: "Response", finishReason: "stop", steps: [] } as const;

    expect(() => assertHasOutput(result)).toThrow(AgentAssertionError);
  });
});

describe("assertToolCalled", () => {
  const result = {
    text: "Response",
    finishReason: "stop" as const,
    steps: [
      {
        text: "",
        toolCalls: [
          { toolCallId: "1", toolName: "search", input: { query: "test" } },
          { toolCallId: "2", toolName: "weather", input: { city: "Tokyo" } },
        ],
        toolResults: [],
        finishReason: "tool-calls" as const,
      },
    ],
  };

  it("returns tool call when found", () => {
    const call = assertToolCalled(result, "search");

    expect(call.toolName).toBe("search");
    expect(call.input).toEqual({ query: "test" });
  });

  it("throws when tool not called", () => {
    expect(() => assertToolCalled(result, "unknown")).toThrow(AgentAssertionError);
  });
});

describe("assertToolCalledWith", () => {
  const result = {
    text: "Response",
    finishReason: "stop" as const,
    steps: [
      {
        text: "",
        toolCalls: [{ toolCallId: "1", toolName: "search", input: { query: "test", limit: 10 } }],
        toolResults: [],
        finishReason: "tool-calls" as const,
      },
    ],
  };

  it("returns tool call when input matches", () => {
    const call = assertToolCalledWith(result, "search", { query: "test" });

    expect(call.toolName).toBe("search");
  });

  it("throws when input doesn't match", () => {
    expect(() => assertToolCalledWith(result, "search", { query: "other" })).toThrow(
      AgentAssertionError,
    );
  });
});

describe("assertToolNotCalled", () => {
  const result = {
    text: "Response",
    finishReason: "stop" as const,
    steps: [
      {
        text: "",
        toolCalls: [{ toolCallId: "1", toolName: "search", input: {} }],
        toolResults: [],
        finishReason: "tool-calls" as const,
      },
    ],
  };

  it("passes when tool not called", () => {
    expect(() => assertToolNotCalled(result, "weather")).not.toThrow();
  });

  it("throws when tool was called", () => {
    expect(() => assertToolNotCalled(result, "search")).toThrow(AgentAssertionError);
  });
});

describe("assertToolCallCount", () => {
  const result = {
    text: "Response",
    finishReason: "stop" as const,
    steps: [
      {
        text: "",
        toolCalls: [
          { toolCallId: "1", toolName: "search", input: {} },
          { toolCallId: "2", toolName: "search", input: {} },
          { toolCallId: "3", toolName: "other", input: {} },
        ],
        toolResults: [],
        finishReason: "tool-calls" as const,
      },
    ],
  };

  it("passes when count matches", () => {
    expect(() => assertToolCallCount(result, "search", 2)).not.toThrow();
    expect(() => assertToolCallCount(result, "other", 1)).not.toThrow();
    expect(() => assertToolCallCount(result, "missing", 0)).not.toThrow();
  });

  it("throws when count differs", () => {
    expect(() => assertToolCallCount(result, "search", 3)).toThrow(AgentAssertionError);
  });
});

describe("assertStepCount", () => {
  const result = {
    text: "Response",
    finishReason: "stop" as const,
    steps: [
      { text: "", toolCalls: [], toolResults: [], finishReason: "stop" as const },
      { text: "", toolCalls: [], toolResults: [], finishReason: "stop" as const },
      { text: "", toolCalls: [], toolResults: [], finishReason: "stop" as const },
    ],
  };

  it("passes when within bounds", () => {
    expect(() => assertStepCount(result, 2, 5)).not.toThrow();
    expect(() => assertStepCount(result, 3)).not.toThrow();
  });

  it("throws when below minimum", () => {
    expect(() => assertStepCount(result, 5)).toThrow(AgentAssertionError);
  });

  it("throws when above maximum", () => {
    expect(() => assertStepCount(result, 1, 2)).toThrow(AgentAssertionError);
  });
});

describe("stream assertions", () => {
  const createChunks = () => [
    { type: "text-delta" as const, text: "Hello " },
    { type: "text-delta" as const, text: "World" },
    { type: "finish" as const, finishReason: "stop" as const },
  ];

  describe("collectStreamChunks", () => {
    it("collects all chunks", async () => {
      async function* generateChunks() {
        yield { type: "text-delta" as const, text: "Test" };
        yield { type: "finish" as const, finishReason: "stop" as const };
      }

      const chunks = await collectStreamChunks(generateChunks());

      expect(chunks).toHaveLength(2);
    });
  });

  describe("assertStreamHasText", () => {
    it("passes when text chunks exist", () => {
      expect(() => assertStreamHasText(createChunks())).not.toThrow();
    });

    it("throws when no text chunks", () => {
      const chunks = [{ type: "finish" as const, finishReason: "stop" as const }];

      expect(() => assertStreamHasText(chunks)).toThrow(AgentAssertionError);
    });
  });

  describe("assertStreamFinished", () => {
    it("passes when finish chunk exists", () => {
      expect(() => assertStreamFinished(createChunks())).not.toThrow();
    });

    it("checks finish reason", () => {
      expect(() => assertStreamFinished(createChunks(), "stop")).not.toThrow();
      expect(() => assertStreamFinished(createChunks(), "length")).toThrow();
    });

    it("throws when no finish chunk", () => {
      const chunks = [{ type: "text-delta" as const, text: "Test" }];

      expect(() => assertStreamFinished(chunks)).toThrow(AgentAssertionError);
    });
  });

  describe("getStreamText", () => {
    it("combines text chunks", () => {
      const text = getStreamText(createChunks());

      expect(text).toBe("Hello World");
    });
  });

  describe("assertStreamTextContains", () => {
    it("passes when text found", () => {
      expect(() => assertStreamTextContains(createChunks(), "World")).not.toThrow();
    });

    it("throws when text not found", () => {
      expect(() => assertStreamTextContains(createChunks(), "Missing")).toThrow(
        AgentAssertionError,
      );
    });
  });
});

describe("state assertions", () => {
  describe("assertStateHasFile", () => {
    it("passes when file exists", () => {
      const state = {
        todos: [],
        files: { "/test.txt": { content: ["Hello"], created_at: "", modified_at: "" } },
      };

      expect(() => assertStateHasFile(state, "/test.txt")).not.toThrow();
    });

    it("throws when file missing", () => {
      const state = { todos: [], files: {} };

      expect(() => assertStateHasFile(state, "/missing.txt")).toThrow(AgentAssertionError);
    });
  });

  describe("assertStateHasTodo", () => {
    const state = {
      todos: [
        { id: "1", content: "Fix bug", status: "completed" as const, createdAt: "" },
        { id: "2", content: "Write tests", status: "pending" as const, createdAt: "" },
      ],
      files: {},
    };

    it("finds by content string", () => {
      const todo = assertStateHasTodo(state, "bug");

      expect(todo.id).toBe("1");
    });

    it("finds by partial match", () => {
      const todo = assertStateHasTodo(state, { status: "pending" });

      expect(todo.id).toBe("2");
    });

    it("throws when not found", () => {
      expect(() => assertStateHasTodo(state, "Unknown")).toThrow(AgentAssertionError);
    });
  });

  describe("assertTodoCount", () => {
    const state = {
      todos: [
        { id: "1", content: "Todo 1", status: "completed" as const, createdAt: "" },
        { id: "2", content: "Todo 2", status: "pending" as const, createdAt: "" },
        { id: "3", content: "Todo 3", status: "pending" as const, createdAt: "" },
      ],
      files: {},
    };

    it("counts all todos", () => {
      expect(() => assertTodoCount(state, 3)).not.toThrow();
    });

    it("counts by status", () => {
      expect(() => assertTodoCount(state, 2, "pending")).not.toThrow();
      expect(() => assertTodoCount(state, 1, "completed")).not.toThrow();
    });

    it("throws when count differs", () => {
      expect(() => assertTodoCount(state, 5)).toThrow(AgentAssertionError);
    });
  });
});

describe("mock agent assertions", () => {
  let agent: ReturnType<typeof createMockAgent>;

  beforeEach(() => {
    agent = createMockAgent();
  });

  describe("assertMockAgentCalled", () => {
    it("passes when called", async () => {
      await agent.generate({ prompt: "Test" });

      expect(() => assertMockAgentCalled(agent)).not.toThrow();
    });

    it("throws when not called", () => {
      expect(() => assertMockAgentCalled(agent)).toThrow(AgentAssertionError);
    });
  });

  describe("assertMockAgentCallCount", () => {
    it("passes when count matches", async () => {
      await agent.generate({ prompt: "1" });
      await agent.generate({ prompt: "2" });

      expect(() => assertMockAgentCallCount(agent, 2)).not.toThrow();
    });

    it("throws when count differs", async () => {
      await agent.generate({ prompt: "1" });

      expect(() => assertMockAgentCallCount(agent, 2)).toThrow(AgentAssertionError);
    });
  });

  describe("assertMockAgentCalledWith", () => {
    it("passes when options match", async () => {
      await agent.generate({ prompt: "Hello", threadId: "t1" });

      expect(() => assertMockAgentCalledWith(agent, { prompt: "Hello" })).not.toThrow();
    });

    it("throws when options don't match", async () => {
      await agent.generate({ prompt: "Hello" });

      expect(() => assertMockAgentCalledWith(agent, { prompt: "World" })).toThrow(
        AgentAssertionError,
      );
    });
  });
});

describe("assertAgentBehavior", () => {
  it("checks multiple conditions", () => {
    const result = {
      text: "Hello World",
      finishReason: "stop" as const,
      usage: { inputTokens: 50, outputTokens: 20, inputTokenDetails: {}, outputTokenDetails: {} },
      output: { key: "value" },
      steps: [
        {
          text: "",
          toolCalls: [{ toolCallId: "1", toolName: "search", input: {} }],
          toolResults: [],
          finishReason: "tool-calls" as const,
        },
        {
          text: "Hello World",
          toolCalls: [],
          toolResults: [],
          finishReason: "stop" as const,
        },
      ],
    };

    expect(() =>
      assertAgentBehavior(result, {
        responseContains: ["Hello", "World"],
        finishReason: "stop",
        toolsCalled: ["search"],
        toolsNotCalled: ["weather"],
        minSteps: 1,
        maxSteps: 5,
        hasUsage: true,
        hasOutput: true,
      }),
    ).not.toThrow();
  });

  it("throws on first failed condition", () => {
    const result = {
      text: "Hello",
      finishReason: "stop" as const,
      steps: [],
    };

    expect(() =>
      assertAgentBehavior(result, {
        responseContains: "World",
      }),
    ).toThrow(AgentAssertionError);
  });
});
