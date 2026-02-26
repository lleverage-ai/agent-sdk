import type { ILedgerStore } from "./stores/ledger-store.js";
import type { BuiltContext, ContextBuilderOptions, ProvenanceMetadata } from "./types.js";

/**
 * Interface for building context from a conversation transcript.
 *
 * Implementations may apply filtering, truncation, or summarization
 * to fit messages within a context budget.
 *
 * @experimental
 * @category ContextBuilder
 */
export interface IContextBuilder {
  /**
   * Build context from a transcript.
   *
   * @param options - Context building options
   * @returns Built context with provenance metadata
   */
  build(options: ContextBuilderOptions): Promise<BuiltContext>;
}

/**
 * Reference implementation that returns the full transcript.
 *
 * Optionally filters by message count and part types. This serves as a
 * baseline; more advanced builders can add summarization or token budgeting.
 *
 * @experimental
 * @category ContextBuilder
 */
export class FullContextBuilder implements IContextBuilder {
  private store: ILedgerStore;

  constructor(store: ILedgerStore) {
    this.store = store;
  }

  async build(options: ContextBuilderOptions): Promise<BuiltContext> {
    let messages = await this.store.getTranscript({ threadId: options.threadId });

    // Filter parts based on options
    if (options.includeToolResults === false || options.includeReasoning === false) {
      messages = messages.map((msg) => ({
        ...msg,
        parts: msg.parts.filter((part) => {
          if (options.includeToolResults === false && part.type === "tool-result") return false;
          if (options.includeReasoning === false && part.type === "reasoning") return false;
          return true;
        }),
      }));
      // Remove messages that have no parts after filtering
      messages = messages.filter((msg) => msg.parts.length > 0);
    }

    // Apply max messages limit (take from the end to keep recent context)
    if (options.maxMessages !== undefined && messages.length > options.maxMessages) {
      messages = messages.slice(-options.maxMessages);
    }

    const provenance: ProvenanceMetadata = {
      threadId: options.threadId,
      messageCount: messages.length,
      firstMessageId: messages.length > 0 ? messages[0]!.id : null,
      lastMessageId: messages.length > 0 ? messages[messages.length - 1]!.id : null,
    };

    return { messages, provenance };
  }
}
