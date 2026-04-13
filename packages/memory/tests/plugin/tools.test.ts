import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryTools, type MemoryTool } from "../../src/plugin/tools.js";
import { createInMemoryStore } from "../../src/store/in-memory.js";
import type { MemoryStore } from "../../src/store/types.js";

const encoder = new TextEncoder();

let store: MemoryStore;
let tools: MemoryTool[];

function tool(name: string): MemoryTool {
  const t = tools.find((t) => t.name === name);
  if (!t) throw new Error(`Tool "${name}" not found`);
  return t;
}

beforeEach(() => {
  store = createInMemoryStore();
  tools = createMemoryTools(store, { scope: "global" });
});

describe("remember", () => {
  it("saves a memory and returns confirmation", async () => {
    const result = await tool("remember").execute({
      name: "Test Memory",
      description: "A test memory for testing",
      type: "user",
      content: "This is the content",
    });

    expect(result).toContain("saved");
    expect(result).toContain("Test Memory");
  });

  it("saves with tags", async () => {
    const result = await tool("remember").execute({
      name: "Tagged Memory",
      description: "Memory with tags",
      type: "feedback",
      content: "Content here",
      tags: ["important", "testing"],
    });

    expect(result).toContain("saved");
  });

  it("rejects duplicate filenames", async () => {
    await tool("remember").execute({
      name: "Duplicate",
      description: "First instance",
      type: "user",
      content: "Content 1",
    });

    const result = await tool("remember").execute({
      name: "Duplicate",
      description: "Second instance",
      type: "user",
      content: "Content 2",
    });

    expect(result).toContain("Error");
    expect(result).toContain("already exists");
  });

  it("rejects invalid type", async () => {
    const result = await tool("remember").execute({
      name: "Bad Type",
      description: "Test",
      type: "invalid",
      content: "Content",
    });

    expect(result).toContain("Error");
    expect(result).toContain("invalid type");
  });

  it("rejects missing required fields", async () => {
    const result = await tool("remember").execute({
      name: "",
      description: "Test",
      type: "user",
      content: "Content",
    });

    expect(result).toContain("Error");
  });
});

describe("recall", () => {
  beforeEach(async () => {
    await tool("remember").execute({
      name: "TypeScript Preferences",
      description: "User prefers strict TypeScript",
      type: "user",
      content: "Always use strict mode and avoid any types",
    });

    await tool("remember").execute({
      name: "Testing Feedback",
      description: "Use vitest not jest",
      type: "feedback",
      content: "The user prefers vitest over jest for all testing",
    });
  });

  it("finds matching memories by query", async () => {
    const result = await tool("recall").execute({ query: "typescript strict" });

    expect(result).toContain("TypeScript Preferences");
    expect(result).toContain("strict");
  });

  it("returns no matches for irrelevant query", async () => {
    const result = await tool("recall").execute({ query: "python django" });

    expect(result).toContain("No memories found");
  });

  it("returns error for empty query", async () => {
    const result = await tool("recall").execute({ query: "" });

    expect(result).toContain("Error");
  });

  it("respects maxResults", async () => {
    const result = await tool("recall").execute({ query: "user", maxResults: 1 });

    // Should only contain one memory section
    const sectionCount = (result.match(/^## /gm) ?? []).length;
    expect(sectionCount).toBeLessThanOrEqual(1);
  });

  it("caps maxResults at 50", async () => {
    // Should not error with large maxResults
    const result = await tool("recall").execute({ query: "typescript", maxResults: 10000 });
    expect(result).not.toContain("Error");
  });

  it("returns no-memories for empty store", async () => {
    const emptyStore = createInMemoryStore();
    const emptyTools = createMemoryTools(emptyStore, { scope: "global" });
    const recallTool = emptyTools.find((t) => t.name === "recall")!;

    const result = await recallTool.execute({ query: "anything" });
    expect(result).toContain("No memories found");
  });
});

describe("forget", () => {
  beforeEach(async () => {
    await tool("remember").execute({
      name: "To Delete",
      description: "Memory to be deleted",
      type: "user",
      content: "This will be removed",
    });
  });

  it("removes a memory by filename", async () => {
    const result = await tool("forget").execute({ name: "user_to-delete.md" });

    expect(result).toContain("removed");
  });

  it("removes a memory by human-readable name", async () => {
    const result = await tool("forget").execute({ name: "To Delete" });

    expect(result).toContain("removed");
  });

  it("returns error for non-existent memory", async () => {
    const result = await tool("forget").execute({ name: "Does Not Exist" });

    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  it("returns error for empty name", async () => {
    const result = await tool("forget").execute({ name: "" });

    expect(result).toContain("Error");
  });

  it("memory is gone after forget", async () => {
    await tool("forget").execute({ name: "To Delete" });

    const result = await tool("recall").execute({ query: "delete" });
    expect(result).toContain("No memories found");
  });
});

describe("update_memory", () => {
  beforeEach(async () => {
    await tool("remember").execute({
      name: "Updatable",
      description: "Original description",
      type: "project",
      content: "Original content",
    });
  });

  it("updates content by filename", async () => {
    const result = await tool("update_memory").execute({
      name: "project_updatable.md",
      content: "Updated content",
    });

    expect(result).toContain("updated");
  });

  it("updates content by human-readable name", async () => {
    const result = await tool("update_memory").execute({
      name: "Updatable",
      content: "New content via name",
    });

    expect(result).toContain("updated");
  });

  it("updates description", async () => {
    const result = await tool("update_memory").execute({
      name: "Updatable",
      description: "New description",
    });

    expect(result).toContain("updated");
  });

  it("updates both content and description", async () => {
    const result = await tool("update_memory").execute({
      name: "Updatable",
      content: "Both updated",
      description: "Both updated desc",
    });

    expect(result).toContain("updated");
  });

  it("returns error when neither content nor description provided", async () => {
    const result = await tool("update_memory").execute({ name: "Updatable" });

    expect(result).toContain("Error");
    expect(result).toContain("at least one");
  });

  it("returns error for non-existent memory", async () => {
    const result = await tool("update_memory").execute({
      name: "Ghost",
      content: "Updated",
    });

    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  it("preserves original content when only description updated", async () => {
    await tool("update_memory").execute({
      name: "Updatable",
      description: "Just desc",
    });

    const recalled = await tool("recall").execute({ query: "original" });
    expect(recalled).toContain("Original content");
  });
});

describe("scoped tools", () => {
  it("writes to project scope directory", async () => {
    const projectTools = createMemoryTools(store, { scope: "project", projectSlug: "my-project" });
    const remember = projectTools.find((t) => t.name === "remember")!;

    const result = await remember.execute({
      name: "Project Note",
      description: "A project note",
      type: "project",
      content: "Project-specific content",
    });

    expect(result).toContain("saved");
  });

  it("writes to agent scope directory", async () => {
    const agentTools = createMemoryTools(store, { scope: "agent", agentId: "agent-1" });
    const remember = agentTools.find((t) => t.name === "remember")!;

    const result = await remember.execute({
      name: "Agent Note",
      description: "An agent note",
      type: "user",
      content: "Agent-specific content",
    });

    expect(result).toContain("saved");
  });
});
