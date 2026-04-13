# @lleverage-ai/memory

Persistent memory system for AI agents - extraction, recall, retrieval, and consolidation.

`@lleverage-ai/memory` gives agents the ability to learn from conversations, remember what matters, and recall it when relevant. It's standalone with zero dependency on `@lleverage-ai/agent-sdk`, but integrates cleanly via the plugin system when you want it to.

If you want to build agents, start with `@lleverage-ai/agent-sdk`. Add `@lleverage-ai/memory` when your agents need to remember things across sessions.

## Installation

```bash
bun add @lleverage-ai/memory
```

## Overview

The package provides a complete memory lifecycle:

- **Store** - pluggable storage backends (filesystem, git-backed, in-memory) behind a single `MemoryStore` interface
- **Extraction** - after each conversation turn, an LLM analyses the exchange and proposes new memories
- **Recall** - before each turn, relevant memories are surfaced using hybrid search and injected into the prompt
- **Reflection** - after sessions, generalisable heuristics and anti-patterns are extracted
- **Consolidation** - periodic maintenance: deduplication, staleness detection, confidence reinforcement
- **Search** - hybrid BM25 + vector retrieval with RRF fusion, query parsing, and trigram fuzzy fallback

## Sub-path Exports

| Export | Description |
|--------|-------------|
| `@lleverage-ai/memory` | Full API (store, pipeline, plugin, search) |
| `@lleverage-ai/memory/search` | Search-only API (BM25, vector, hybrid, trigram) |
| `@lleverage-ai/memory/testing` | Test utilities (contract suite, mock providers) |

## Quick Start

### Basic Usage (No LLM Required)

```typescript
import {
  createFilesystemStore,
  createMemoryPath,
  serialiseFrontmatter,
} from "@lleverage-ai/memory";

const store = createFilesystemStore({ root: "./memory" });
const encoder = new TextEncoder();

// Write a memory
const content = serialiseFrontmatter(
  {
    name: "user role",
    description: "Senior engineer working on infrastructure",
    type: "user",
    scope: "global",
    tags: ["role"],
    confidence: "high",
    source: "manual",
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
  },
  "The user is a senior infrastructure engineer with 15+ years experience.",
);

await store.write(
  createMemoryPath("memory/global/user-role.md"),
  encoder.encode(content),
);

// Read it back
const data = await store.read(createMemoryPath("memory/global/user-role.md"));
```

### With LLM-Powered Extraction and Recall

```typescript
import {
  createFilesystemStore,
  createExtractor,
  createRecaller,
} from "@lleverage-ai/memory";

const store = createFilesystemStore({ root: "./memory" });

// Bring your own LLM - any provider that implements this interface
const llm = {
  generate: async (prompt, options) => {
    // Wrap your preferred LLM (OpenAI, Anthropic, Ollama, etc.)
    return await myLLM.complete(prompt);
  },
  generateStructured: async (prompt, schema, options) => {
    return await myLLM.completeJSON(prompt, schema);
  },
};

// Extract memories from a conversation
const extractor = createExtractor(llm);
const result = await extractor.extract({
  messages: [
    { role: "user", content: "I prefer TypeScript with strict mode" },
    { role: "assistant", content: "Noted, I'll use strict TypeScript." },
  ],
  existingMemories: [],
  scope: "global",
  currentDate: new Date().toISOString(),
});

// Persist extracted memories
await extractor.apply(result, store);

// Recall relevant memories before the next turn
const recaller = createRecaller(store, llm);
const memories = await recaller.recall({
  query: "What language preferences does the user have?",
  scope: "global",
});

for (const mem of memories) {
  console.log(`[${mem.source}] ${mem.entry.frontmatter.name}: ${mem.entry.content}`);
}
```

### Plugin (Agent SDK Integration)

```typescript
import { createMemoryPlugin, createFilesystemStore } from "@lleverage-ai/memory";

const memory = createMemoryPlugin({
  store: createFilesystemStore({ root: "./memory" }),
  llmProvider: myLLMAdapter,
  extraction: { enabled: true },
  recall: { enabled: true, maxResults: 5 },
  scope: "project",
  projectSlug: "my-app",
});

// Hook into agent lifecycle
const recalled = await memory.onBeforeGenerate({
  messages: conversation,
});
// recalled.systemPromptSection -> inject into system prompt
// recalled.memories -> raw SurfacedMemory objects

await memory.onAfterGenerate({ messages: conversation });
// Memories extracted and persisted

// Direct tool access
const tools = memory.tools;
// [remember, recall, forget, update_memory]
```

## Memory Types

Memories are categorised into four types:

| Type | Purpose | Example |
|------|---------|---------|
| `user` | Who the user is, their preferences, role | "Senior engineer, prefers terse responses" |
| `feedback` | Corrections and confirmed approaches | "Don't mock the database in integration tests" |
| `project` | Ongoing work context, decisions, goals | "Auth migration driven by compliance, not tech debt" |
| `reference` | Pointers to external resources | "Pipeline bugs tracked in Linear project INGEST" |

## Memory Scopes

| Scope | Path | Use Case |
|-------|------|----------|
| `global` | `memory/global/` | Cross-project preferences and knowledge |
| `project` | `memory/project/{slug}/` | Project-specific context |
| `agent` | `memory/agent/{id}/` | Per-agent isolation |

## Storage Backends

### Filesystem (Default)

```typescript
import { createFilesystemStore } from "@lleverage-ai/memory";

const store = createFilesystemStore({ root: "~/.my-agent/memory" });
```

Atomic writes using temp file + fsync + rename. Creates directories as needed.

### Git-Backed

```typescript
import { createGitStore } from "@lleverage-ai/memory";

const store = await createGitStore({
  root: "~/.my-agent/memory",
  autoPush: true,
  author: "My Agent",
  email: "agent@example.com",
});
```

Every mutation becomes a git commit. Auto-push with non-fast-forward retry. Pulls on startup. Every batch gets a commit message like `[extract] Saved 3 memories from conversation`.

### Autodetect

```typescript
import { createAutodetectedStore } from "@lleverage-ai/memory";

// Uses GitStore if .git exists, FilesystemStore otherwise
const store = await createAutodetectedStore({ root: "~/.my-agent/memory" });
```

### In-Memory (Testing)

```typescript
import { createInMemoryStore } from "@lleverage-ai/memory";

const store = createInMemoryStore();
```

### Custom Backend

Implement the `MemoryStore` interface for any storage backend (PostgreSQL, S3, etc.):

```typescript
import type { MemoryStore } from "@lleverage-ai/memory";

const myStore: MemoryStore = {
  read: async (path) => { /* ... */ },
  write: async (path, content) => { /* ... */ },
  // ... all methods
};
```

Use the contract test suite to validate your implementation:

```typescript
import { runStoreContract } from "@lleverage-ai/memory/testing";

runStoreContract("MyCustomStore", () => createMyStore());
// Runs 30 tests covering read/write/batch/events/listing
```

## Search

The search module provides a full retrieval stack:

```typescript
import {
  createBM25Index,
  createInMemoryVectorIndex,
  createHybridSearch,
  createTrigramIndex,
} from "@lleverage-ai/memory/search";
```

### BM25

In-process full-text search with Porter stemming, stop word removal, and field weighting (title 10x, description 5x, tags 4x, content 1x).

```typescript
const index = createBM25Index();
await index.index(entries);
const results = await index.search("kubernetes deployment");
```

### Vector Search

Cosine similarity over Float32Array embeddings. Bring your own embedding provider:

```typescript
const vectorIndex = createInMemoryVectorIndex();
await vectorIndex.upsert(path, embedding, { title, description, scope });
const results = await vectorIndex.search(queryEmbedding, { limit: 10 });
```

### Hybrid (RRF Fusion)

Combines BM25 and vector search using Reciprocal Rank Fusion (k=60). Optional LLM reranking with unanimity shortcut.

```typescript
const hybrid = createHybridSearch({
  bm25: index,
  vector: vectorIndex,
  embedder: myEmbeddingProvider,
  reranker: myLLMProvider, // optional
});

const { results, trace } = await hybrid.searchWithTrace("deployment config");
// trace includes per-stage timing, candidate lists, and rerank decisions
```

### Trigram Fuzzy Fallback

Jaccard similarity over character trigrams for fuzzy matching when BM25 returns nothing:

```typescript
const trigram = createTrigramIndex();
trigram.index(entries.map((e) => ({ path: e.path, title: e.title })));
const fuzzy = trigram.search("kuberntes"); // typo-tolerant
```

## Wikilinks

Memories can reference each other with `[[wikilink]]` syntax:

```markdown
---
name: testing feedback
type: feedback
---
Always write tests. See also: [[user-role]] for context on their experience level.
```

During recall, wikilinks are resolved and linked memories are included (up to 2 additional) with source `"wikilink"`.

Variants: `[[topic]]`, `[[global:topic]]` (force global scope), `[[topic|Display Text]]`.

## Reflection and Consolidation

### Reflection (Post-Session)

Extracts generalisable heuristics from completed sessions:

```typescript
import { createReflector } from "@lleverage-ai/memory";

const reflector = createReflector(llmProvider);
const result = await reflector.reflect({
  messages: sessionMessages,
  existingMemories: currentMemories,
  scope: "global",
});

await reflector.apply(result, store);
// Creates feedback-type memories with confidence tracking
```

### Consolidation (Maintenance)

Periodic maintenance to keep memory healthy:

```typescript
import { createConsolidator } from "@lleverage-ai/memory";

const consolidator = createConsolidator(llmProvider);
const report = await consolidator.consolidate(store, {
  stalenessThresholdDays: 90,
  llmDedup: true,
  promotionClusterSize: 5,
});

console.log(report);
// { indexRebuilt: true, staleMemories: [...], duplicatesResolved: 2, ... }
```

Operations: index rebuild, staleness detection, trigram-based deduplication with LLM verdicts (keep/merge/distinct), heuristic confidence reinforcement.

## Provider Interfaces

The package never imports an LLM or embedding SDK. You provide adapters:

```typescript
import type { MemoryLLMProvider, MemoryEmbeddingProvider } from "@lleverage-ai/memory";

// Any LLM
const llm: MemoryLLMProvider = {
  generate: (prompt, opts) => callMyLLM(prompt, opts),
  generateStructured: (prompt, schema, opts) => callMyLLMWithSchema(prompt, schema, opts),
};

// Any embedding model
const embedder: MemoryEmbeddingProvider = {
  embed: (texts) => callMyEmbedder(texts),
  dimensions: 1024,
  model: "bge-m3",
};
```

## File Format

Memory entries are markdown files with YAML frontmatter:

```markdown
---
name: testing feedback
description: Always write tests for new features
type: feedback
scope: global
tags: [testing, quality]
confidence: high
source: extraction
created: 2026-04-13T10:00:00Z
modified: 2026-04-13T10:00:00Z
---

Always write tests for new features.

**Why:** Tests prevent regressions. A mocked test passed last quarter but the prod migration failed.

**How to apply:** Write unit tests for all new functions. Prefer integration tests for database operations.
```

Each scope directory has a `MEMORY.md` index:

```markdown
- [Testing feedback](feedback-testing.md) - Always write tests for new features
- [User role](user-role.md) - Senior engineer with 15+ years experience
```

## License

MIT
