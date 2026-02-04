import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState, BackendProtocol } from "../src/index.js";
import {
  createAgent,
  createAgentState,
  FilesystemBackend,
  hasExecuteCapability,
  isBackend,
  StateBackend,
} from "../src/index.js";
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

describe("Backend Integration", () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe("default backend", () => {
    it("creates a StateBackend by default when no backend provided", () => {
      const model = createMockModel();
      const agent = createAgent({ model });

      expect(agent.backend).toBeDefined();
      expect(isBackend(agent.backend)).toBe(true);
      expect(agent.backend).toBeInstanceOf(StateBackend);
    });

    it("creates an empty agent state by default", () => {
      const model = createMockModel();
      const agent = createAgent({ model });

      expect(agent.state).toBeDefined();
      expect(agent.state.todos).toEqual([]);
      expect(agent.state.files).toEqual({});
    });

    it("backend and state are linked when using default StateBackend", async () => {
      const model = createMockModel();
      const agent = createAgent({ model });

      // Write a file through the backend
      await agent.backend.write("/test.txt", "Hello, World!");

      // The state should reflect the change
      expect(agent.state.files["/test.txt"]).toBeDefined();
      expect(agent.state.files["/test.txt"].content).toEqual(["Hello, World!"]);
    });
  });

  describe("backend instance", () => {
    it("accepts a StateBackend instance", () => {
      const model = createMockModel();
      const state = createAgentState();
      const backend = new StateBackend(state);

      const agent = createAgent({ model, backend });

      expect(agent.backend).toBe(backend);
    });

    it("accepts a FilesystemBackend instance", () => {
      const model = createMockModel();
      const backend = new FilesystemBackend({ rootDir: "/tmp" });

      const agent = createAgent({ model, backend });

      expect(agent.backend).toBe(backend);
      expect(agent.backend).toBeInstanceOf(FilesystemBackend);
    });

    it("state is independent from provided backend instance", () => {
      const model = createMockModel();
      const customState: AgentState = {
        todos: [
          { id: "1", content: "test", status: "pending", createdAt: new Date().toISOString() },
        ],
        files: {},
      };
      const backend = new StateBackend(customState);

      const agent = createAgent({ model, backend });

      // Agent state is a fresh one, not the custom state
      expect(agent.state.todos).toEqual([]);
    });
  });

  describe("backend factory", () => {
    it("accepts a factory function that receives agent state", () => {
      const model = createMockModel();
      const factory = vi.fn((state: AgentState) => new StateBackend(state));

      const agent = createAgent({ model, backend: factory });

      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith(agent.state);
      expect(agent.backend).toBeInstanceOf(StateBackend);
    });

    it("factory can access and use the shared state", async () => {
      const model = createMockModel();

      const agent = createAgent({
        model,
        backend: (state) => {
          // Factory receives the agent's shared state
          state.todos.push({
            id: "factory-todo",
            content: "Added by factory",
            status: "pending",
            createdAt: new Date().toISOString(),
          });
          return new StateBackend(state);
        },
      });

      // The todo added in factory should be in agent state
      expect(agent.state.todos).toHaveLength(1);
      expect(agent.state.todos[0].content).toBe("Added by factory");
    });

    it("backend and state stay linked when using factory", async () => {
      const model = createMockModel();

      const agent = createAgent({
        model,
        backend: (state) => new StateBackend(state),
      });

      // Write through backend
      await agent.backend.write("/test.txt", "content");

      // Should be in state
      expect(agent.state.files["/test.txt"]).toBeDefined();
    });
  });

  describe("backend operations", () => {
    it("allows file operations through the backend", async () => {
      const model = createMockModel();
      const agent = createAgent({ model });

      // Write
      const writeResult = await agent.backend.write("/file.txt", "Hello\nWorld");
      expect(writeResult.success).toBe(true);

      // Read
      const content = await agent.backend.read("/file.txt");
      expect(content).toContain("Hello");
      expect(content).toContain("World");

      // Edit
      const editResult = await agent.backend.edit("/file.txt", "World", "Agent");
      expect(editResult.success).toBe(true);

      // Verify edit
      const updated = await agent.backend.read("/file.txt");
      expect(updated).toContain("Agent");
      expect(updated).not.toContain("World");
    });

    it("supports glob operations", async () => {
      const model = createMockModel();
      const agent = createAgent({ model });

      // Create multiple files
      await agent.backend.write("/src/index.ts", "export {}");
      await agent.backend.write("/src/utils.ts", "export {}");
      await agent.backend.write("/src/types.ts", "export {}");
      await agent.backend.write("/readme.md", "# README");

      // Glob for TypeScript files
      const tsFiles = await agent.backend.globInfo("**/*.ts", "/");
      expect(tsFiles).toHaveLength(3);
      expect(tsFiles.map((f) => f.path)).toContain("/src/index.ts");
    });

    it("supports grep operations", async () => {
      const model = createMockModel();
      const agent = createAgent({ model });

      // Create files with searchable content
      await agent.backend.write("/a.ts", "const TODO = 'fix this'");
      await agent.backend.write("/b.ts", "// TODO: add tests");
      await agent.backend.write("/c.ts", "const x = 1");

      // Search for TODO
      const matches = await agent.backend.grepRaw("TODO", "/");
      expect(Array.isArray(matches)).toBe(true);
      expect((matches as Array<{ path: string }>).length).toBe(2);
    });
  });

  describe("backend with execute capability", () => {
    it("can use FilesystemBackend with bash as backend", () => {
      const model = createMockModel();
      const backend = new FilesystemBackend({ rootDir: "/tmp", enableBash: true });

      const agent = createAgent({ model, backend });

      expect(agent.backend).toBe(backend);
      expect(hasExecuteCapability(agent.backend)).toBe(true);
    });

    it("backend with execute supports execute", async () => {
      const model = createMockModel();
      const backend = new FilesystemBackend({ rootDir: "/tmp", enableBash: true });

      const agent = createAgent({ model, backend });

      // Type guard to access execute
      if (hasExecuteCapability(agent.backend)) {
        const result = await agent.backend.execute("echo hello");
        expect(result.output.trim()).toBe("hello");
        expect(result.exitCode).toBe(0);
      }
    });
  });

  describe("multiple agents with different backends", () => {
    it("each agent has independent state", async () => {
      const model = createMockModel();

      const agent1 = createAgent({ model });
      const agent2 = createAgent({ model });

      // Write different files to each agent
      await agent1.backend.write("/agent1.txt", "Agent 1 data");
      await agent2.backend.write("/agent2.txt", "Agent 2 data");

      // Verify isolation
      expect(agent1.state.files["/agent1.txt"]).toBeDefined();
      expect(agent1.state.files["/agent2.txt"]).toBeUndefined();

      expect(agent2.state.files["/agent2.txt"]).toBeDefined();
      expect(agent2.state.files["/agent1.txt"]).toBeUndefined();
    });

    it("agents can share a backend instance", async () => {
      const model = createMockModel();
      const sharedState = createAgentState();
      const sharedBackend = new StateBackend(sharedState);

      const agent1 = createAgent({ model, backend: sharedBackend });
      const agent2 = createAgent({ model, backend: sharedBackend });

      // Both should use the same backend
      expect(agent1.backend).toBe(agent2.backend);

      // Write from agent1
      await agent1.backend.write("/shared.txt", "shared content");

      // Readable from agent2
      const content = await agent2.backend.read("/shared.txt");
      expect(content).toContain("shared content");
    });
  });

  describe("backend type guards", () => {
    it("isBackend returns true for StateBackend", () => {
      const backend = new StateBackend(createAgentState());
      expect(isBackend(backend)).toBe(true);
    });

    it("isBackend returns true for FilesystemBackend", () => {
      const backend = new FilesystemBackend({ rootDir: "/tmp" });
      expect(isBackend(backend)).toBe(true);
    });

    it("isBackend returns false for plain objects", () => {
      expect(isBackend({})).toBe(false);
      expect(isBackend({ read: "not a function" })).toBe(false);
    });

    it("hasExecuteCapability distinguishes backends with execute", () => {
      const state = createAgentState();
      const stateBackend = new StateBackend(state);
      const executableBackend = new FilesystemBackend({ rootDir: "/tmp", enableBash: true });

      // StateBackend doesn't have execute method
      expect(hasExecuteCapability(stateBackend)).toBe(false);
      // FilesystemBackend with enableBash: true has execute capability
      expect(hasExecuteCapability(executableBackend)).toBe(true);
      // Note: FilesystemBackend always has execute method, but it throws when enableBash: false
      // The hasExecuteCapability check only tests if the method exists, not if it's enabled
    });
  });

  describe("agent.options.backend", () => {
    it("exposes the backend option in options", () => {
      const model = createMockModel();
      const backend = new StateBackend(createAgentState());
      const agent = createAgent({ model, backend });

      expect(agent.options.backend).toBe(backend);
    });

    it("backend option is undefined when using default", () => {
      const model = createMockModel();
      const agent = createAgent({ model });

      expect(agent.options.backend).toBeUndefined();
    });
  });
});

describe("BackendFactory type", () => {
  it("factory receives AgentState type", () => {
    const model = createMockModel();

    // TypeScript should allow this factory signature
    const factory = (state: AgentState): BackendProtocol => {
      // state should have the AgentState shape
      expect(state.todos).toBeDefined();
      expect(state.files).toBeDefined();
      return new StateBackend(state);
    };

    const agent = createAgent({ model, backend: factory });
    expect(agent).toBeDefined();
  });
});
