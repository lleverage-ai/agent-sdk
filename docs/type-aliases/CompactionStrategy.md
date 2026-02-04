[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CompactionStrategy

# Type Alias: CompactionStrategy

> **CompactionStrategy** = `"rollup"` \| `"tiered"` \| `"structured"`

Defined in: [packages/agent-sdk/src/context-manager.ts:442](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L442)

Compaction strategy type.

- **rollup**: Summarize older messages into a single summary (default)
- **tiered**: Create multiple summary layers (summary of summary)
- **structured**: Generate structured summaries with sections (decisions, tasks, etc.)
