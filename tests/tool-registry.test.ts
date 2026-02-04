/**
 * Tests for ToolRegistry and use_tools meta-tool.
 */

import { tool } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createToolRegistry,
  createUseToolsTool,
  type ToolMetadata,
  ToolRegistry,
} from "../src/tools/tool-registry.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockTool(name: string, description: string) {
  return tool({
    description,
    inputSchema: z.object({ input: z.string() }),
    execute: async ({ input }) => `${name}: ${input}`,
  });
}

const mockTools = {
  createPayment: createMockTool("createPayment", "Create a payment intent"),
  listCustomers: createMockTool("listCustomers", "List all customers"),
  refund: createMockTool("refund", "Process a refund"),
  sendSms: createMockTool("sendSms", "Send an SMS message"),
  makeCall: createMockTool("makeCall", "Make a phone call"),
  uploadFile: createMockTool("uploadFile", "Upload a file to S3"),
  listBuckets: createMockTool("listBuckets", "List S3 buckets"),
};

// =============================================================================
// ToolRegistry Tests
// =============================================================================

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("creation", () => {
    it("should create an empty registry", () => {
      expect(registry.size).toBe(0);
      expect(registry.loadedCount).toBe(0);
    });

    it("should accept onToolsLoaded callback", () => {
      const onToolsLoaded = vi.fn();
      const reg = new ToolRegistry({ onToolsLoaded });

      reg.register({ name: "test", description: "Test tool" }, mockTools.createPayment);
      reg.load(["test"]);

      expect(onToolsLoaded).toHaveBeenCalledTimes(1);
      expect(onToolsLoaded).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          loaded: ["test"],
        }),
      );
    });

    it("should accept onRegistryUpdated callback", () => {
      const onRegistryUpdated = vi.fn();
      const reg = new ToolRegistry({ onRegistryUpdated });

      reg.register({ name: "test", description: "Test tool" }, mockTools.createPayment);

      expect(onRegistryUpdated).toHaveBeenCalledTimes(1);
    });
  });

  describe("register", () => {
    it("should register a tool with metadata", () => {
      const metadata: ToolMetadata = {
        name: "createPayment",
        description: "Create a payment intent",
        plugin: "stripe",
        category: "payments",
        tags: ["payment", "stripe"],
      };

      registry.register(metadata, mockTools.createPayment);

      expect(registry.size).toBe(1);
      expect(registry.has("createPayment")).toBe(true);
      expect(registry.getMetadata("createPayment")).toEqual(metadata);
    });

    it("should throw if tool name already exists", () => {
      registry.register({ name: "test", description: "Test" }, mockTools.createPayment);

      expect(() => {
        registry.register({ name: "test", description: "Duplicate" }, mockTools.listCustomers);
      }).toThrow("Tool 'test' is already registered");
    });

    it("should register tool as not loaded by default", () => {
      registry.register({ name: "test", description: "Test" }, mockTools.createPayment);

      expect(registry.isLoaded("test")).toBe(false);
    });
  });

  describe("registerMany", () => {
    it("should register multiple tools at once", () => {
      registry.registerMany([
        [{ name: "tool1", description: "Tool 1" }, mockTools.createPayment],
        [{ name: "tool2", description: "Tool 2" }, mockTools.listCustomers],
        [{ name: "tool3", description: "Tool 3" }, mockTools.refund],
      ]);

      expect(registry.size).toBe(3);
      expect(registry.has("tool1")).toBe(true);
      expect(registry.has("tool2")).toBe(true);
      expect(registry.has("tool3")).toBe(true);
    });
  });

  describe("registerPlugin", () => {
    it("should register all tools from a plugin", () => {
      const pluginTools = {
        createPayment: mockTools.createPayment,
        listCustomers: mockTools.listCustomers,
        refund: mockTools.refund,
      };

      registry.registerPlugin("stripe", pluginTools);

      expect(registry.size).toBe(3);
      expect(registry.getMetadata("createPayment")?.plugin).toBe("stripe");
      expect(registry.getMetadata("listCustomers")?.plugin).toBe("stripe");
      expect(registry.getMetadata("refund")?.plugin).toBe("stripe");
    });

    it("should apply category and tags to all plugin tools", () => {
      registry.registerPlugin(
        "stripe",
        { createPayment: mockTools.createPayment },
        { category: "payments", tags: ["money", "transactions"] },
      );

      const metadata = registry.getMetadata("createPayment");
      expect(metadata?.category).toBe("payments");
      expect(metadata?.tags).toEqual(["money", "transactions"]);
    });

    it("should extract description from tool definition", () => {
      registry.registerPlugin("stripe", {
        createPayment: mockTools.createPayment,
      });

      const metadata = registry.getMetadata("createPayment");
      expect(metadata?.description).toBe("Create a payment intent");
    });
  });

  describe("unregister", () => {
    beforeEach(() => {
      registry.register({ name: "test", description: "Test" }, mockTools.createPayment);
    });

    it("should remove a registered tool", () => {
      const result = registry.unregister("test");

      expect(result).toBe(true);
      expect(registry.has("test")).toBe(false);
      expect(registry.size).toBe(0);
    });

    it("should return false for non-existent tool", () => {
      const result = registry.unregister("nonexistent");
      expect(result).toBe(false);
    });

    it("should also clear loaded state", () => {
      registry.load(["test"]);
      expect(registry.isLoaded("test")).toBe(true);

      registry.unregister("test");
      expect(registry.isLoaded("test")).toBe(false);
    });
  });

  describe("has", () => {
    it("should return true for registered tools", () => {
      registry.register({ name: "test", description: "Test" }, mockTools.createPayment);
      expect(registry.has("test")).toBe(true);
    });

    it("should return false for non-existent tools", () => {
      expect(registry.has("nonexistent")).toBe(false);
    });
  });

  describe("isLoaded", () => {
    beforeEach(() => {
      registry.register({ name: "test", description: "Test" }, mockTools.createPayment);
    });

    it("should return false for unloaded tools", () => {
      expect(registry.isLoaded("test")).toBe(false);
    });

    it("should return true for loaded tools", () => {
      registry.load(["test"]);
      expect(registry.isLoaded("test")).toBe(true);
    });

    it("should return false for non-existent tools", () => {
      expect(registry.isLoaded("nonexistent")).toBe(false);
    });
  });

  describe("getMetadata", () => {
    it("should return metadata for registered tools", () => {
      const metadata: ToolMetadata = {
        name: "test",
        description: "Test tool",
        plugin: "my-plugin",
      };
      registry.register(metadata, mockTools.createPayment);

      expect(registry.getMetadata("test")).toEqual(metadata);
    });

    it("should return undefined for non-existent tools", () => {
      expect(registry.getMetadata("nonexistent")).toBeUndefined();
    });
  });

  describe("search", () => {
    beforeEach(() => {
      // Register tools from multiple plugins
      registry.registerPlugin("stripe", {
        createPayment: mockTools.createPayment,
        listCustomers: mockTools.listCustomers,
        refund: mockTools.refund,
      });
      registry.registerPlugin("twilio", {
        sendSms: mockTools.sendSms,
        makeCall: mockTools.makeCall,
      });
      registry.register(
        {
          name: "uploadFile",
          description: "Upload a file to S3",
          plugin: "aws",
          category: "storage",
          tags: ["s3", "upload", "file"],
        },
        mockTools.uploadFile,
      );
      registry.register(
        {
          name: "listBuckets",
          description: "List S3 buckets",
          plugin: "aws",
          category: "storage",
          tags: ["s3", "list"],
        },
        mockTools.listBuckets,
      );
    });

    it("should return all unloaded tools with no options", () => {
      const results = registry.search();
      expect(results.length).toBe(7);
    });

    it("should filter by query (name match)", () => {
      const results = registry.search({ query: "payment" });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("createPayment");
    });

    it("should filter by query (description match)", () => {
      const results = registry.search({ query: "SMS" });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("sendSms");
    });

    it("should filter by query (tag match)", () => {
      const results = registry.search({ query: "s3" });
      expect(results.length).toBe(2);
      expect(results.map((r) => r.name)).toContain("uploadFile");
      expect(results.map((r) => r.name)).toContain("listBuckets");
    });

    it("should filter by plugin", () => {
      const results = registry.search({ plugin: "stripe" });
      expect(results.length).toBe(3);
      expect(results.every((r) => r.plugin === "stripe")).toBe(true);
    });

    it("should filter by category", () => {
      const results = registry.search({ category: "storage" });
      expect(results.length).toBe(2);
      expect(results.every((r) => r.category === "storage")).toBe(true);
    });

    it("should filter by tags (any match)", () => {
      const results = registry.search({ tags: ["upload", "list"] });
      expect(results.length).toBe(2);
    });

    it("should combine multiple filters", () => {
      const results = registry.search({ plugin: "aws", query: "upload" });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("uploadFile");
    });

    it("should exclude loaded tools by default", () => {
      registry.load(["createPayment"]);
      const results = registry.search({ plugin: "stripe" });
      expect(results.length).toBe(2);
      expect(results.map((r) => r.name)).not.toContain("createPayment");
    });

    it("should include loaded tools when requested", () => {
      registry.load(["createPayment"]);
      const results = registry.search({ plugin: "stripe", includeLoaded: true });
      expect(results.length).toBe(3);
      expect(results.map((r) => r.name)).toContain("createPayment");
    });

    it("should limit results", () => {
      const results = registry.search({ limit: 2 });
      expect(results.length).toBe(2);
    });

    it("should return empty array for no matches", () => {
      const results = registry.search({ query: "nonexistent" });
      expect(results).toEqual([]);
    });
  });

  describe("load", () => {
    beforeEach(() => {
      registry.register({ name: "tool1", description: "Tool 1" }, mockTools.createPayment);
      registry.register({ name: "tool2", description: "Tool 2" }, mockTools.listCustomers);
      registry.register({ name: "tool3", description: "Tool 3" }, mockTools.refund);
    });

    it("should load a single tool", () => {
      const result = registry.load(["tool1"]);

      expect(result.success).toBe(true);
      expect(result.loaded).toEqual(["tool1"]);
      expect(result.skipped).toEqual([]);
      expect(result.notFound).toEqual([]);
      expect(Object.keys(result.tools)).toEqual(["tool1"]);
      expect(registry.isLoaded("tool1")).toBe(true);
    });

    it("should load multiple tools", () => {
      const result = registry.load(["tool1", "tool2", "tool3"]);

      expect(result.success).toBe(true);
      expect(result.loaded).toEqual(["tool1", "tool2", "tool3"]);
      expect(Object.keys(result.tools).length).toBe(3);
      expect(registry.loadedCount).toBe(3);
    });

    it("should skip already loaded tools", () => {
      registry.load(["tool1"]);
      const result = registry.load(["tool1", "tool2"]);

      expect(result.success).toBe(true);
      expect(result.loaded).toEqual(["tool2"]);
      expect(result.skipped).toEqual(["tool1"]);
      expect(Object.keys(result.tools)).toEqual(["tool2"]);
    });

    it("should report not found tools", () => {
      const result = registry.load(["tool1", "nonexistent"]);

      expect(result.success).toBe(false);
      expect(result.loaded).toEqual(["tool1"]);
      expect(result.notFound).toEqual(["nonexistent"]);
      expect(result.error).toContain("nonexistent");
    });

    it("should handle all tools not found", () => {
      const result = registry.load(["nonexistent1", "nonexistent2"]);

      expect(result.success).toBe(false);
      expect(result.loaded).toEqual([]);
      expect(result.notFound).toEqual(["nonexistent1", "nonexistent2"]);
    });

    it("should return tools that can be used", async () => {
      const result = registry.load(["tool1"]);
      const loadedTool = result.tools.tool1;

      expect(loadedTool).toBeDefined();
      // Verify it's a valid tool by checking it has the expected properties
      expect(loadedTool).toHaveProperty("execute");
    });
  });

  describe("loadMatching", () => {
    beforeEach(() => {
      registry.registerPlugin("stripe", {
        createPayment: mockTools.createPayment,
        listCustomers: mockTools.listCustomers,
      });
      registry.registerPlugin("twilio", {
        sendSms: mockTools.sendSms,
      });
    });

    it("should load tools matching search query", () => {
      const result = registry.loadMatching({ query: "payment" });

      expect(result.success).toBe(true);
      expect(result.loaded).toEqual(["createPayment"]);
    });

    it("should load all tools from a plugin", () => {
      const result = registry.loadMatching({ plugin: "stripe" });

      expect(result.success).toBe(true);
      expect(result.loaded).toContain("createPayment");
      expect(result.loaded).toContain("listCustomers");
    });
  });

  describe("getLoadedTools", () => {
    beforeEach(() => {
      registry.register({ name: "tool1", description: "Tool 1" }, mockTools.createPayment);
      registry.register({ name: "tool2", description: "Tool 2" }, mockTools.listCustomers);
      registry.register({ name: "tool3", description: "Tool 3" }, mockTools.refund);
    });

    it("should return empty object when nothing is loaded", () => {
      const loaded = registry.getLoadedTools();
      expect(Object.keys(loaded)).toEqual([]);
    });

    it("should return only loaded tools", () => {
      registry.load(["tool1", "tool3"]);
      const loaded = registry.getLoadedTools();

      expect(Object.keys(loaded).sort()).toEqual(["tool1", "tool3"]);
    });

    it("should return all loaded tools after multiple loads", () => {
      registry.load(["tool1"]);
      registry.load(["tool2"]);
      const loaded = registry.getLoadedTools();

      expect(Object.keys(loaded).sort()).toEqual(["tool1", "tool2"]);
    });
  });

  describe("listAvailable", () => {
    beforeEach(() => {
      registry.register({ name: "tool1", description: "Tool 1" }, mockTools.createPayment);
      registry.register({ name: "tool2", description: "Tool 2" }, mockTools.listCustomers);
    });

    it("should list all tools when none are loaded", () => {
      const available = registry.listAvailable();
      expect(available.length).toBe(2);
    });

    it("should exclude loaded tools", () => {
      registry.load(["tool1"]);
      const available = registry.listAvailable();

      expect(available.length).toBe(1);
      expect(available[0].name).toBe("tool2");
    });
  });

  describe("listLoaded", () => {
    beforeEach(() => {
      registry.register({ name: "tool1", description: "Tool 1" }, mockTools.createPayment);
      registry.register({ name: "tool2", description: "Tool 2" }, mockTools.listCustomers);
    });

    it("should return empty array when nothing is loaded", () => {
      expect(registry.listLoaded()).toEqual([]);
    });

    it("should return loaded tool names", () => {
      registry.load(["tool1", "tool2"]);
      expect(registry.listLoaded().sort()).toEqual(["tool1", "tool2"]);
    });
  });

  describe("listAll", () => {
    beforeEach(() => {
      registry.register({ name: "tool1", description: "Tool 1" }, mockTools.createPayment);
      registry.register({ name: "tool2", description: "Tool 2" }, mockTools.listCustomers);
    });

    it("should list all tools with loaded status", () => {
      registry.load(["tool1"]);
      const all = registry.listAll();

      expect(all.length).toBe(2);

      const tool1 = all.find((t) => t.name === "tool1");
      const tool2 = all.find((t) => t.name === "tool2");

      expect(tool1?.loaded).toBe(true);
      expect(tool2?.loaded).toBe(false);
    });
  });

  describe("listPlugins", () => {
    it("should return empty array when no plugins", () => {
      registry.register({ name: "tool1", description: "Tool 1" }, mockTools.createPayment);
      expect(registry.listPlugins()).toEqual([]);
    });

    it("should return unique plugin names", () => {
      registry.registerPlugin("stripe", {
        createPayment: mockTools.createPayment,
        listCustomers: mockTools.listCustomers,
      });
      registry.registerPlugin("twilio", {
        sendSms: mockTools.sendSms,
      });

      const plugins = registry.listPlugins();
      expect(plugins.sort()).toEqual(["stripe", "twilio"]);
    });
  });

  describe("reset", () => {
    beforeEach(() => {
      registry.register({ name: "tool1", description: "Tool 1" }, mockTools.createPayment);
      registry.register({ name: "tool2", description: "Tool 2" }, mockTools.listCustomers);
      registry.load(["tool1", "tool2"]);
    });

    it("should mark all tools as unloaded", () => {
      expect(registry.loadedCount).toBe(2);

      registry.reset();

      expect(registry.loadedCount).toBe(0);
      expect(registry.isLoaded("tool1")).toBe(false);
      expect(registry.isLoaded("tool2")).toBe(false);
    });

    it("should preserve registered tools", () => {
      registry.reset();

      expect(registry.size).toBe(2);
      expect(registry.has("tool1")).toBe(true);
      expect(registry.has("tool2")).toBe(true);
    });
  });

  describe("clear", () => {
    beforeEach(() => {
      registry.register({ name: "tool1", description: "Tool 1" }, mockTools.createPayment);
      registry.load(["tool1"]);
    });

    it("should remove all tools", () => {
      registry.clear();

      expect(registry.size).toBe(0);
      expect(registry.loadedCount).toBe(0);
      expect(registry.has("tool1")).toBe(false);
    });
  });

  describe("buildToolIndex", () => {
    beforeEach(() => {
      registry.registerPlugin("stripe", {
        createPayment: mockTools.createPayment,
        listCustomers: mockTools.listCustomers,
      });
      registry.registerPlugin("twilio", {
        sendSms: mockTools.sendSms,
      });
      registry.register({ name: "standalone", description: "Standalone tool" }, mockTools.refund);
    });

    it("should group tools by plugin", () => {
      const index = registry.buildToolIndex({ includePlugins: true });

      expect(index).toContain("[stripe]");
      expect(index).toContain("[twilio]");
      expect(index).toContain("[other]");
      expect(index).toContain("createPayment");
      expect(index).toContain("sendSms");
      expect(index).toContain("standalone");
    });

    it("should create flat list without plugin grouping", () => {
      const index = registry.buildToolIndex({ includePlugins: false });

      expect(index).not.toContain("[stripe]");
      expect(index).toContain("- createPayment:");
      expect(index).toContain("- sendSms:");
    });

    it("should exclude loaded tools", () => {
      registry.load(["createPayment"]);
      const index = registry.buildToolIndex();

      expect(index).not.toContain("createPayment");
      expect(index).toContain("listCustomers");
    });
  });
});

// =============================================================================
// createToolRegistry Tests
// =============================================================================

describe("createToolRegistry", () => {
  it("should create a new ToolRegistry instance", () => {
    const registry = createToolRegistry();
    expect(registry).toBeInstanceOf(ToolRegistry);
  });

  it("should accept options", () => {
    const onToolsLoaded = vi.fn();
    const registry = createToolRegistry({ onToolsLoaded });

    registry.register({ name: "test", description: "Test" }, mockTools.createPayment);
    registry.load(["test"]);

    expect(onToolsLoaded).toHaveBeenCalled();
  });
});

// =============================================================================
// use_tools Meta-Tool Tests
// =============================================================================

describe("createUseToolsTool", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.registerPlugin("stripe", {
      createPayment: mockTools.createPayment,
      listCustomers: mockTools.listCustomers,
    });
    registry.registerPlugin("twilio", {
      sendSms: mockTools.sendSms,
      makeCall: mockTools.makeCall,
    });
  });

  it("should create a tool with description listing available tools", () => {
    const useToolsTool = createUseToolsTool({ registry });

    expect(useToolsTool.description).toContain("Available tools");
    expect(useToolsTool.description).toContain("createPayment");
    expect(useToolsTool.description).toContain("sendSms");
  });

  it("should load tools by explicit names", async () => {
    const useToolsTool = createUseToolsTool({ registry });
    const result = await useToolsTool.execute({
      tools: ["createPayment", "sendSms"],
    });

    expect(result.success).toBe(true);
    expect(result.loaded).toContain("createPayment");
    expect(result.loaded).toContain("sendSms");
    expect(result.message).toContain("Loaded 2 tool(s)");
  });

  it("should load tools by plugin name", async () => {
    const useToolsTool = createUseToolsTool({ registry });
    const result = await useToolsTool.execute({
      plugin: "stripe",
    });

    expect(result.success).toBe(true);
    expect(result.loaded).toContain("createPayment");
    expect(result.loaded).toContain("listCustomers");
  });

  it("should load tools by search query", async () => {
    const useToolsTool = createUseToolsTool({ registry });
    const result = await useToolsTool.execute({
      query: "payment",
    });

    expect(result.success).toBe(true);
    expect(result.loaded).toContain("createPayment");
  });

  it("should report already loaded tools", async () => {
    registry.load(["createPayment"]);
    const useToolsTool = createUseToolsTool({ registry });
    const result = await useToolsTool.execute({
      tools: ["createPayment", "listCustomers"],
    });

    expect(result.success).toBe(true);
    expect(result.loaded).toContain("listCustomers");
    expect(result.alreadyLoaded).toContain("createPayment");
  });

  it("should report not found tools", async () => {
    const useToolsTool = createUseToolsTool({ registry });
    const result = await useToolsTool.execute({
      tools: ["createPayment", "nonexistent"],
    });

    // success is false when any tools are not found (even if some loaded)
    expect(result.success).toBe(false);
    expect(result.loaded).toContain("createPayment");
    expect(result.notFound).toContain("nonexistent");
  });

  it("should return error when no parameters provided", async () => {
    const useToolsTool = createUseToolsTool({ registry });
    const result = await useToolsTool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toContain("specify tools");
  });

  it("should return error when no matching tools found", async () => {
    const useToolsTool = createUseToolsTool({ registry });
    const result = await useToolsTool.execute({
      query: "nonexistent",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No matching tools found");
  });

  it("should use custom description prefix", () => {
    const useToolsTool = createUseToolsTool({
      registry,
      descriptionPrefix: "Custom prefix.",
    });

    expect(useToolsTool.description).toContain("Custom prefix.");
  });

  it("should handle empty registry", () => {
    const emptyRegistry = new ToolRegistry();
    const useToolsTool = createUseToolsTool({ registry: emptyRegistry });

    expect(useToolsTool.description).toContain("No additional tools available");
  });

  it("should handle groupByPlugin option", () => {
    const useToolsWithGroups = createUseToolsTool({
      registry,
      groupByPlugin: true,
    });
    const useToolsFlat = createUseToolsTool({
      registry,
      groupByPlugin: false,
    });

    expect(useToolsWithGroups.description).toContain("[stripe]");
    expect(useToolsFlat.description).not.toContain("[stripe]");
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("ToolRegistry Integration", () => {
  it("should support typical workflow: register, search, load, use", async () => {
    const registry = new ToolRegistry();

    // 1. Register tools from plugins
    registry.registerPlugin("payments", {
      charge: createMockTool("charge", "Charge a customer"),
      refund: createMockTool("refund", "Process a refund"),
    });
    registry.registerPlugin("notifications", {
      email: createMockTool("email", "Send an email"),
      sms: createMockTool("sms", "Send SMS"),
    });

    expect(registry.size).toBe(4);
    expect(registry.loadedCount).toBe(0);

    // 2. Search for relevant tools
    const paymentTools = registry.search({ plugin: "payments" });
    expect(paymentTools.length).toBe(2);

    // 3. Load tools
    const loadResult = registry.load(paymentTools.map((t) => t.name));
    expect(loadResult.success).toBe(true);
    expect(loadResult.loaded).toEqual(["charge", "refund"]);

    // 4. Get loaded tools for use
    const activeTools = registry.getLoadedTools();
    expect(Object.keys(activeTools)).toEqual(["charge", "refund"]);

    // 5. Later, load more tools
    const moreResult = registry.loadMatching({ query: "email" });
    expect(moreResult.loaded).toEqual(["email"]);

    // 6. Verify final state
    expect(registry.loadedCount).toBe(3);
    expect(registry.listAvailable().length).toBe(1); // Only 'sms' left
  });

  it("should work with use_tools meta-tool in realistic scenario", async () => {
    const registry = new ToolRegistry();

    // Set up registry
    registry.registerPlugin("github", {
      createPR: createMockTool("createPR", "Create a pull request"),
      listIssues: createMockTool("listIssues", "List GitHub issues"),
    });
    registry.registerPlugin("jira", {
      createTicket: createMockTool("createTicket", "Create a Jira ticket"),
    });

    // Create the meta-tool
    const useTools = createUseToolsTool({ registry });

    // Simulate agent discovering it needs GitHub tools
    const result = await useTools.execute({ plugin: "github" });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Loaded 2 tool(s)");

    // Tools are now available
    const activeTools = registry.getLoadedTools();
    expect(activeTools).toHaveProperty("createPR");
    expect(activeTools).toHaveProperty("listIssues");
    expect(activeTools).not.toHaveProperty("createTicket");
  });
});
