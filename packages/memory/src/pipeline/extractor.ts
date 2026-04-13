import { serialiseFrontmatter } from "../frontmatter.js";
import { MemoryIndex } from "../memory-index.js";
import { createMemoryPath } from "../path.js";
import type { MemoryPath, MemoryStore } from "../store/types.js";
import type { MemoryConfidence, MemoryFrontmatter, MemoryScope, MemoryType } from "../types.js";
import type {
  ExtractionCandidate,
  ExtractionContext,
  ExtractionResult,
  Extractor,
  MemoryLLMProvider,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_TYPES = new Set<MemoryType>(["user", "feedback", "project", "reference"]);
const VALID_SCOPES = new Set<MemoryScope>(["global", "project", "agent"]);
const VALID_CONFIDENCES = new Set<MemoryConfidence>(["high", "medium", "low"]);
const VALID_ACTIONS = new Set<string>(["create", "update"]);

const MAX_MESSAGE_CONTENT_LENGTH = 2000;
const MAX_RECENT_MESSAGES = 40;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildExtractionPrompt(context: ExtractionContext): string {
  const { messages, existingMemories, scope, projectSlug, agentId, currentDate } = context;

  const recent =
    messages.length > MAX_RECENT_MESSAGES ? messages.slice(-MAX_RECENT_MESSAGES) : messages;

  let prompt = `You are a memory extraction agent. Analyse the recent conversation and determine what durable knowledge should be saved to the persistent memory system.

Today's date is ${currentDate}. Convert any relative dates ("yesterday", "last week", "two days ago") to absolute ISO 8601 dates using this reference.

## Memory types

- **user**: The user's role, preferences, knowledge level, working style, personal details they have shared.
- **feedback**: Corrections or confirmations about approach - what to avoid or keep doing. Structure with "Why:" and "How to apply:" sections.
- **project**: Non-obvious context about ongoing work, goals, architectural decisions, deadlines, team conventions. Structure with "Why:" and "How to apply:" sections.
- **reference**: Pointers to external systems, URLs, service names, credentials locations, environment details.

## Memory scopes

- **global**: Cross-project knowledge that applies everywhere. Typically: user preferences, working style, general corrections.
- **project**: Project-specific knowledge. Typically: architecture decisions, project conventions, external system pointers.
- **agent**: Agent-specific knowledge. Typically: behavioural tuning for a particular agent instance.

When deciding scope:
- User preferences, working style, general corrections -> global
- Project architecture, project-specific decisions, external system pointers -> project
- Agent-specific behavioural corrections -> agent
- Default to "${scope}" if unsure

## What NOT to save

- Code patterns, architecture, or file paths derivable from reading the codebase
- Git history or who changed what
- Debugging solutions - the fix is in the code
- Ephemeral task details or in-progress work
- Content already in CLAUDE.md, README, or similar instruction files
- Anything already captured in the existing memories listed below

## Filename convention

Use kebab-case, descriptive filenames ending in .md. Prefix with the type when helpful for scanning:
- feedback_no-em-dashes.md
- project_deployment-setup.md
- reference_staging-urls.md
- user_working-style.md

## Index entry format

Each memory needs a one-line index entry for MEMORY.md (under 150 characters):
\`- [Human-readable name](filename.md) - One-line description\`

## Confidence levels

- **high**: Explicitly stated by the user or confirmed multiple times
- **medium**: Strongly implied or stated once without emphasis
- **low**: Inferred from behaviour or context, not directly stated

## Deduplication

Check the existing memories list below carefully. If a memory already covers the topic:
- Use action "update" with the existing filename to refine it
- Do NOT create a duplicate with slightly different wording

## Output format

Respond with ONLY a JSON object. No prose, no markdown fences, just the JSON:

{
  "candidates": [
    {
      "action": "create" | "update",
      "filename": "type_descriptive-name.md",
      "name": "Human-readable name",
      "description": "One-line description for recall",
      "type": "user" | "feedback" | "project" | "reference",
      "scope": "global" | "project" | "agent",
      "content": "The memory content. Use Why: and How to apply: for feedback/project types.",
      "indexEntry": "- [Name](filename.md) - description",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

If nothing is worth saving, return: {"candidates": []}

`;

  // Existing memories for deduplication
  if (existingMemories.length > 0) {
    prompt += "## Existing memories\n\n";
    for (const mem of existingMemories) {
      prompt += `- **${mem.frontmatter.name}** (${mem.frontmatter.type}, ${mem.frontmatter.scope}): ${mem.frontmatter.description}\n`;
    }
    prompt +=
      "\nCheck this list before creating new memories - update an existing file rather than creating a duplicate.\n\n";
  }

  // Scope context
  prompt += "## Current context\n\n";
  prompt += `- Scope: ${scope}\n`;
  if (projectSlug) {
    prompt += `- Project: ${projectSlug}\n`;
  }
  if (agentId) {
    prompt += `- Agent: ${agentId}\n`;
  }
  prompt += "\n";

  // Conversation messages
  prompt += "## Recent conversation\n\n";
  for (const msg of recent) {
    let content = msg.content;
    if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
      content = `${content.slice(0, MAX_MESSAGE_CONTENT_LENGTH)}\n[...truncated]`;
    }
    prompt += `[${msg.role}]: ${content}\n\n`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function sanitiseFilename(filename: string): string {
  const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const cleaned = lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename;

  if (!cleaned.endsWith(".md")) {
    return `${cleaned}.md`;
  }
  return cleaned;
}

function validateCandidate(raw: Record<string, unknown>): ExtractionCandidate | null {
  const action = typeof raw.action === "string" ? raw.action : "";
  if (!VALID_ACTIONS.has(action)) {
    return null;
  }

  const filename = typeof raw.filename === "string" ? sanitiseFilename(raw.filename) : "";
  if (filename.length === 0 || filename === ".md") {
    return null;
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length === 0) {
    return null;
  }

  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (description.length === 0) {
    return null;
  }

  const type = typeof raw.type === "string" ? raw.type : "";
  if (!VALID_TYPES.has(type as MemoryType)) {
    return null;
  }

  const scope = typeof raw.scope === "string" ? raw.scope : "";
  if (!VALID_SCOPES.has(scope as MemoryScope)) {
    return null;
  }

  const content = typeof raw.content === "string" ? raw.content.trim() : "";
  if (content.length === 0) {
    return null;
  }

  const indexEntry =
    typeof raw.indexEntry === "string"
      ? raw.indexEntry.trim()
      : `- [${name}](${filename}) - ${description}`;

  const confidence =
    typeof raw.confidence === "string" && VALID_CONFIDENCES.has(raw.confidence as MemoryConfidence)
      ? (raw.confidence as MemoryConfidence)
      : "medium";

  return {
    action: action as "create" | "update",
    filename,
    name,
    description,
    type: type as MemoryType,
    scope: scope as MemoryScope,
    content,
    indexEntry,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function scopeDirectory(scope: MemoryScope, projectSlug?: string, agentId?: string): string {
  switch (scope) {
    case "global":
      return "memory/global";
    case "project":
      return `memory/project/${projectSlug}`;
    case "agent":
      return `memory/agent/${agentId}`;
  }
}

function buildCandidatePath(
  candidate: ExtractionCandidate,
  projectSlug?: string,
  agentId?: string,
): MemoryPath {
  const dir = scopeDirectory(candidate.scope, projectSlug, agentId);
  return createMemoryPath(`${dir}/${candidate.filename}`);
}

// ---------------------------------------------------------------------------
// Schema for structured generation
// ---------------------------------------------------------------------------

const extractionSchema = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update"] },
          filename: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          type: { type: "string", enum: ["user", "feedback", "project", "reference"] },
          scope: { type: "string", enum: ["global", "project", "agent"] },
          content: { type: "string" },
          indexEntry: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: [
          "action",
          "filename",
          "name",
          "description",
          "type",
          "scope",
          "content",
          "indexEntry",
          "confidence",
        ],
      },
    },
  },
  required: ["candidates"],
} as const;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an {@link Extractor} backed by the given LLM provider.
 *
 * The extractor captures the project/agent context from the most recent
 * `extract` call so that `apply` can build correct store paths without
 * requiring the caller to thread the context through separately.
 */
export function createExtractor(provider: MemoryLLMProvider): Extractor {
  // Captured from the most recent extract() call so apply() can build paths.
  let lastProjectSlug: string | undefined;
  let lastAgentId: string | undefined;

  return {
    async extract(context: ExtractionContext): Promise<ExtractionResult> {
      lastProjectSlug = context.projectSlug;
      lastAgentId = context.agentId;

      const prompt = buildExtractionPrompt(context);

      const raw = await provider.generateStructured<{ candidates: Record<string, unknown>[] }>(
        prompt,
        extractionSchema,
        { maxTokens: 4096, temperature: 0.2 },
      );

      const candidates: ExtractionCandidate[] = [];

      if (Array.isArray(raw.candidates)) {
        for (const entry of raw.candidates) {
          // Handle snake_case "index_entry" from LLMs that mirror the prompt example
          if (entry.index_entry !== undefined && entry.indexEntry === undefined) {
            entry.indexEntry = entry.index_entry;
          }

          const validated = validateCandidate(entry);
          if (validated !== null) {
            candidates.push(validated);
          }
        }
      }

      return { candidates };
    },

    async apply(result: ExtractionResult, store: MemoryStore): Promise<void> {
      if (result.candidates.length === 0) {
        return;
      }

      const projectSlug = lastProjectSlug;
      const agentId = lastAgentId;

      await store.batch(
        {
          reason: "extract",
          message: `Extract ${result.candidates.length} ${result.candidates.length === 1 ? "memory" : "memories"} from conversation`,
        },
        async (batch) => {
          const now = new Date().toISOString();
          const index = new MemoryIndex(store);

          for (const candidate of result.candidates) {
            const path = buildCandidatePath(candidate, projectSlug, agentId);

            let action = candidate.action;
            if (action === "update") {
              const exists = await store.exists(path);
              if (!exists) {
                action = "create";
              }
            }

            const frontmatter: MemoryFrontmatter = {
              name: candidate.name,
              description: candidate.description,
              type: candidate.type,
              scope: candidate.scope,
              tags: [],
              confidence: candidate.confidence,
              source: "extraction",
              created: now,
              modified: now,
            };

            // For updates, preserve the original created date
            if (action === "update") {
              const existingData = await store.read(path);
              if (existingData !== null) {
                const existingText = decoder.decode(existingData);
                const createdMatch = /^created:\s*(.+)$/m.exec(existingText);
                if (createdMatch?.[1]) {
                  frontmatter.created = createdMatch[1].trim();
                }
              }
            }

            const markdown = serialiseFrontmatter(frontmatter, candidate.content);
            await batch.write(path, encoder.encode(markdown));

            await index.upsert({
              path: path as string,
              frontmatter,
              content: candidate.content,
              indexEntry: candidate.indexEntry,
            });
          }
        },
      );
    },
  };
}
