import { beforeEach, describe, expect, it } from "vitest";
import { serialiseFrontmatter } from "../../src/frontmatter.js";
import { createMemoryPath } from "../../src/path.js";
import { createMemoryPlugin } from "../../src/plugin/index.js";
import { formatMemoryPolicy, formatMemorySection } from "../../src/plugin/prompt-components.js";
import { createInMemoryStore } from "../../src/store/in-memory.js";
import type { MemoryStore } from "../../src/store/types.js";
import { createMockLLMProvider } from "../../src/testing/mock-providers.js";
import type { MemoryFrontmatter } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeFrontmatter(overrides: Partial<MemoryFrontmatter> = {}): MemoryFrontmatter {
  return {
    name: "Test Memory",
    description: "A test memory",
    type: "user",
    scope: "global",
    tags: [],
    confidence: "high",
    source: "manual",
    created: "2026-04-01T00:00:00Z",
    modified: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

async function seedMemory(
  store: MemoryStore,
  path: string,
  frontmatter: MemoryFrontmatter,
  content: string,
): Promise<void> {
  const markdown = serialiseFrontmatter(frontmatter, content);
  await store.write(createMemoryPath(path), encoder.encode(markdown));
}

async function readFile(store: MemoryStore, path: string): Promise<string | null> {
  const data = await store.read(createMemoryPath(path));
  return data !== null ? decoder.decode(data) : null;
}

/**
 * The in-memory store treats paths as flat map keys, so `exists("memory/global")`
 * returns false unless there is an entry at that exact key. Write a zero-byte
 * marker at each directory path to make the recaller's exists() guard pass.
 */
async function markDirectory(store: MemoryStore, dir: string): Promise<void> {
  await store.write(createMemoryPath(dir), encoder.encode(""));
}

// ---------------------------------------------------------------------------
// onBeforeGenerate
// ---------------------------------------------------------------------------

describe("onBeforeGenerate", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = createInMemoryStore();
  });

  it("returns empty memories section when store has no memories", async () => {
    const plugin = createMemoryPlugin({ store });

    const result = await plugin.onBeforeGenerate({
      messages: [{ role: "user", content: "Hello there" }],
    });

    expect(result.systemPromptSection).toBe("");
    expect(result.memories).toEqual([]);
  });

  it("returns recalled memories formatted as system prompt section", async () => {
    await markDirectory(store, "memory/global");

    await seedMemory(
      store,
      "memory/global/user_british-english.md",
      makeFrontmatter({
        name: "British English",
        description: "User prefers British English",
        tags: ["english", "preferences"],
      }),
      "Always use British English spelling and grammar.",
    );

    const plugin = createMemoryPlugin({ store });

    const result = await plugin.onBeforeGenerate({
      messages: [{ role: "user", content: "What English spelling should I use in my code?" }],
    });

    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.systemPromptSection).toContain("British English");
    expect(result.systemPromptSection).toContain("Recalled Memories");
  });

  it("passes query from last user message to recaller", async () => {
    await markDirectory(store, "memory/global");

    await seedMemory(
      store,
      "memory/global/user_typescript.md",
      makeFrontmatter({
        name: "TypeScript preference",
        description: "User prefers TypeScript over JavaScript",
        tags: ["typescript"],
      }),
      "The user prefers TypeScript for all projects.",
    );

    const plugin = createMemoryPlugin({ store });

    // The last user message should be used as the recall query.
    // "typescript" appears in the memory, so it should match.
    const result = await plugin.onBeforeGenerate({
      messages: [
        { role: "user", content: "Can you help me with Python?" },
        { role: "assistant", content: "Sure!" },
        { role: "user", content: "Actually, tell me about typescript preferences" },
      ],
    });

    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.memories[0]!.entry.frontmatter.name).toBe("TypeScript preference");
  });
});

// ---------------------------------------------------------------------------
// onAfterGenerate
// ---------------------------------------------------------------------------

describe("onAfterGenerate", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = createInMemoryStore();
  });

  it("extracts and persists memories from conversation", async () => {
    const provider = createMockLLMProvider([
      {
        structured: {
          candidates: [
            {
              action: "create",
              filename: "user_likes-tea.md",
              name: "Likes tea",
              description: "User prefers tea over coffee",
              type: "user",
              scope: "global",
              content: "The user always drinks tea.",
              indexEntry: "- [Likes tea](user_likes-tea.md) - User prefers tea over coffee",
              confidence: "high",
            },
          ],
        },
      },
    ]);

    const plugin = createMemoryPlugin({
      store,
      llmProvider: provider,
    });

    await plugin.onAfterGenerate({
      messages: [
        { role: "user", content: "I always drink tea, never coffee." },
        { role: "assistant", content: "Noted, tea it is!" },
      ],
    });

    const content = await readFile(store, "memory/global/user_likes-tea.md");
    expect(content).not.toBeNull();
    expect(content).toContain("Likes tea");
    expect(content).toContain("The user always drinks tea.");
  });

  it("does nothing when extraction is disabled", async () => {
    const provider = createMockLLMProvider([
      {
        structured: {
          candidates: [
            {
              action: "create",
              filename: "should-not-exist.md",
              name: "X",
              description: "Y",
              type: "user",
              scope: "global",
              content: "Z",
              indexEntry: "x",
              confidence: "high",
            },
          ],
        },
      },
    ]);

    const plugin = createMemoryPlugin({
      store,
      llmProvider: provider,
      extraction: { enabled: false },
    });

    const events: string[] = [];
    store.subscribe((event) => {
      events.push(event.type);
    });

    await plugin.onAfterGenerate({
      messages: [
        { role: "user", content: "Remember this" },
        { role: "assistant", content: "OK" },
      ],
    });

    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// onSessionEnd
// ---------------------------------------------------------------------------

describe("onSessionEnd", () => {
  it("does not throw", async () => {
    const store = createInMemoryStore();
    const plugin = createMemoryPlugin({ store });

    await expect(
      plugin.onSessionEnd({
        messages: [
          { role: "user", content: "Bye" },
          { role: "assistant", content: "See you!" },
        ],
      }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

describe("tools", () => {
  it("exposes memory tools (remember, recall, forget, update_memory)", () => {
    const store = createInMemoryStore();
    const plugin = createMemoryPlugin({ store });

    const toolNames = plugin.tools.map((t) => t.name);
    expect(toolNames).toContain("remember");
    expect(toolNames).toContain("recall");
    expect(toolNames).toContain("forget");
    expect(toolNames).toContain("update_memory");
    expect(plugin.tools).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// formatMemorySection
// ---------------------------------------------------------------------------

describe("formatMemorySection", () => {
  it("formats surfaced memories with headings and content", () => {
    const memories = [
      {
        entry: {
          path: "memory/global/user_british-english.md",
          frontmatter: makeFrontmatter({
            name: "British English",
            description: "User prefers British English",
          }),
          content: "Always use British English.",
          indexEntry: "- [British English](user_british-english.md) - User prefers British English",
        },
        relevanceScore: 0.9,
        source: "direct" as const,
      },
    ];

    const result = formatMemorySection(memories);

    expect(result).toContain("# Recalled Memories");
    expect(result).toContain("## British English (user, global)");
    expect(result).toContain("Always use British English.");
  });

  it("returns empty string for empty memories array", () => {
    const result = formatMemorySection([]);
    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// formatMemoryPolicy
// ---------------------------------------------------------------------------

describe("formatMemoryPolicy", () => {
  it("returns non-empty policy string containing key terms", () => {
    const policy = formatMemoryPolicy();

    expect(policy.length).toBeGreaterThan(0);
    expect(policy).toContain("Memory Policy");
    expect(policy).toContain("user");
    expect(policy).toContain("feedback");
    expect(policy).toContain("project");
    expect(policy).toContain("reference");
    expect(policy).toContain("kebab-case");
  });
});
