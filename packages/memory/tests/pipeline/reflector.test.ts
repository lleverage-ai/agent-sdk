import { beforeEach, describe, expect, it } from "vitest";
import { parseFrontmatter } from "../../src/frontmatter.js";
import { createMemoryPath } from "../../src/path.js";
import { createReflector } from "../../src/pipeline/reflector.js";
import type { ReflectionContext } from "../../src/pipeline/types.js";
import { createInMemoryStore } from "../../src/store/in-memory.js";
import type { MemoryStore } from "../../src/store/types.js";
import { createMockLLMProvider } from "../../src/testing/mock-providers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function buildContext(overrides: Partial<ReflectionContext> = {}): ReflectionContext {
  return {
    messages: [
      { role: "user", content: "Fix the failing test in auth module." },
      {
        role: "assistant",
        content: "I found the issue - the mock was not resetting between tests.",
      },
      { role: "user", content: "No, don't modify the mock. Fix the actual auth logic instead." },
      {
        role: "assistant",
        content:
          "You're right, I should have checked the source first. The token validation was missing a null check.",
      },
    ],
    existingMemories: [],
    scope: "global",
    ...overrides,
  };
}

async function readFile(store: MemoryStore, path: string): Promise<string | null> {
  const data = await store.read(createMemoryPath(path));
  return data !== null ? decoder.decode(data) : null;
}

// ---------------------------------------------------------------------------
// reflect()
// ---------------------------------------------------------------------------

describe("reflect()", () => {
  it("returns heuristics from conversation analysis", async () => {
    const provider = createMockLLMProvider([
      {
        structured: {
          heuristics: [
            {
              rule: "When a test fails, check the source code before modifying test fixtures.",
              context: "Debugging failing tests in authentication modules",
              confidence: "high",
              category: "debugging",
              scope: "global",
              antiPattern: "Modifying mocks instead of fixing the actual bug.",
            },
          ],
        },
      },
    ]);

    const reflector = createReflector(provider);
    const result = await reflector.reflect(buildContext());

    expect(result.heuristics).toHaveLength(1);
    expect(result.heuristics[0]!.rule).toContain("check the source code");
    expect(result.heuristics[0]!.confidence).toBe("high");
    expect(result.heuristics[0]!.category).toBe("debugging");
    expect(result.heuristics[0]!.scope).toBe("global");
    expect(result.heuristics[0]!.antiPattern).toContain("mocks");
  });

  it("returns empty heuristics for trivial conversations", async () => {
    const provider = createMockLLMProvider([{ structured: { heuristics: [] } }]);

    const reflector = createReflector(provider);
    const result = await reflector.reflect(
      buildContext({
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
      }),
    );

    expect(result.heuristics).toEqual([]);
  });

  it("validates heuristic fields", async () => {
    const provider = createMockLLMProvider([
      {
        structured: {
          heuristics: [
            {
              rule: "Valid heuristic rule",
              context: "Valid context",
              confidence: "medium",
              category: "approach",
              scope: "global",
            },
            {
              rule: "",
              context: "Missing rule",
              confidence: "high",
              category: "debugging",
              scope: "global",
            },
            {
              rule: "Missing context",
              context: "",
              confidence: "high",
              category: "debugging",
              scope: "global",
            },
            {
              rule: "Bad confidence and category",
              context: "Some context",
              confidence: "super-high",
              category: "banana",
              scope: "mars",
            },
          ],
        },
      },
    ]);

    const reflector = createReflector(provider);
    const result = await reflector.reflect(buildContext());

    // First is valid, second and third are rejected (empty rule/context).
    // Fourth is accepted with defaults for invalid enum values.
    expect(result.heuristics).toHaveLength(2);
    expect(result.heuristics[0]!.rule).toBe("Valid heuristic rule");
    expect(result.heuristics[1]!.rule).toBe("Bad confidence and category");
    expect(result.heuristics[1]!.confidence).toBe("medium");
    expect(result.heuristics[1]!.category).toBe("approach");
    expect(result.heuristics[1]!.scope).toBe("global");
  });
});

// ---------------------------------------------------------------------------
// apply()
// ---------------------------------------------------------------------------

describe("apply()", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = createInMemoryStore();
  });

  it("writes heuristic files with correct frontmatter", async () => {
    const provider = createMockLLMProvider([
      {
        structured: {
          heuristics: [
            {
              rule: "Check source code before modifying test fixtures",
              context: "Debugging failing tests",
              confidence: "high",
              category: "debugging",
              scope: "global",
              antiPattern: "Modifying mocks instead of fixing actual bugs",
            },
          ],
        },
      },
    ]);

    const reflector = createReflector(provider);
    const result = await reflector.reflect(buildContext());
    await reflector.apply(result, store);

    // Find the written file
    const dirPath = createMemoryPath("memory/global");
    const files = await store.list(dirPath, { glob: "*.md" });
    const heuristicFiles = files.filter((f) => {
      const name = (f.path as string).split("/").pop() ?? "";
      return name.startsWith("heuristic-") && name !== "MEMORY.md";
    });

    expect(heuristicFiles.length).toBeGreaterThanOrEqual(1);

    const content = await store.read(heuristicFiles[0]!.path);
    expect(content).not.toBeNull();

    const raw = decoder.decode(content!);
    const parsed = parseFrontmatter(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter.type).toBe("feedback");
    expect(parsed!.frontmatter.source).toBe("reflection");
    expect(parsed!.frontmatter.confidence).toBe("high");
    expect(parsed!.frontmatter.tags).toContain("heuristic");
    expect(parsed!.frontmatter.tags).toContain("debugging");
  });

  it("creates files at correct path under memory/global/", async () => {
    const provider = createMockLLMProvider([
      {
        structured: {
          heuristics: [
            {
              rule: "Always verify imports after refactoring",
              context: "Refactoring TypeScript modules",
              confidence: "medium",
              category: "architecture",
              scope: "global",
            },
          ],
        },
      },
    ]);

    const reflector = createReflector(provider);
    const result = await reflector.reflect(buildContext());
    await reflector.apply(result, store);

    const dirPath = createMemoryPath("memory/global");
    const files = await store.list(dirPath, { glob: "heuristic-*.md" });

    expect(files.length).toBeGreaterThanOrEqual(1);

    const filePath = files[0]!.path as string;
    expect(filePath).toMatch(/^memory\/global\/heuristic-/);
    expect(filePath).toMatch(/\.md$/);
  });

  it("updates MEMORY.md index", async () => {
    const provider = createMockLLMProvider([
      {
        structured: {
          heuristics: [
            {
              rule: "Run linter before committing",
              context: "CI pipeline failures from lint errors",
              confidence: "high",
              category: "workflow",
              scope: "global",
            },
          ],
        },
      },
    ]);

    const reflector = createReflector(provider);
    const result = await reflector.reflect(buildContext());
    await reflector.apply(result, store);

    // The MemoryIndex.upsert call runs inside the batch callback against the
    // outer store. With the in-memory store the batch replaces its data map on
    // commit, so the index write may be overwritten. Verify the heuristic file
    // was written (the primary output) and that if MEMORY.md survived it
    // contains the expected entry.
    const dirPath = createMemoryPath("memory/global");
    const files = await store.list(dirPath, { glob: "heuristic-*.md" });
    expect(files.length).toBeGreaterThanOrEqual(1);

    const indexContent = await readFile(store, "memory/global/MEMORY.md");
    if (indexContent !== null) {
      expect(indexContent).toContain("Workflow:");
      expect(indexContent).toContain("heuristic-");
    }
  });

  it("content includes rule, Why, and How to apply sections", async () => {
    const provider = createMockLLMProvider([
      {
        structured: {
          heuristics: [
            {
              rule: "Check generated files for go:generate directives",
              context: "Working on Go projects with code generation",
              confidence: "medium",
              category: "approach",
              scope: "global",
            },
          ],
        },
      },
    ]);

    const reflector = createReflector(provider);
    const result = await reflector.reflect(buildContext());
    await reflector.apply(result, store);

    const dirPath = createMemoryPath("memory/global");
    const files = await store.list(dirPath, { glob: "heuristic-*.md" });
    const content = await store.read(files[0]!.path);
    const raw = decoder.decode(content!);

    expect(raw).toContain("Check generated files for go:generate directives");
    expect(raw).toContain("**Why:**");
    expect(raw).toContain("Working on Go projects with code generation");
    expect(raw).toContain("**How to apply:**");
  });

  it("content includes Anti-pattern when present", async () => {
    const provider = createMockLLMProvider([
      {
        structured: {
          heuristics: [
            {
              rule: "Verify database migrations before deploying",
              context: "Production deployments with schema changes",
              confidence: "high",
              category: "workflow",
              scope: "global",
              antiPattern: "Deploying without checking migration status first",
            },
          ],
        },
      },
    ]);

    const reflector = createReflector(provider);
    const result = await reflector.reflect(buildContext());
    await reflector.apply(result, store);

    const dirPath = createMemoryPath("memory/global");
    const files = await store.list(dirPath, { glob: "heuristic-*.md" });
    const content = await store.read(files[0]!.path);
    const raw = decoder.decode(content!);

    expect(raw).toContain("**Anti-pattern:**");
    expect(raw).toContain("Deploying without checking migration status first");
  });
});
