/**
 * Memory plugin for agent-sdk lifecycle integration.
 *
 * This module does NOT import from @lleverage-ai/agent-sdk. It defines its
 * own minimal context types so the memory package stays standalone.
 *
 * @module
 */

import { parseMemoryFile } from "../frontmatter.js";
import { createMemoryPath, scopeDirectory } from "../path.js";
import { createExtractor } from "../pipeline/extractor.js";
import { createRecaller } from "../pipeline/recaller.js";
import { createReflector } from "../pipeline/reflector.js";
import type {
  Extractor,
  MemoryLLMProvider,
  Recaller,
  SurfacedMemory,
} from "../pipeline/types.js";
import type { MemoryPath, MemoryStore } from "../store/types.js";
import type { MemoryEntry, MemoryScope, Message } from "../types.js";
import { formatMemorySection } from "./prompt-components.js";
import { createMemoryTools, type MemoryTool, type ToolScopeState } from "./tools.js";

// ---------------------------------------------------------------------------
// Context types (standalone - no agent-sdk imports)
// ---------------------------------------------------------------------------

export interface BeforeGenerateContext {
  messages: Message[];
  scope?: MemoryScope;
  projectSlug?: string;
  agentId?: string;
  mode?: "assistant" | "coding";
}

export interface AfterGenerateContext {
  messages: Message[];
  scope?: MemoryScope;
  projectSlug?: string;
  agentId?: string;
}

export interface SessionEndContext {
  messages: Message[];
  scope?: MemoryScope;
  projectSlug?: string;
  agentId?: string;
}

export interface MemoryPromptContext {
  /** Recalled memories formatted for system prompt injection. */
  systemPromptSection: string;
  /** The raw surfaced memories for programmatic access. */
  memories: SurfacedMemory[];
}

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface MemoryPluginOptions {
  /** Store backend for memory persistence. */
  store: MemoryStore;
  /** LLM provider for extraction and recall. Optional - falls back to heuristic recall. */
  llmProvider?: MemoryLLMProvider;
  /** Extraction configuration. */
  extraction?: {
    enabled?: boolean;
  };
  /** Recall configuration. */
  recall?: {
    enabled?: boolean;
    maxResults?: number;
  };
  /** Reflection configuration. */
  reflection?: {
    enabled?: boolean;
  };
  /** Memory scope. */
  scope?: MemoryScope;
  /** Project slug for project-scoped memory. */
  projectSlug?: string;
  /** Agent ID for agent-scoped memory. */
  agentId?: string;
}

// ---------------------------------------------------------------------------
// Plugin type
// ---------------------------------------------------------------------------

export interface MemoryPlugin {
  /** Name for SDK plugin registration. */
  name: string;
  /** Pre-generate hook: recall relevant memories and format for prompt injection. */
  onBeforeGenerate(context: BeforeGenerateContext): Promise<MemoryPromptContext>;
  /** Post-generate hook: extract memories from the conversation turn. */
  onAfterGenerate(context: AfterGenerateContext): Promise<void>;
  /** End-of-session hook: run reflection if enabled. */
  onSessionEnd(context: SessionEndContext): Promise<void>;
  /** Direct access to the recaller for manual recall. */
  recaller: Recaller;
  /** Direct access to the extractor for manual extraction. */
  extractor: Extractor;
  /** Memory tools that can be registered with the agent. */
  tools: MemoryTool[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const decoder = new TextDecoder();

function lastUserMessage(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      return messages[i]!.content;
    }
  }
  return "";
}

async function loadExistingMemories(
  store: MemoryStore,
  scope: MemoryScope,
  projectSlug?: string,
  agentId?: string,
): Promise<MemoryEntry[]> {
  const dir = scopeDirectory(scope, projectSlug, agentId);
  let dirPath: MemoryPath;
  try {
    dirPath = createMemoryPath(dir);
  } catch {
    return [];
  }

  const exists = await store.exists(dirPath);
  if (!exists) {
    return [];
  }

  const files = await store.list(dirPath, { glob: "*.md" });
  const entries: MemoryEntry[] = [];

  for (const file of files) {
    if (file.isDirectory) continue;

    const data = await store.read(file.path);
    if (data === null) continue;

    const raw = decoder.decode(data);
    const entry = parseMemoryFile(file.path as string, raw);
    if (entry !== null) {
      entries.push(entry);
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a memory plugin that wires extraction, recall, and reflection into
 * the agent-sdk lifecycle.
 *
 * The returned plugin exposes hook methods and direct access to the
 * underlying pipeline components for manual use.
 */
export function createMemoryPlugin(options: MemoryPluginOptions): MemoryPlugin {
  const {
    store,
    llmProvider,
    extraction: extractionConfig = {},
    recall: recallConfig = {},
    reflection: reflectionConfig = {},
    scope: defaultScope = "global",
    projectSlug: defaultProjectSlug,
    agentId: defaultAgentId,
  } = options;

  const extractionEnabled = extractionConfig.enabled !== false;
  const recallEnabled = recallConfig.enabled !== false;
  const recallMaxResults = recallConfig.maxResults ?? 5;
  const reflectionEnabled = reflectionConfig.enabled === true;

  // Build pipeline components
  const recaller = createRecaller(store, llmProvider);
  const extractor = llmProvider !== undefined ? createExtractor(llmProvider) : null;

  // Mutable scope state shared with tools — updated per-request in hooks
  const toolScopeState: ToolScopeState = {
    scope: defaultScope,
    projectSlug: defaultProjectSlug,
    agentId: defaultAgentId,
  };

  // Build tools (close over mutable scopeState)
  const tools = createMemoryTools(store, toolScopeState);

  return {
    name: "memory",

    async onBeforeGenerate(context: BeforeGenerateContext): Promise<MemoryPromptContext> {
      // Update shared scope state so tools see per-request overrides
      toolScopeState.scope = context.scope ?? defaultScope;
      toolScopeState.projectSlug = context.projectSlug ?? defaultProjectSlug;
      toolScopeState.agentId = context.agentId ?? defaultAgentId;

      if (!recallEnabled) {
        return { systemPromptSection: "", memories: [] };
      }

      const query = lastUserMessage(context.messages);
      if (query.length === 0) {
        return { systemPromptSection: "", memories: [] };
      }

      const scope = toolScopeState.scope;
      const projectSlug = toolScopeState.projectSlug;
      const agentId = toolScopeState.agentId;

      const memories = await recaller.recall({
        query,
        scope,
        projectSlug,
        agentId,
        mode: context.mode,
        maxResults: recallMaxResults,
      });

      const systemPromptSection = formatMemorySection(memories);

      return { systemPromptSection, memories };
    },

    async onAfterGenerate(context: AfterGenerateContext): Promise<void> {
      if (!extractionEnabled || extractor === null) {
        return;
      }

      const scope = context.scope ?? defaultScope;
      const projectSlug = context.projectSlug ?? defaultProjectSlug;
      const agentId = context.agentId ?? defaultAgentId;

      const existingMemories = await loadExistingMemories(store, scope, projectSlug, agentId);

      const result = await extractor.extract({
        messages: context.messages,
        existingMemories,
        scope,
        projectSlug,
        agentId,
        currentDate: new Date().toISOString().split("T")[0]!,
      });

      if (result.candidates.length > 0) {
        await extractor.apply(result, store);
      }
    },

    async onSessionEnd(context: SessionEndContext): Promise<void> {
      if (!reflectionEnabled || llmProvider === undefined) {
        return;
      }

      const reflector = createReflector(llmProvider);
      const scope = context.scope ?? defaultScope;
      const projectSlug = context.projectSlug ?? defaultProjectSlug;
      const agentId = context.agentId ?? defaultAgentId;
      const existingMemories = await loadExistingMemories(store, scope, projectSlug, agentId);

      const result = await reflector.reflect({
        messages: context.messages,
        existingMemories,
        scope,
        projectSlug,
        agentId,
      });

      await reflector.apply(result, store);
    },

    recaller,
    extractor: extractor ?? {
      async extract() {
        return { candidates: [] };
      },
      async apply() {},
    },
    tools,
  };
}
