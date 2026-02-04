/**
 * Tests for observability event types and exporters.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  createObservabilityEventHooks,
  createObservabilityEventStore,
  exportEventsJSONLines,
  exportEventsPrometheus,
  type MCPConnectionFailedInput,
  type MCPConnectionRestoredInput,
  type ObservabilityEvent,
  type ToolLoadErrorInput,
  type ToolRegisteredInput,
  toStructuredEvent,
} from "../src/index.js";

describe("Observability Events", () => {
  describe("toStructuredEvent", () => {
    it("should convert MCPConnectionFailed event", () => {
      const event: MCPConnectionFailedInput = {
        hook_event_name: "MCPConnectionFailed",
        session_id: "test-session",
        cwd: "/test",
        server_name: "github",
        config: { type: "stdio", command: "npx", args: [] },
        error: new Error("Connection failed"),
      };

      const structured = toStructuredEvent(event);

      expect(structured.event_type).toBe("mcp_connection_failed");
      expect(structured.severity).toBe("error");
      expect(structured.message).toContain("github");
      expect(structured.message).toContain("Connection failed");
      expect(structured.session_id).toBe("test-session");
      expect(structured.metadata.server_name).toBe("github");
      expect(structured.metadata.config_type).toBe("stdio");
    });

    it("should convert MCPConnectionRestored event", () => {
      const event: MCPConnectionRestoredInput = {
        hook_event_name: "MCPConnectionRestored",
        session_id: "test-session",
        cwd: "/test",
        server_name: "github",
        tool_count: 5,
      };

      const structured = toStructuredEvent(event);

      expect(structured.event_type).toBe("mcp_connection_restored");
      expect(structured.severity).toBe("info");
      expect(structured.message).toContain("github");
      expect(structured.message).toContain("5 tools");
      expect(structured.metadata.tool_count).toBe(5);
    });

    it("should convert ToolRegistered event", () => {
      const event: ToolRegisteredInput = {
        hook_event_name: "ToolRegistered",
        session_id: "test-session",
        cwd: "/test",
        tool_name: "test_tool",
        description: "A test tool",
        source: "test-plugin",
      };

      const structured = toStructuredEvent(event);

      expect(structured.event_type).toBe("tool_registered");
      expect(structured.severity).toBe("info");
      expect(structured.message).toContain("test_tool");
      expect(structured.message).toContain("test-plugin");
      expect(structured.metadata.source).toBe("test-plugin");
    });

    it("should convert ToolLoadError event", () => {
      const event: ToolLoadErrorInput = {
        hook_event_name: "ToolLoadError",
        session_id: "test-session",
        cwd: "/test",
        tool_name: "bad_tool",
        error: new Error("Not found"),
        source: "test-plugin",
      };

      const structured = toStructuredEvent(event);

      expect(structured.event_type).toBe("tool_load_error");
      expect(structured.severity).toBe("warning");
      expect(structured.message).toContain("bad_tool");
      expect(structured.message).toContain("Not found");
      expect(structured.metadata.error_message).toBe("Not found");
    });

    it("should include timestamp in ISO format", () => {
      const event: ToolRegisteredInput = {
        hook_event_name: "ToolRegistered",
        session_id: "test-session",
        cwd: "/test",
        tool_name: "test_tool",
        description: "A test tool",
      };

      const structured = toStructuredEvent(event);

      expect(structured.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Date(structured.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe("exportEventsJSONLines", () => {
    const events: ObservabilityEvent[] = [
      {
        hook_event_name: "MCPConnectionFailed",
        session_id: "s1",
        cwd: "/test",
        server_name: "github",
        config: { type: "stdio", command: "npx", args: [] },
        error: new Error("Failed"),
      },
      {
        hook_event_name: "ToolRegistered",
        session_id: "s1",
        cwd: "/test",
        tool_name: "tool1",
        description: "Tool 1",
      },
      {
        hook_event_name: "MCPConnectionRestored",
        session_id: "s1",
        cwd: "/test",
        server_name: "github",
        tool_count: 3,
      },
    ];

    it("should export events as JSON Lines", () => {
      const jsonl = exportEventsJSONLines(events);

      const lines = jsonl.split("\n");
      expect(lines.length).toBe(3);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty("timestamp");
        expect(parsed).toHaveProperty("event_type");
        expect(parsed).toHaveProperty("severity");
        expect(parsed).toHaveProperty("message");
        expect(parsed).toHaveProperty("metadata");
      }
    });

    it("should filter by minimum severity", () => {
      const jsonl = exportEventsJSONLines(events, { minSeverity: "error" });

      const lines = jsonl.split("\n").filter((l) => l.trim());
      expect(lines.length).toBe(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.event_type).toBe("mcp_connection_failed");
    });

    it("should handle empty events array", () => {
      const jsonl = exportEventsJSONLines([]);

      expect(jsonl).toBe("");
    });

    it("should respect severity hierarchy", () => {
      const jsonl = exportEventsJSONLines(events, { minSeverity: "warning" });

      const lines = jsonl.split("\n").filter((l) => l.trim());
      expect(lines.length).toBe(1);
    });
  });

  describe("exportEventsPrometheus", () => {
    it("should export MCP connection metrics", () => {
      const events: ObservabilityEvent[] = [
        {
          hook_event_name: "MCPConnectionFailed",
          session_id: "s1",
          cwd: "/test",
          server_name: "github",
          config: { type: "stdio", command: "npx", args: [] },
          error: new Error("Failed"),
        },
        {
          hook_event_name: "MCPConnectionFailed",
          session_id: "s1",
          cwd: "/test",
          server_name: "github",
          config: { type: "stdio", command: "npx", args: [] },
          error: new Error("Failed again"),
        },
        {
          hook_event_name: "MCPConnectionRestored",
          session_id: "s1",
          cwd: "/test",
          server_name: "github",
          tool_count: 5,
        },
      ];

      const metrics = exportEventsPrometheus(events);

      expect(metrics).toContain('mcp_connection_failures_total{server="github"} 2');
      expect(metrics).toContain('mcp_connections_total{server="github"} 1');
      expect(metrics).toContain('mcp_tools_available{server="github"} 5');
    });

    it("should export tool registry metrics", () => {
      const events: ObservabilityEvent[] = [
        {
          hook_event_name: "ToolRegistered",
          session_id: "s1",
          cwd: "/test",
          tool_name: "tool1",
          description: "Tool 1",
          source: "plugin-a",
        },
        {
          hook_event_name: "ToolRegistered",
          session_id: "s1",
          cwd: "/test",
          tool_name: "tool2",
          description: "Tool 2",
          source: "plugin-a",
        },
        {
          hook_event_name: "ToolLoadError",
          session_id: "s1",
          cwd: "/test",
          tool_name: "bad_tool",
          error: new Error("Not found"),
          source: "plugin-b",
        },
      ];

      const metrics = exportEventsPrometheus(events);

      expect(metrics).toContain('tools_registered_total{source="plugin-a"} 2');
      expect(metrics).toContain('tool_load_errors_total{source="plugin-b"} 1');
    });

    it("should handle events with no source", () => {
      const events: ObservabilityEvent[] = [
        {
          hook_event_name: "ToolRegistered",
          session_id: "s1",
          cwd: "/test",
          tool_name: "tool1",
          description: "Tool 1",
        },
      ];

      const metrics = exportEventsPrometheus(events);

      expect(metrics).toContain('tools_registered_total{source="unknown"} 1');
    });

    it("should handle empty events array", () => {
      const metrics = exportEventsPrometheus([]);

      expect(metrics).toBe("");
    });
  });

  describe("ObservabilityEventStore", () => {
    let store: ReturnType<typeof createObservabilityEventStore>;

    beforeEach(() => {
      store = createObservabilityEventStore({ maxSize: 5 });
    });

    it("should add and retrieve events", () => {
      const event: ToolRegisteredInput = {
        hook_event_name: "ToolRegistered",
        session_id: "s1",
        cwd: "/test",
        tool_name: "tool1",
        description: "Tool 1",
      };

      store.add(event);

      const all = store.getAll();
      expect(all.length).toBe(1);
      expect(all[0]).toEqual(event);
    });

    it("should filter events by type", () => {
      const event1: ToolRegisteredInput = {
        hook_event_name: "ToolRegistered",
        session_id: "s1",
        cwd: "/test",
        tool_name: "tool1",
        description: "Tool 1",
      };

      const event2: ToolLoadErrorInput = {
        hook_event_name: "ToolLoadError",
        session_id: "s1",
        cwd: "/test",
        tool_name: "bad_tool",
        error: new Error("Not found"),
      };

      store.add(event1);
      store.add(event2);

      const registered = store.getByType("ToolRegistered");
      expect(registered.length).toBe(1);
      expect(registered[0].hook_event_name).toBe("ToolRegistered");

      const errors = store.getByType("ToolLoadError");
      expect(errors.length).toBe(1);
      expect(errors[0].hook_event_name).toBe("ToolLoadError");
    });

    it("should clear all events", () => {
      const event: ToolRegisteredInput = {
        hook_event_name: "ToolRegistered",
        session_id: "s1",
        cwd: "/test",
        tool_name: "tool1",
        description: "Tool 1",
      };

      store.add(event);
      expect(store.size()).toBe(1);

      store.clear();
      expect(store.size()).toBe(0);
      expect(store.getAll()).toEqual([]);
    });

    it("should enforce max size with LRU eviction", () => {
      for (let i = 0; i < 10; i++) {
        store.add({
          hook_event_name: "ToolRegistered",
          session_id: "s1",
          cwd: "/test",
          tool_name: `tool${i}`,
          description: `Tool ${i}`,
        });
      }

      expect(store.size()).toBe(5);

      const all = store.getAll();
      expect(all[0]).toMatchObject({ tool_name: "tool5" });
      expect(all[4]).toMatchObject({ tool_name: "tool9" });
    });

    it("should return size", () => {
      expect(store.size()).toBe(0);

      store.add({
        hook_event_name: "ToolRegistered",
        session_id: "s1",
        cwd: "/test",
        tool_name: "tool1",
        description: "Tool 1",
      });

      expect(store.size()).toBe(1);
    });
  });

  describe("createObservabilityEventHooks", () => {
    it("should create hooks for all event types", () => {
      const store = createObservabilityEventStore();
      const hooks = createObservabilityEventHooks(store);

      expect(hooks).toHaveProperty("MCPConnectionFailed");
      expect(hooks).toHaveProperty("MCPConnectionRestored");
      expect(hooks).toHaveProperty("ToolRegistered");
      expect(hooks).toHaveProperty("ToolLoadError");

      expect(Array.isArray(hooks.MCPConnectionFailed)).toBe(true);
      expect(hooks.MCPConnectionFailed.length).toBe(1);
    });

    it("should collect events when hooks fire", async () => {
      const store = createObservabilityEventStore();
      const hooks = createObservabilityEventHooks(store);

      const event: MCPConnectionFailedInput = {
        hook_event_name: "MCPConnectionFailed",
        session_id: "s1",
        cwd: "/test",
        server_name: "github",
        config: { type: "stdio", command: "npx", args: [] },
        error: new Error("Failed"),
      };

      await hooks.MCPConnectionFailed[0](event, null, {
        signal: new AbortController().signal,
        agent: {} as any,
      });

      const collected = store.getAll();
      expect(collected.length).toBe(1);
      expect(collected[0]).toEqual(event);
    });

    it("should return continue: true from hooks", async () => {
      const store = createObservabilityEventStore();
      const hooks = createObservabilityEventHooks(store);

      const event: ToolRegisteredInput = {
        hook_event_name: "ToolRegistered",
        session_id: "s1",
        cwd: "/test",
        tool_name: "tool1",
        description: "Tool 1",
      };

      const result = await hooks.ToolRegistered[0](event, null, {
        signal: new AbortController().signal,
        agent: {} as any,
      });

      expect(result).toEqual({ continue: true });
    });
  });

  describe("Integration", () => {
    it("should collect, export, and clear events", async () => {
      const store = createObservabilityEventStore();
      const hooks = createObservabilityEventHooks(store);

      // Add multiple events via hooks
      const events: ObservabilityEvent[] = [
        {
          hook_event_name: "MCPConnectionFailed",
          session_id: "s1",
          cwd: "/test",
          server_name: "github",
          config: { type: "stdio", command: "npx", args: [] },
          error: new Error("Failed"),
        },
        {
          hook_event_name: "ToolRegistered",
          session_id: "s1",
          cwd: "/test",
          tool_name: "tool1",
          description: "Tool 1",
        },
        {
          hook_event_name: "MCPConnectionRestored",
          session_id: "s1",
          cwd: "/test",
          server_name: "github",
          tool_count: 5,
        },
      ];

      for (const event of events) {
        const hookName = event.hook_event_name as keyof typeof hooks;
        await hooks[hookName][0](event as any, null, {
          signal: new AbortController().signal,
          agent: {} as any,
        });
      }

      // Verify collection
      expect(store.size()).toBe(3);

      // Export as JSON Lines
      const jsonl = exportEventsJSONLines(store.getAll());
      expect(jsonl.split("\n").length).toBe(3);

      // Export as Prometheus
      const metrics = exportEventsPrometheus(store.getAll());
      expect(metrics).toContain("mcp_connection_failures_total");
      expect(metrics).toContain("tools_registered_total");

      // Clear
      store.clear();
      expect(store.size()).toBe(0);
    });
  });
});
