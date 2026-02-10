import { tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../src/agent.js";
import { AgentSession } from "../src/session.js";
import type {
  ExtendedToolExecutionOptions,
  GenerateResult,
  GenerateResultHandoff,
} from "../src/types.js";
import { isHandoffResult } from "../src/types.js";
import { createMockModel, resetMocks } from "./setup.js";

// Mock the AI SDK functions
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
  };
});

import { generateText } from "ai";

describe("Agent Handoff Mechanism", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("isHandoffResult type guard", () => {
    it("returns true for handoff results", () => {
      const result: GenerateResultHandoff = {
        status: "handoff",
        targetAgent: null,
        resumable: true,
        isHandback: false,
      };
      expect(isHandoffResult(result)).toBe(true);
    });

    it("returns false for complete results", () => {
      const result: GenerateResult = {
        status: "complete",
        text: "hello",
        finishReason: "stop",
        steps: [],
      };
      expect(isHandoffResult(result)).toBe(false);
    });

    it("returns false for interrupted results", () => {
      const result: GenerateResult = {
        status: "interrupted",
        interrupt: {
          id: "int-1",
          threadId: "thread-1",
          type: "custom",
          toolCallId: "tc-1",
          toolName: "test",
          request: {},
          step: 0,
          createdAt: new Date().toISOString(),
        },
      };
      expect(isHandoffResult(result)).toBe(false);
    });
  });

  describe("handoff() and handback() in tool execution", () => {
    it("handoff and handback functions are available in tool execution context", async () => {
      let capturedHandoff: ExtendedToolExecutionOptions["handoff"] | undefined;
      let capturedHandback: ExtendedToolExecutionOptions["handback"] | undefined;

      const testTool = tool({
        description: "Test tool",
        parameters: z.object({}),
        execute: async (_input, options) => {
          const extOpts = options as ExtendedToolExecutionOptions;
          capturedHandoff = extOpts.handoff;
          capturedHandback = extOpts.handback;
          return "ok";
        },
      });

      const model = createMockModel({
        toolCalls: [{ toolName: "test_tool", input: {} }],
      });

      // Mock generateText to actually call the tool
      const mockedGenerateText = vi.mocked(generateText);
      mockedGenerateText.mockImplementation(async (opts: any) => {
        // Call the tool execute to capture options
        if (opts.tools?.test_tool?.execute) {
          await opts.tools.test_tool.execute({}, { toolCallId: "tc-1" });
        }
        return {
          text: "response",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          response: { id: "r1", timestamp: new Date(), modelId: "mock" },
          steps: [],
          warnings: [],
          sources: [],
          toolCalls: [],
          toolResults: [],
          request: { body: {} },
        } as any;
      });

      const agent = createAgent({
        model,
        tools: { test_tool: testTool },
        permissionMode: "bypassPermissions",
      });

      await agent.generate({ prompt: "test" });

      expect(capturedHandoff).toBeDefined();
      expect(typeof capturedHandoff).toBe("function");
      expect(capturedHandback).toBeDefined();
      expect(typeof capturedHandback).toBe("function");
    });
  });

  describe("Session handoff handling", () => {
    it("swaps agent on handoff result", async () => {
      const targetModel = createMockModel({ text: "target response" });
      const targetAgent = createAgent({
        model: targetModel,
        systemPrompt: "Target agent",
      });

      const primaryModel = createMockModel();
      const primaryAgent = createAgent({
        model: primaryModel,
        systemPrompt: "Primary agent",
      });

      // Override generate to simulate handoff then completion
      let callCount = 0;
      const originalGenerate = primaryAgent.generate.bind(primaryAgent);
      primaryAgent.generate = async (opts) => {
        callCount++;
        if (callCount === 1) {
          // First call: return a handoff result
          return {
            status: "handoff" as const,
            targetAgent,
            context: "Take over",
            resumable: true,
            isHandback: false,
            partial: { text: "", steps: [], usage: undefined },
          };
        }
        return originalGenerate(opts);
      };

      const session = new AgentSession({ agent: primaryAgent });
      session.sendMessage("Hello");

      const outputs: Array<{ type: string; [key: string]: unknown }> = [];
      let count = 0;
      for await (const output of session.run()) {
        outputs.push(output);
        count++;
        // Prevent infinite loop
        if (count > 10) {
          session.stop();
          break;
        }
        if (output.type === "generation_complete" || output.type === "error") {
          session.stop();
        }
      }

      // Should have an agent_handoff event
      const handoffOutput = outputs.find((o) => o.type === "agent_handoff");
      expect(handoffOutput).toBeDefined();
      expect(handoffOutput?.context).toBe("Take over");
    });

    it("restores agent on handback", async () => {
      const primaryModel = createMockModel();
      const primaryAgent = createAgent({
        model: primaryModel,
        systemPrompt: "Primary agent",
      });

      const targetModel = createMockModel({ text: "target response" });
      const targetAgent = createAgent({
        model: targetModel,
        systemPrompt: "Target agent",
      });

      // First call: handoff, second call (on target): handback, third: complete on primary
      let callCount = 0;
      const originalPrimaryGenerate = primaryAgent.generate.bind(primaryAgent);
      primaryAgent.generate = async (opts) => {
        callCount++;
        if (callCount === 1) {
          return {
            status: "handoff" as const,
            targetAgent,
            context: "Take over",
            resumable: true,
            isHandback: false,
            partial: { text: "", steps: [], usage: undefined },
          };
        }
        // After handback, should be called on primary agent again
        return originalPrimaryGenerate(opts);
      };

      targetAgent.generate = async (_opts) => {
        return {
          status: "handoff" as const,
          targetAgent: null,
          context: "Handing back with results",
          resumable: true,
          isHandback: true,
          partial: { text: "", steps: [], usage: undefined },
        };
      };

      const session = new AgentSession({ agent: primaryAgent });
      session.sendMessage("Hello");

      const outputs: Array<{ type: string; [key: string]: unknown }> = [];
      let count = 0;
      for await (const output of session.run()) {
        outputs.push(output);
        count++;
        if (count > 20) {
          session.stop();
          break;
        }
        if (output.type === "generation_complete" || output.type === "error") {
          session.stop();
        }
      }

      // Should have two agent_handoff events (handoff + handback)
      const handoffOutputs = outputs.filter((o) => o.type === "agent_handoff");
      expect(handoffOutputs.length).toBe(2);
      expect(handoffOutputs[0].context).toBe("Take over");
      expect(handoffOutputs[1].context).toBe("Handing back with results");
    });

    it("yields error when non-handback handoff has null targetAgent", async () => {
      const primaryModel = createMockModel();
      const primaryAgent = createAgent({
        model: primaryModel,
        systemPrompt: "Primary agent",
      });

      primaryAgent.generate = async (_opts) => {
        return {
          status: "handoff" as const,
          targetAgent: null,
          context: "Handoff with null target",
          resumable: true,
          isHandback: false,
          partial: { text: "", steps: [], usage: undefined },
        };
      };

      const session = new AgentSession({ agent: primaryAgent });
      session.sendMessage("test");

      const outputs: Array<{ type: string; [key: string]: unknown }> = [];
      let count = 0;
      for await (const output of session.run()) {
        outputs.push(output);
        count++;
        if (count > 10) {
          session.stop();
          break;
        }
        if (output.type === "error" || output.type === "generation_complete") {
          session.stop();
        }
      }

      const errorOutput = outputs.find((o) => o.type === "error");
      expect(errorOutput).toBeDefined();
      expect((errorOutput?.error as Error).message).toContain("Handoff target agent is null");
    });

    it("yields error when max handoff depth is exceeded", async () => {
      const primaryModel = createMockModel();
      const primaryAgent = createAgent({
        model: primaryModel,
        systemPrompt: "Primary agent",
      });

      const secondModel = createMockModel();
      const secondAgent = createAgent({
        model: secondModel,
        systemPrompt: "Second agent",
      });

      // Every generate call triggers a handoff to the other agent
      let toggle = false;
      const makeHandoff = async (_opts: any) => {
        toggle = !toggle;
        return {
          status: "handoff" as const,
          targetAgent: toggle ? secondAgent : primaryAgent,
          context: "Ping-pong handoff",
          resumable: true,
          isHandback: false,
          partial: { text: "", steps: [], usage: undefined },
        };
      };

      primaryAgent.generate = makeHandoff;
      secondAgent.generate = makeHandoff;

      const session = new AgentSession({
        agent: primaryAgent,
        maxHandoffDepth: 3,
      });
      session.sendMessage("test");

      const outputs: Array<{ type: string; [key: string]: unknown }> = [];
      let count = 0;
      for await (const output of session.run()) {
        outputs.push(output);
        count++;
        if (count > 20) {
          session.stop();
          break;
        }
        if (output.type === "error" || output.type === "generation_complete") {
          session.stop();
        }
      }

      const errorOutput = outputs.find((o) => o.type === "error");
      expect(errorOutput).toBeDefined();
      expect((errorOutput?.error as Error).message).toContain("Maximum handoff depth (3) exceeded");
    });

    it("non-resumable handoff does not push to stack", async () => {
      const primaryModel = createMockModel();
      const primaryAgent = createAgent({
        model: primaryModel,
        systemPrompt: "Primary agent",
      });

      const targetModel = createMockModel({ text: "target done" });
      const targetAgent = createAgent({
        model: targetModel,
        systemPrompt: "Target agent",
      });

      let callCount = 0;
      primaryAgent.generate = async (_opts) => {
        callCount++;
        if (callCount === 1) {
          return {
            status: "handoff" as const,
            targetAgent,
            context: "One way handoff",
            resumable: false,
            isHandback: false,
            partial: { text: "", steps: [], usage: undefined },
          };
        }
        throw new Error("Primary should not be called again");
      };

      // Target does a handback - but since not resumable, stack is empty
      targetAgent.generate = async (_opts) => {
        return {
          status: "handoff" as const,
          targetAgent: null,
          context: "Trying to hand back",
          resumable: true,
          isHandback: true,
          partial: { text: "", steps: [], usage: undefined },
        };
      };

      const session = new AgentSession({ agent: primaryAgent });
      session.sendMessage("test");

      const outputs: Array<{ type: string; [key: string]: unknown }> = [];
      let count = 0;
      for await (const output of session.run()) {
        outputs.push(output);
        count++;
        if (count > 15) {
          session.stop();
          break;
        }
        if (output.type === "waiting_for_input" && count > 3) {
          session.stop();
        }
      }

      // Handoff happened (non-resumable so primary not pushed to stack)
      const handoffs = outputs.filter((o) => o.type === "agent_handoff");
      expect(handoffs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
