/**
 * Testing utilities for the Agent SDK.
 *
 * This module provides comprehensive testing support including:
 * - Mock agents with configurable responses
 * - Recording and playback of agent interactions
 * - Assertion helpers for common test scenarios
 *
 * ## Installation
 *
 * The testing utilities are included in the main package:
 *
 * ```typescript
 * import {
 *   createMockAgent,
 *   createPlaybackAgent,
 *   assertResponseContains,
 * } from "@lleverage-ai/agent-sdk/testing";
 * ```
 *
 * ## Integration Test Patterns
 *
 * ### Pattern 1: Mock Agent for Unit Tests
 *
 * Use mock agents when testing code that depends on agent behavior:
 *
 * ```typescript
 * import { createMockAgent, assertAgentBehavior } from "@lleverage-ai/agent-sdk/testing";
 *
 * describe("UserAssistant", () => {
 *   it("handles greeting", async () => {
 *     const agent = createMockAgent({
 *       response: { text: "Hello! How can I help?" },
 *     });
 *
 *     const assistant = new UserAssistant(agent);
 *     const response = await assistant.greet();
 *
 *     expect(response).toContain("Hello");
 *     expect(agent.generateCalls).toHaveLength(1);
 *   });
 *
 *   it("handles multiple interactions", async () => {
 *     const agent = createMockAgent();
 *     agent.queueResponses(
 *       { text: "First response" },
 *       { text: "Second response" },
 *       { text: "Third response" },
 *     );
 *
 *     const results = await Promise.all([
 *       assistant.query("1"),
 *       assistant.query("2"),
 *       assistant.query("3"),
 *     ]);
 *
 *     expect(results[0]).toContain("First");
 *     expect(agent.getGenerateCallCount()).toBe(3);
 *   });
 * });
 * ```
 *
 * ### Pattern 2: Dynamic Responses Based on Input
 *
 * Use response handlers for context-aware mocking:
 *
 * ```typescript
 * const agent = createMockAgent({
 *   responseHandler: (opts) => {
 *     if (opts.prompt?.includes("weather")) {
 *       return { text: "The weather is sunny!" };
 *     }
 *     if (opts.prompt?.includes("time")) {
 *       return { text: "The time is 3:00 PM." };
 *     }
 *     return { text: "I don't understand." };
 *   },
 * });
 *
 * const r1 = await agent.generate({ prompt: "What's the weather?" });
 * expect(r1.text).toContain("sunny");
 *
 * const r2 = await agent.generate({ prompt: "What's the time?" });
 * expect(r2.text).toContain("3:00 PM");
 * ```
 *
 * ### Pattern 3: Recording Real Interactions
 *
 * Record interactions from a real agent for later playback:
 *
 * ```typescript
 * import { createRecordingAgent } from "@lleverage-ai/agent-sdk/testing";
 * import { createAgent } from "@lleverage-ai/agent-sdk";
 * import fs from "fs";
 *
 * // Create recording agent wrapping a real agent
 * const realAgent = createAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   systemPrompt: "You are a helpful assistant.",
 * });
 *
 * const recordingAgent = createRecordingAgent(realAgent, {
 *   description: "User onboarding flow",
 *   tags: ["onboarding", "regression"],
 * });
 *
 * // Make real API calls
 * await recordingAgent.generate({ prompt: "Hello" });
 * await recordingAgent.generate({ prompt: "What can you do?" });
 * await recordingAgent.generate({ prompt: "Help me get started" });
 *
 * // Save recording for future tests
 * const recording = recordingAgent.exportRecording();
 * fs.writeFileSync("fixtures/onboarding.json", recording);
 * ```
 *
 * ### Pattern 4: Playback for Regression Tests
 *
 * Replay recorded interactions for deterministic tests:
 *
 * ```typescript
 * import { createPlaybackAgent, parseRecording } from "@lleverage-ai/agent-sdk/testing";
 * import onboardingFixture from "./fixtures/onboarding.json";
 *
 * describe("Onboarding Flow", () => {
 *   let agent;
 *
 *   beforeEach(() => {
 *     agent = createPlaybackAgent({
 *       recording: parseRecording(onboardingFixture),
 *       matchMode: "sequence",
 *     });
 *   });
 *
 *   it("handles the complete onboarding flow", async () => {
 *     const r1 = await agent.generate({ prompt: "Hello" });
 *     const r2 = await agent.generate({ prompt: "What can you do?" });
 *     const r3 = await agent.generate({ prompt: "Help me get started" });
 *
 *     expect(agent.isComplete()).toBe(true);
 *     expect(r1.text).toBeDefined();
 *     expect(r2.text).toBeDefined();
 *     expect(r3.text).toBeDefined();
 *   });
 * });
 * ```
 *
 * ### Pattern 5: Testing Tool Calls
 *
 * Verify that agents use tools correctly:
 *
 * ```typescript
 * import {
 *   createMockAgent,
 *   assertToolCalled,
 *   assertToolCalledWith,
 *   assertToolNotCalled,
 * } from "@lleverage-ai/agent-sdk/testing";
 *
 * it("uses the search tool for queries", async () => {
 *   const agent = createMockAgent({
 *     response: {
 *       text: "Found results for Tokyo",
 *       steps: [{
 *         text: "",
 *         toolCalls: [{
 *           toolCallId: "call-1",
 *           toolName: "search",
 *           input: { query: "Tokyo weather" },
 *         }],
 *         toolResults: [{
 *           toolCallId: "call-1",
 *           toolName: "search",
 *           output: "Tokyo: 25°C, sunny",
 *         }],
 *         finishReason: "tool-calls",
 *       }],
 *     },
 *   });
 *
 *   const result = await agent.generate({ prompt: "Weather in Tokyo?" });
 *
 *   assertToolCalled(result, "search");
 *   assertToolCalledWith(result, "search", { query: "Tokyo weather" });
 *   assertToolNotCalled(result, "dangerousTool");
 * });
 * ```
 *
 * ### Pattern 6: Testing State Changes
 *
 * Verify agent state modifications:
 *
 * ```typescript
 * import {
 *   createMockAgent,
 *   assertStateHasFile,
 *   assertStateHasTodo,
 *   assertTodoCount,
 * } from "@lleverage-ai/agent-sdk/testing";
 *
 * it("tracks todos correctly", async () => {
 *   const agent = createMockAgent({
 *     initialState: {
 *       todos: [
 *         { id: "1", content: "Fix bug", status: "pending", createdAt: new Date().toISOString() },
 *       ],
 *     },
 *   });
 *
 *   // Simulate agent modifying state
 *   agent.state.todos[0].status = "completed";
 *   agent.state.todos.push({
 *     id: "2",
 *     content: "Write tests",
 *     status: "pending",
 *     createdAt: new Date().toISOString(),
 *   });
 *
 *   assertTodoCount(agent.state, 2);
 *   assertTodoCount(agent.state, 1, "completed");
 *   assertStateHasTodo(agent.state, { content: "Fix bug", status: "completed" });
 * });
 * ```
 *
 * ### Pattern 7: Testing Streaming
 *
 * Test streaming responses:
 *
 * ```typescript
 * import {
 *   createMockAgent,
 *   collectStreamChunks,
 *   assertStreamHasText,
 *   assertStreamFinished,
 *   getStreamText,
 * } from "@lleverage-ai/agent-sdk/testing";
 *
 * it("streams response correctly", async () => {
 *   const agent = createMockAgent({
 *     response: {
 *       text: "Hello world",
 *       streamChunks: [
 *         { type: "text-delta", text: "Hello " },
 *         { type: "text-delta", text: "world" },
 *         { type: "finish", finishReason: "stop" },
 *       ],
 *     },
 *   });
 *
 *   const stream = agent.stream({ prompt: "Say hello" });
 *   const chunks = await collectStreamChunks(stream);
 *
 *   assertStreamHasText(chunks);
 *   assertStreamFinished(chunks, "stop");
 *
 *   const text = getStreamText(chunks);
 *   expect(text).toBe("Hello world");
 * });
 * ```
 *
 * ### Pattern 8: Error Simulation
 *
 * Test error handling:
 *
 * ```typescript
 * import { createMockAgent } from "@lleverage-ai/agent-sdk/testing";
 *
 * it("handles API errors gracefully", async () => {
 *   const agent = createMockAgent({
 *     response: {
 *       text: "",
 *       error: new Error("API rate limit exceeded"),
 *     },
 *   });
 *
 *   await expect(agent.generate({ prompt: "Hi" })).rejects.toThrow("rate limit");
 * });
 *
 * it("retries on transient errors", async () => {
 *   const agent = createMockAgent();
 *   agent.queueResponses(
 *     { text: "", error: new Error("Temporary failure") },
 *     { text: "", error: new Error("Temporary failure") },
 *     { text: "Success!" },
 *   );
 *
 *   // Your retry logic would call generate multiple times
 *   let result;
 *   for (let i = 0; i < 3; i++) {
 *     try {
 *       result = await agent.generate({ prompt: "Hi" });
 *       break;
 *     } catch {
 *       // Continue retrying
 *     }
 *   }
 *
 *   expect(result?.text).toBe("Success!");
 * });
 * ```
 *
 * ### Pattern 9: Composite Assertions
 *
 * Use assertAgentBehavior for comprehensive checks:
 *
 * ```typescript
 * import { createMockAgent, assertAgentBehavior } from "@lleverage-ai/agent-sdk/testing";
 *
 * it("behaves correctly for weather query", async () => {
 *   const agent = createMockAgent({
 *     response: {
 *       text: "The weather in Tokyo is sunny and 25°C.",
 *       finishReason: "stop",
 *       usage: { inputTokens: 50, outputTokens: 20 },
 *       steps: [{
 *         text: "",
 *         toolCalls: [{ toolCallId: "1", toolName: "weather", input: { city: "Tokyo" } }],
 *         toolResults: [{ toolCallId: "1", toolName: "weather", output: "25°C sunny" }],
 *         finishReason: "tool-calls",
 *       }],
 *     },
 *   });
 *
 *   const result = await agent.generate({ prompt: "Weather in Tokyo?" });
 *
 *   assertAgentBehavior(result, {
 *     responseContains: ["Tokyo", "sunny"],
 *     finishReason: "stop",
 *     toolsCalled: ["weather"],
 *     toolsNotCalled: ["search", "calculator"],
 *     minSteps: 1,
 *     hasUsage: true,
 *   });
 * });
 * ```
 *
 * @packageDocumentation
 * @module testing
 */

// Assertions
export {
  // Error class
  AgentAssertionError,
  type AgentBehaviorOptions,
  // Composite assertions
  assertAgentBehavior,
  assertFinishReason,
  assertHasOutput,
  assertHasUsage,
  assertMockAgentCallCount,
  // Mock agent assertions
  assertMockAgentCalled,
  assertMockAgentCalledWith,
  // Response assertions
  assertResponseContains,
  assertResponseMatches,
  // State assertions
  assertStateHasFile,
  assertStateHasTodo,
  assertStepCount,
  assertStreamFinished,
  assertStreamHasText,
  assertStreamTextContains,
  assertTodoCount,
  assertToolCallCount,
  // Tool assertions
  assertToolCalled,
  assertToolCalledWith,
  assertToolNotCalled,
  assertUsageWithin,
  // Stream assertions
  collectStreamChunks,
  getStreamText,
} from "./assertions.js";
// Mock Agent
export {
  createMockAgent,
  createMockModel,
  type MockAgent,
  type MockAgentOptions,
  type MockModelOptions,
  type MockResponse,
} from "./mock-agent.js";
// Recording and Playback
export {
  createPlaybackAgent,
  createRecording,
  createRecordingAgent,
  filterRecording,
  mergeRecordings,
  type PlaybackAgent,
  type PlaybackAgentOptions,
  parseRecording,
  type RecordedInteraction,
  type Recording,
  type RecordingAgent,
  type RecordingAgentOptions,
} from "./recorder.js";
