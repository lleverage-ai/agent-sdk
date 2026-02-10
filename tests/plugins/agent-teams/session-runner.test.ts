import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTeamCoordinator } from "../../../src/plugins/agent-teams/coordinator.js";
import { HeadlessSessionRunner } from "../../../src/plugins/agent-teams/session-runner.js";
import type { SessionOutput } from "../../../src/session.js";
import type { Agent } from "../../../src/types.js";

// Store the outputs the mock will yield; tests can customize per test
let mockSessionOutputs: SessionOutput[] = [];

// Mock AgentSession with a proper class
vi.mock("../../../src/session.js", () => {
  class MockAgentSession {
    sendMessage = vi.fn();
    stop = vi.fn();
    respondToInterrupt = vi.fn();
    run = vi.fn(async function* () {
      for (const output of mockSessionOutputs) {
        yield output;
      }
    });
  }

  return {
    AgentSession: MockAgentSession,
  };
});

describe("HeadlessSessionRunner", () => {
  let coordinator: InMemoryTeamCoordinator;
  const teammateId = "researcher-1";

  beforeEach(() => {
    coordinator = new InMemoryTeamCoordinator();
    // Default: just yield generation_complete so the runner finishes cleanly
    mockSessionOutputs = [{ type: "generation_complete", fullText: "Mock response" }];
    vi.clearAllMocks();
  });

  afterEach(() => {
    coordinator.dispose();
  });

  function createMockAgent(): Agent {
    return {
      generate: vi.fn(),
      resume: vi.fn(),
      options: { model: {} as any },
    } as unknown as Agent;
  }

  it("creates a runner and completes after generation", async () => {
    const agent = createMockAgent();
    const runner = new HeadlessSessionRunner({
      agent,
      teammateId,
      coordinator,
      initialPrompt: "Start researching",
    });

    await runner.start();

    expect(runner.isRunning()).toBe(false);
  });

  it("isRunning returns false before start", () => {
    const agent = createMockAgent();
    const runner = new HeadlessSessionRunner({
      agent,
      teammateId,
      coordinator,
      initialPrompt: "test",
    });

    expect(runner.isRunning()).toBe(false);
  });

  it("stop sets running to false", async () => {
    const agent = createMockAgent();
    const runner = new HeadlessSessionRunner({
      agent,
      teammateId,
      coordinator,
      initialPrompt: "test",
    });

    const startPromise = runner.start();
    runner.stop();

    await startPromise;
    expect(runner.isRunning()).toBe(false);
  });

  it("updates teammate status to stopped on completion", async () => {
    coordinator.registerTeammate({
      id: teammateId,
      role: "researcher",
      description: "Researches topics",
      status: "idle",
      spawnedAt: new Date().toISOString(),
    });

    const agent = createMockAgent();
    const runner = new HeadlessSessionRunner({
      agent,
      teammateId,
      coordinator,
      initialPrompt: "test",
    });

    await runner.start();

    const tmInfo = coordinator.getTeammate(teammateId);
    expect(tmInfo?.status).toBe("stopped");
  });

  it("does not start a second time if already running", async () => {
    const agent = createMockAgent();
    const runner = new HeadlessSessionRunner({
      agent,
      teammateId,
      coordinator,
      initialPrompt: "test",
    });

    const first = runner.start();
    // Second call should return immediately since running is true
    const second = runner.start();

    await first;
    await second;
  });

  it("calls onOutput for text_delta events", async () => {
    mockSessionOutputs = [
      { type: "text_delta", text: "Hello world" } as SessionOutput,
      { type: "generation_complete", fullText: "Hello world" },
    ];

    const onOutput = vi.fn();
    const agent = createMockAgent();
    const runner = new HeadlessSessionRunner({
      agent,
      teammateId,
      coordinator,
      initialPrompt: "test",
      onOutput,
    });

    await runner.start();

    expect(onOutput).toHaveBeenCalledWith("Hello world");
  });

  it("handles error events without crashing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockSessionOutputs = [
      { type: "error", error: new Error("test error") } as SessionOutput,
      { type: "generation_complete", fullText: "" },
    ];

    const agent = createMockAgent();
    const runner = new HeadlessSessionRunner({
      agent,
      teammateId,
      coordinator,
      initialPrompt: "test",
    });

    await runner.start();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("calls onError callback instead of console.error when provided", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();

    mockSessionOutputs = [
      { type: "error", error: new Error("test error") } as SessionOutput,
      { type: "generation_complete", fullText: "" },
    ];

    const agent = createMockAgent();
    const runner = new HeadlessSessionRunner({
      agent,
      teammateId,
      coordinator,
      initialPrompt: "test",
      onError,
    });

    await runner.start();

    expect(onError).toHaveBeenCalledWith(teammateId, expect.any(Error));
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("treats interrupts as errors in headless mode", async () => {
    const onError = vi.fn();

    mockSessionOutputs = [
      {
        type: "interrupt",
        interrupt: { id: "int-1", type: "custom", toolCallId: "tc-1", toolName: "test" },
      } as unknown as SessionOutput,
    ];

    const agent = createMockAgent();
    const runner = new HeadlessSessionRunner({
      agent,
      teammateId,
      coordinator,
      initialPrompt: "test",
      onError,
    });

    await runner.start();

    expect(onError).toHaveBeenCalledWith(
      teammateId,
      expect.objectContaining({
        message: expect.stringContaining("Unexpected interrupt"),
      }),
    );
  });

  it("passes custom idleTimeoutMs to coordinator.waitForMessage", async () => {
    const waitSpy = vi.spyOn(coordinator, "waitForMessage").mockResolvedValue(null);

    mockSessionOutputs = [
      { type: "waiting_for_input" } as SessionOutput,
      // After waitForMessage returns null (timeout), the runner stops
    ];

    const agent = createMockAgent();
    const runner = new HeadlessSessionRunner({
      agent,
      teammateId,
      coordinator,
      initialPrompt: "test",
      idleTimeoutMs: 5000,
    });

    await runner.start();

    expect(waitSpy).toHaveBeenCalledWith(teammateId, 5000);
    waitSpy.mockRestore();
  });

  it("injects messages when waiting_for_input and messages exist", async () => {
    // Pre-send a message to the teammate
    coordinator.sendMessage({
      from: "lead",
      to: teammateId,
      content: "Please work on task 1",
    });

    mockSessionOutputs = [
      { type: "waiting_for_input" } as SessionOutput,
      // After message injection, the session would produce more outputs
      // but we let the generator end here
    ];

    const agent = createMockAgent();
    const runner = new HeadlessSessionRunner({
      agent,
      teammateId,
      coordinator,
      initialPrompt: "test",
    });

    await runner.start();

    // The message should have been marked as read
    const unread = coordinator.getMessages(teammateId, true);
    expect(unread).toHaveLength(0);
  });
});
