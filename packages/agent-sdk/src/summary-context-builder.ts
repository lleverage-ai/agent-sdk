import type { BranchSelections, CanonicalMessage, CompactionSummaryPart } from "./canonical.js";
import { isCompactionSummaryPart } from "./canonical.js";

/**
 * Options for building context from a canonical transcript.
 *
 * @category Context
 */
export interface ContextBuilderOptions {
  readonly threadId: string;
  readonly branch?: "active" | "all" | { selections: BranchSelections };
  readonly maxMessages?: number;
  readonly includeToolResults?: boolean;
  readonly includeReasoning?: boolean;
}

/**
 * Provenance metadata returned by a context builder.
 *
 * @category Context
 */
export interface ProvenanceMetadata {
  readonly threadId: string;
  readonly messageCount: number;
  readonly firstMessageId: string | null;
  readonly lastMessageId: string | null;
  readonly summariesHonoured?: readonly string[];
}

/**
 * Built canonical context.
 *
 * @category Context
 */
export interface BuiltContext {
  readonly messages: CanonicalMessage[];
  readonly provenance: ProvenanceMetadata;
}

/**
 * Minimal store capability required by summary-aware context building.
 *
 * @category Context
 */
export interface CanonicalTranscriptStore {
  getTranscript(options: {
    threadId: string;
    branch?: "active" | "all" | { selections: BranchSelections };
  }): Promise<CanonicalMessage[]>;
}

/**
 * Interface for building context from a conversation transcript.
 *
 * @category Context
 */
export interface IContextBuilder {
  build(options: ContextBuilderOptions): Promise<BuiltContext>;
}

/**
 * Reference implementation that returns a filtered full transcript.
 *
 * @category Context
 */
export class FullContextBuilder implements IContextBuilder {
  constructor(private readonly store: CanonicalTranscriptStore) {}

  async build(options: ContextBuilderOptions): Promise<BuiltContext> {
    let messages = await this.store.getTranscript({
      threadId: options.threadId,
      branch: options.branch,
    });
    messages = filterMessages(messages, options);
    return buildResult(options.threadId, messages);
  }
}

/**
 * Context builder that substitutes valid compaction summaries for their covered messages.
 *
 * @category Context
 */
export class SummaryAwareContextBuilder implements IContextBuilder {
  constructor(private readonly store: CanonicalTranscriptStore) {}

  async build(options: ContextBuilderOptions): Promise<BuiltContext> {
    const transcript = await this.store.getTranscript({
      threadId: options.threadId,
      branch: options.branch,
    });

    if (options.branch === "all") {
      const filtered = filterMessages(transcript, options);
      return buildResult(options.threadId, filtered);
    }

    const activeIds = new Set(transcript.map((message) => message.id));
    const messageById = new Map(transcript.map((message) => [message.id, message] as const));
    const summaries = transcript
      .map((message) => ({ message, summary: pickCompactionSummary(message) }))
      .filter((entry): entry is { message: CanonicalMessage; summary: CompactionSummaryPart } =>
        Boolean(entry.summary),
      )
      .filter(
        ({ summary }) =>
          summary.coveredMessageIds.length > 0 &&
          summary.coveredMessageIds.every((id) => activeIds.has(id)),
      )
      .sort(compareSummaryPreference);

    const consumed = new Set<string>();
    const parentRewrites = new Map<string, string>();
    const byFirstCoveredId = new Map<
      string,
      { message: CanonicalMessage; summary: CompactionSummaryPart }
    >();
    const honoured: string[] = [];

    for (const entry of summaries) {
      if (entry.summary.coveredMessageIds.some((id) => consumed.has(id))) continue;
      for (const id of entry.summary.coveredMessageIds) {
        consumed.add(id);
        parentRewrites.set(id, entry.summary.summaryId);
      }
      consumed.add(entry.message.id);
      parentRewrites.set(entry.message.id, entry.summary.summaryId);
      byFirstCoveredId.set(entry.summary.coveredMessageIds[0], entry);
      honoured.push(entry.summary.summaryId);
    }

    const messages: CanonicalMessage[] = [];
    for (const message of transcript) {
      const summaryEntry = byFirstCoveredId.get(message.id);
      if (summaryEntry) {
        const firstCovered = messageById.get(summaryEntry.summary.coveredMessageIds[0]);
        const originalParentId = firstCovered?.parentMessageId ?? null;
        const parentMessageId = originalParentId
          ? (parentRewrites.get(originalParentId) ?? originalParentId)
          : null;
        messages.push(
          renderSummaryAsModelMessage(summaryEntry.message, summaryEntry.summary, parentMessageId),
        );
        continue;
      }
      if (consumed.has(message.id)) continue;
      if (pickCompactionSummary(message)) continue;
      messages.push(rewriteParent(message, parentRewrites));
    }

    const filtered = filterMessages(messages, options);
    const result = buildResult(options.threadId, filtered);
    return { ...result, provenance: { ...result.provenance, summariesHonoured: honoured } };
  }
}

function pickCompactionSummary(message: CanonicalMessage): CompactionSummaryPart | undefined {
  return message.parts.find(isCompactionSummaryPart);
}

function renderSummaryAsModelMessage(
  carrier: CanonicalMessage,
  summary: CompactionSummaryPart,
  parentMessageId: string | null,
): CanonicalMessage {
  return {
    id: summary.summaryId,
    parentMessageId,
    role: "assistant",
    parts: [{ type: "text", text: `[Previous conversation summary]\n\n${formatSummary(summary)}` }],
    createdAt: summary.provenance.createdAt,
    metadata: {
      schemaVersion: carrier.metadata.schemaVersion,
      renderedFromSummaryId: summary.summaryId,
    },
  };
}

function rewriteParent(
  message: CanonicalMessage,
  parentRewrites: ReadonlyMap<string, string>,
): CanonicalMessage {
  if (!message.parentMessageId) return message;
  const parentMessageId = parentRewrites.get(message.parentMessageId);
  return parentMessageId ? { ...message, parentMessageId } : message;
}

function formatSummary(summary: CompactionSummaryPart): string {
  if (!summary.structured) return summary.text;
  const sections: string[] = [];
  if (summary.structured.goal) sections.push(`## Goal\n${summary.structured.goal}`);
  if (summary.structured.constraints?.length)
    sections.push(`## Constraints\n${bullets(summary.structured.constraints)}`);
  if (summary.structured.progress?.done?.length)
    sections.push(`## Done\n${bullets(summary.structured.progress.done)}`);
  if (summary.structured.progress?.inProgress?.length)
    sections.push(`## In Progress\n${bullets(summary.structured.progress.inProgress)}`);
  if (summary.structured.progress?.blocked?.length)
    sections.push(`## Blocked\n${bullets(summary.structured.progress.blocked)}`);
  if (summary.structured.decisions?.length)
    sections.push(`## Decisions\n${bullets(summary.structured.decisions)}`);
  if (summary.structured.nextSteps?.length)
    sections.push(`## Next Steps\n${bullets(summary.structured.nextSteps)}`);
  if (summary.structured.criticalContext?.length)
    sections.push(`## Critical Context\n${bullets(summary.structured.criticalContext)}`);
  if (summary.structured.relevantFiles?.length) {
    sections.push(
      `## Relevant Files\n${summary.structured.relevantFiles.map((file) => `- ${file.path}${file.note ? ` — ${file.note}` : ""}`).join("\n")}`,
    );
  }
  return sections.length > 0 ? sections.join("\n\n") : summary.text;
}

function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function compareSummaryPreference(
  a: { summary: CompactionSummaryPart },
  b: { summary: CompactionSummaryPart },
): number {
  if (a.summary.tier !== b.summary.tier) return b.summary.tier - a.summary.tier;
  return b.summary.provenance.createdAt.localeCompare(a.summary.provenance.createdAt);
}

function filterMessages(
  messages: CanonicalMessage[],
  options: ContextBuilderOptions,
): CanonicalMessage[] {
  let out = messages;
  if (options.includeToolResults === false || options.includeReasoning === false) {
    out = out
      .map((message) => ({
        ...message,
        parts: message.parts.filter((part) => {
          if (options.includeToolResults === false && part.type === "tool-result") return false;
          if (options.includeReasoning === false && part.type === "reasoning") return false;
          return true;
        }),
      }))
      .filter((message) => message.parts.length > 0);
  }
  if (options.maxMessages !== undefined && out.length > options.maxMessages)
    return out.slice(-options.maxMessages);
  return out;
}

function buildResult(threadId: string, messages: CanonicalMessage[]): BuiltContext {
  return {
    messages,
    provenance: {
      threadId,
      messageCount: messages.length,
      firstMessageId: messages.at(0)?.id ?? null,
      lastMessageId: messages.at(-1)?.id ?? null,
    },
  };
}
