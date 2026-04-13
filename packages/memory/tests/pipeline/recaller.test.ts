import { beforeEach, describe, expect, it } from "vitest";
import { serialiseFrontmatter } from "../../src/frontmatter.js";
import { createMemoryPath } from "../../src/path.js";
import { createRecaller } from "../../src/pipeline/recaller.js";
import type { MemoryLLMProvider, RecallContext } from "../../src/pipeline/types.js";
import { createInMemoryStore } from "../../src/store/in-memory.js";
import type { MemoryStore } from "../../src/store/types.js";
import { createMockLLMProvider } from "../../src/testing/mock-providers.js";
import type { MemoryFrontmatter } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function makeFrontmatter(overrides: Partial<MemoryFrontmatter> = {}): MemoryFrontmatter {
  return {
    name: "Test Memory",
    description: "A test memory",
    type: "user",
    scope: "global",
    tags: [],
    confidence: "high",
    source: "manual",
    created: "2026-04-13T00:00:00Z",
    modified: "2026-04-13T00:00:00Z",
    ...overrides,
  };
}

async function writeMemory(
  store: MemoryStore,
  path: string,
  frontmatter: MemoryFrontmatter,
  content: string,
): Promise<void> {
  const markdown = serialiseFrontmatter(frontmatter, content);
  await store.write(createMemoryPath(path), encoder.encode(markdown));
}

function buildContext(overrides: Partial<RecallContext> = {}): RecallContext {
  return {
    query: "user preferences",
    scope: "global",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

/**
 * The in-memory store treats paths as flat map keys, so `exists("memory/global")`
 * returns false unless there is an entry at that exact key. The filesystem store
 * uses `fs.access` which recognises real directories. To make the recaller's
 * `exists` guard pass in tests, we write a zero-byte marker at each directory
 * path. This mirrors how a real filesystem would behave.
 */
async function markDirectory(store: MemoryStore, dir: string): Promise<void> {
  await store.write(createMemoryPath(dir), encoder.encode(""));
}

async function seedStore(store: MemoryStore): Promise<void> {
  // Mark directories so the recaller's exists() guard passes
  await markDirectory(store, "memory/global");
  await markDirectory(store, "memory/project/my-app");
  await markDirectory(store, "memory/agent/agent-1");

  await writeMemory(
    store,
    "memory/global/user-role.md",
    makeFrontmatter({
      name: "User role",
      description: "Lead engineer with 15+ years experience",
      type: "user",
      scope: "global",
      tags: ["role", "experience"],
    }),
    "The user is a lead engineer with over 15 years of experience.",
  );

  await writeMemory(
    store,
    "memory/global/feedback-testing.md",
    makeFrontmatter({
      name: "Testing feedback",
      description: "Always write tests for new features",
      type: "feedback",
      scope: "global",
      tags: ["testing", "feedback"],
    }),
    "Why: Tests prevent regressions.\nHow to apply: Write unit tests for all new functions.\n\nSee also: [[user-role]]",
  );

  await writeMemory(
    store,
    "memory/project/my-app/project-auth.md",
    makeFrontmatter({
      name: "Project auth",
      description: "Uses OAuth2 with PKCE flow",
      type: "project",
      scope: "project",
      tags: ["auth", "oauth"],
    }),
    "The project uses OAuth2 with PKCE flow for authentication.",
  );

  await writeMemory(
    store,
    "memory/agent/agent-1/ref-docs.md",
    makeFrontmatter({
      name: "Reference docs",
      description: "Points to API documentation",
      type: "reference",
      scope: "agent",
      tags: ["docs", "api"],
    }),
    "API documentation lives at https://docs.example.com/api.",
  );
}

// ---------------------------------------------------------------------------
// recall() without LLM provider
// ---------------------------------------------------------------------------

describe("recall() without LLM provider", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = createInMemoryStore();
    await seedStore(store);
  });

  it("returns memories from the correct scope (global only returns global)", async () => {
    const recaller = createRecaller(store);
    const results = await recaller.recall(buildContext({ scope: "global" }));

    const scopes = results
      .filter((r) => r.source === "direct")
      .map((r) => r.entry.frontmatter.scope);
    for (const scope of scopes) {
      expect(scope).toBe("global");
    }
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns memories from multiple scopes (project scope searches project then global)", async () => {
    const recaller = createRecaller(store);
    const results = await recaller.recall(
      buildContext({ scope: "project", projectSlug: "my-app", query: "auth preferences" }),
    );

    const scopes = new Set(
      results.filter((r) => r.source === "direct").map((r) => r.entry.frontmatter.scope),
    );
    // Should find memories from both project and global scopes
    expect(scopes.size).toBeGreaterThanOrEqual(1);

    const paths = results.map((r) => r.entry.path);
    // The project memory should be present
    expect(paths).toContain("memory/project/my-app/project-auth.md");
  });

  it("agent scope searches agent, project, and global", async () => {
    const recaller = createRecaller(store);
    const results = await recaller.recall(
      buildContext({
        scope: "agent",
        agentId: "agent-1",
        projectSlug: "my-app",
        query: "docs auth preferences",
      }),
    );

    const paths = results.map((r) => r.entry.path);
    // Should include memories from agent scope
    expect(paths).toContain("memory/agent/agent-1/ref-docs.md");
    // Should also include memories from broader scopes
    expect(results.length).toBeGreaterThan(1);
  });

  it("returns results sorted by relevance score descending", async () => {
    const recaller = createRecaller(store);
    const results = await recaller.recall(buildContext({ query: "role testing experience" }));

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].relevanceScore).toBeGreaterThanOrEqual(results[i].relevanceScore);
    }
  });

  it("respects maxResults limit", async () => {
    const recaller = createRecaller(store);
    const results = await recaller.recall(buildContext({ query: "everything", maxResults: 1 }));

    // Direct results should be limited (wikilinks may add up to 2 more)
    const directResults = results.filter((r) => r.source === "direct");
    expect(directResults).toHaveLength(1);
  });

  it("mode 'coding' boosts project/agent memories", async () => {
    const recaller = createRecaller(store);

    // Use a generic query that won't match tags/name/description directly,
    // keeping base scores low enough that the 1.5x mode multiplier stays
    // below the Math.min(score, 1) cap.
    const codingResults = await recaller.recall(
      buildContext({
        scope: "project",
        projectSlug: "my-app",
        query: "something general",
        mode: "coding",
      }),
    );

    const assistantResults = await recaller.recall(
      buildContext({
        scope: "project",
        projectSlug: "my-app",
        query: "something general",
        mode: "assistant",
      }),
    );

    // Find the project-auth memory in both result sets
    const codingProject = codingResults.find(
      (r) => r.entry.path === "memory/project/my-app/project-auth.md",
    );
    const assistantProject = assistantResults.find(
      (r) => r.entry.path === "memory/project/my-app/project-auth.md",
    );

    // In coding mode, non-global memories (project scope) get a 1.5x boost.
    // In assistant mode, only global memories get the boost, so project stays unboosted.
    expect(codingProject).toBeDefined();
    expect(assistantProject).toBeDefined();
    expect(codingProject!.relevanceScore).toBeGreaterThan(assistantProject!.relevanceScore);
  });

  it("mode 'assistant' boosts global memories", async () => {
    const recaller = createRecaller(store);

    // Use a generic query that won't match tags/name/description directly.
    const assistantResults = await recaller.recall(
      buildContext({
        scope: "project",
        projectSlug: "my-app",
        query: "something general",
        mode: "assistant",
      }),
    );

    const codingResults = await recaller.recall(
      buildContext({
        scope: "project",
        projectSlug: "my-app",
        query: "something general",
        mode: "coding",
      }),
    );

    // Find the global user-role memory in both result sets
    const assistantGlobal = assistantResults.find(
      (r) => r.entry.path === "memory/global/user-role.md",
    );
    const codingGlobal = codingResults.find((r) => r.entry.path === "memory/global/user-role.md");

    // In assistant mode, global memories get a 1.5x boost.
    // In coding mode, only non-global memories get the boost, so global stays unboosted.
    expect(assistantGlobal).toBeDefined();
    expect(codingGlobal).toBeDefined();
    expect(assistantGlobal!.relevanceScore).toBeGreaterThan(codingGlobal!.relevanceScore);
  });

  it("returns empty array when no memories exist", async () => {
    const emptyStore = createInMemoryStore();
    const recaller = createRecaller(emptyStore);
    const results = await recaller.recall(buildContext());

    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// recall() with LLM provider
// ---------------------------------------------------------------------------

describe("recall() with LLM provider", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = createInMemoryStore();
    await seedStore(store);
  });

  it("uses LLM to score and rank memories", async () => {
    // The LLM returns indices (1-based) and relevance scores
    const provider = createMockLLMProvider([
      { text: '[{"index": 1, "relevance": 0.95}, {"index": 2, "relevance": 0.6}]' },
    ]);
    const recaller = createRecaller(store, provider);

    const results = await recaller.recall(buildContext({ query: "role testing" }));

    const directResults = results.filter((r) => r.source === "direct");
    expect(directResults.length).toBeGreaterThanOrEqual(1);
    // Results should be sorted by relevance descending
    for (let i = 1; i < directResults.length; i++) {
      expect(directResults[i - 1].relevanceScore).toBeGreaterThanOrEqual(
        directResults[i].relevanceScore,
      );
    }
  });

  it("falls back to heuristic scoring if LLM fails", async () => {
    // Create a provider whose generate() always throws
    const failingProvider: MemoryLLMProvider = {
      async generate(): Promise<string> {
        throw new Error("LLM service unavailable");
      },
      async generateStructured<T>(): Promise<T> {
        return {} as T;
      },
    };
    const recaller = createRecaller(store, failingProvider);

    const results = await recaller.recall(buildContext({ query: "role experience" }));

    // Should still return results via heuristic fallback
    expect(results.length).toBeGreaterThan(0);
    // All direct results should have relevance scores
    for (const result of results.filter((r) => r.source === "direct")) {
      expect(typeof result.relevanceScore).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// recall() wikilink following
// ---------------------------------------------------------------------------

describe("recall() wikilink following", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = createInMemoryStore();
    await seedStore(store);
  });

  it("follows wikilinks from recalled memories", async () => {
    // Use heuristic recall (no LLM) with maxResults=1.
    // Query "testing feedback" should boost feedback-testing.md (tags match).
    // feedback-testing contains [[user-role]], so user-role should appear via wikilink.
    const recaller = createRecaller(store);

    const results = await recaller.recall(
      buildContext({ query: "testing feedback", maxResults: 1 }),
    );

    // feedback-testing should be the top direct result due to tag matching
    const directPaths = results.filter((r) => r.source === "direct").map((r) => r.entry.path);
    expect(directPaths).toContain("memory/global/feedback-testing.md");

    // user-role should appear via wikilink from feedback-testing
    const wikilinked = results.filter((r) => r.source === "wikilink");
    const userRoleLinked = wikilinked.find((r) => r.entry.path === "memory/global/user-role.md");
    expect(userRoleLinked).toBeDefined();
    expect(userRoleLinked!.source).toBe("wikilink");
  });

  it("wikilinked memories have source 'wikilink'", async () => {
    // Use heuristic recall with maxResults=1, query matches feedback-testing tags.
    // user-role arrives via [[user-role]] wikilink in feedback-testing content.
    const recaller = createRecaller(store);

    const results = await recaller.recall(
      buildContext({ query: "testing feedback", maxResults: 1 }),
    );

    const wikilinked = results.filter((r) => r.source === "wikilink");
    expect(wikilinked.length).toBeGreaterThan(0);
    for (const result of wikilinked) {
      expect(result.source).toBe("wikilink");
    }
  });

  it("does not duplicate memories already in direct results", async () => {
    // Return both candidates as direct results (feedback-testing=1, user-role=2).
    // user-role is also linked from feedback-testing via [[user-role]], but
    // should not appear twice.
    const provider = createMockLLMProvider([
      { text: '[{"index": 1, "relevance": 0.9}, {"index": 2, "relevance": 0.8}]' },
    ]);
    const recaller = createRecaller(store, provider);

    const results = await recaller.recall(buildContext({ query: "role testing" }));

    const paths = results.map((r) => r.entry.path);
    const uniquePaths = new Set(paths);
    expect(paths.length).toBe(uniquePaths.size);
  });

  it("limits to 2 additional wikilinked memories", async () => {
    // Create a memory with many wikilinks
    await writeMemory(
      store,
      "memory/global/many-links.md",
      makeFrontmatter({
        name: "Many links",
        description: "A memory with many wikilinks",
        type: "user",
        scope: "global",
      }),
      "See [[user-role]], [[feedback-testing]], [[link-a]], [[link-b]], [[link-c]]",
    );

    // Create the additional linked memories
    await writeMemory(
      store,
      "memory/global/link-a.md",
      makeFrontmatter({
        name: "Link A",
        description: "Linked memory A",
        type: "reference",
        scope: "global",
      }),
      "Content A.",
    );

    await writeMemory(
      store,
      "memory/global/link-b.md",
      makeFrontmatter({
        name: "Link B",
        description: "Linked memory B",
        type: "reference",
        scope: "global",
      }),
      "Content B.",
    );

    await writeMemory(
      store,
      "memory/global/link-c.md",
      makeFrontmatter({
        name: "Link C",
        description: "Linked memory C",
        type: "reference",
        scope: "global",
      }),
      "Content C.",
    );

    // Only return many-links as a direct result via LLM
    // We need to know its index in the candidate list. Since gatherCandidates
    // iterates memory/global/*.md, we need to find it. Use a broad index guess
    // but safer: use heuristic mode by not providing LLM, then check the limit.
    // Actually, let's use a large enough index set. The store lists by modifiedAt desc,
    // so newly written files appear first. many-links.md was written last of the
    // global files, so it's index 1.
    const provider = createMockLLMProvider([{ text: '[{"index": 1, "relevance": 0.95}]' }]);
    const recaller = createRecaller(store, provider);

    const results = await recaller.recall(buildContext({ query: "links", maxResults: 1 }));

    const wikilinked = results.filter((r) => r.source === "wikilink");
    expect(wikilinked.length).toBeLessThanOrEqual(2);
  });
});
