import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryPath } from "../../src/path.js";
import { createBM25Index } from "../../src/search/bm25.js";
import type { IndexEntry, SearchIndex } from "../../src/search/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<IndexEntry> & { path: string }): IndexEntry {
  return {
    path: createMemoryPath(overrides.path),
    title: overrides.title ?? "",
    description: overrides.description ?? "",
    tags: overrides.tags ?? [],
    content: overrides.content ?? "",
    scope: overrides.scope ?? "global",
    projectSlug: overrides.projectSlug,
    agentId: overrides.agentId,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTRIES: IndexEntry[] = [
  makeEntry({
    path: "memory/global/deployment-guide.md",
    title: "Kubernetes Deployment Guide",
    description: "Step-by-step guide for deploying services to Kubernetes",
    tags: ["kubernetes", "deployment", "infrastructure"],
    content: "Use kubectl apply to deploy manifests. Configure resource limits and health checks.",
    scope: "global",
  }),
  makeEntry({
    path: "memory/project/api-design.md",
    title: "REST API Design Patterns",
    description: "Best practices for designing RESTful APIs",
    tags: ["api", "rest", "design"],
    content:
      "Use proper HTTP methods. Return appropriate status codes. Version your API endpoints.",
    scope: "project",
    projectSlug: "platform",
  }),
  makeEntry({
    path: "memory/project/database-schema.md",
    title: "Database Schema Conventions",
    description: "Naming and structure conventions for PostgreSQL schemas",
    tags: ["database", "postgresql", "schema"],
    content: "Use snake_case for columns. Add created_at and updated_at timestamps to every table.",
    scope: "project",
    projectSlug: "billing",
  }),
  makeEntry({
    path: "memory/agent/testing-strategy.md",
    title: "Testing Strategy",
    description: "Approach to unit and integration testing",
    tags: ["testing", "vitest", "coverage"],
    content:
      "Write unit tests for pure functions. Use integration tests for API routes. Aim for 80% coverage.",
    scope: "agent",
    agentId: "agent-001",
  }),
  makeEntry({
    path: "memory/global/error-handling.md",
    title: "Error Handling Patterns",
    description: "Consistent error handling across the codebase",
    tags: ["errors", "typescript", "patterns"],
    content:
      "Use discriminated unions for error types. Always catch async errors. Log with structured metadata.",
    scope: "global",
  }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createBM25Index", () => {
  let index: SearchIndex;

  beforeEach(async () => {
    index = createBM25Index();
    await index.index(ENTRIES);
  });

  it("finds entries by title (high weight term)", async () => {
    const results = await index.search("Kubernetes");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toBe("memory/global/deployment-guide.md");
  });

  it("finds entries by content", async () => {
    const results = await index.search("kubectl");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toBe("memory/global/deployment-guide.md");
  });

  it("finds entries by tags", async () => {
    const results = await index.search("vitest");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toBe("memory/agent/testing-strategy.md");
  });

  it("returns results sorted by score descending", async () => {
    const results = await index.search("deployment");
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
    }
  });

  it("respects limit option", async () => {
    const results = await index.search("testing deployment error", { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("filters by scope", async () => {
    const results = await index.search("design patterns", { scope: "project" });
    for (const r of results) {
      const entry = ENTRIES.find((e) => (e.path as string) === r.path);
      expect(entry?.scope).toBe("project");
    }
  });

  it("filters by projectSlug", async () => {
    const results = await index.search("schema conventions", {
      projectSlug: "billing",
    });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const entry = ENTRIES.find((e) => (e.path as string) === r.path);
      expect(entry?.projectSlug).toBe("billing");
    }
  });

  it("removes entries from the index", async () => {
    const beforeResults = await index.search("Kubernetes");
    expect(beforeResults.length).toBeGreaterThan(0);

    await index.remove([createMemoryPath("memory/global/deployment-guide.md")]);

    const afterResults = await index.search("Kubernetes");
    expect(afterResults.length).toBe(0);
  });

  it("re-indexing replaces existing entries", async () => {
    const updated = makeEntry({
      path: "memory/global/deployment-guide.md",
      title: "Terraform Infrastructure Guide",
      description: "Guide for managing infrastructure with Terraform",
      tags: ["terraform", "infrastructure"],
      content: "Use terraform plan before apply. Keep state files remote.",
      scope: "global",
    });

    await index.index([updated]);

    const kubeResults = await index.search("Kubernetes");
    const kubeMatch = kubeResults.find((r) => r.path === "memory/global/deployment-guide.md");
    expect(kubeMatch).toBeUndefined();

    const terraformResults = await index.search("Terraform");
    expect(terraformResults.length).toBeGreaterThan(0);
    expect(terraformResults[0]!.path).toBe("memory/global/deployment-guide.md");
  });

  it("returns empty for no matches", async () => {
    const results = await index.search("xylophoneZeppelin");
    expect(results).toEqual([]);
  });

  it("multi-word queries score better on multi-term matches", async () => {
    const results = await index.search("database schema conventions");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toBe("memory/project/database-schema.md");
  });

  it("field weighting: title match scores higher than content-only match", async () => {
    const titleEntry = makeEntry({
      path: "memory/global/typescript-guide.md",
      title: "TypeScript Configuration",
      description: "How to configure TypeScript projects",
      tags: ["config"],
      content: "Some generic content about project setup.",
      scope: "global",
    });

    const contentEntry = makeEntry({
      path: "memory/global/misc-notes.md",
      title: "Miscellaneous Notes",
      description: "Various development notes",
      tags: ["notes"],
      content: "TypeScript is a typed superset of JavaScript.",
      scope: "global",
    });

    const freshIndex = createBM25Index();
    await freshIndex.index([titleEntry, contentEntry]);

    const results = await freshIndex.search("TypeScript");
    expect(results.length).toBe(2);
    expect(results[0]!.path).toBe("memory/global/typescript-guide.md");
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });
});
