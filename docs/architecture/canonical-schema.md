# Canonical Message Schema

## Overview
Defines the canonical message and part types used by agent-threads (ledger layer) for durable transcript storage. These types normalize AI SDK streaming parts into a stable, version-controlled schema suitable for persistence and replay.

## CanonicalMessage

| Field | Type | Description |
|---|---|---|
| id | string (ULID) | Unique message identifier |
| parentMessageId | string \| null | Parent message for branching (null = linear) |
| role | "user" \| "assistant" \| "system" \| "tool" | Message role |
| parts | CanonicalPart[] | Ordered content parts |
| createdAt | string (ISO 8601) | Creation timestamp |
| metadata | CanonicalMessageMetadata | Metadata with required `schemaVersion: number` and optional extra fields |

## CanonicalPart Types

### TextPart
```typescript
{ type: "text"; text: string }
```

### ToolCallPart
```typescript
{ type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
```

### ToolResultPart
```typescript
{ type: "tool-result"; toolCallId: string; toolName: string; output: unknown; isError: boolean }
```

### ReasoningPart
```typescript
{ type: "reasoning"; text: string }
```

### FilePart
```typescript
{ type: "file"; mimeType: string; url: string; name?: string }
```

## Branching Model

Messages form a tree via `parentMessageId`. A linear conversation is a degenerate tree where each message has exactly one child.

### Fork Semantics
When a user regenerates from message M3 (forking from M2):
1. A new run is created with `forkFromMessageId = M2`
2. When the new run commits, all messages after M2 (M3 and its descendants) are deleted and replaced by the new run's transcript
3. Other committed runs at the same fork point are marked `superseded`

### Example: Linear Conversation
```
M1 (user) → M2 (assistant) → M3 (user) → M4 (assistant)
parentMessageId: null → M1 → M2 → M3
```

### Example: Branched Conversation
```
M1 → M2 → M3 (original)
       ↘ M3' (regenerated)
parentMessageId of M3: M2
parentMessageId of M3': M2
```

## Version Policy

Schema version is tracked in metadata: `{ schemaVersion: 1 }`.

Migration strategy: readers must handle all versions ≤ current. Schema changes are additive only (new part types, new optional fields). Breaking changes increment the major version and require explicit migration.

## Design Decisions

- **ULID over UUID**: ULIDs are sortable by creation time, useful for ordering without a separate sequence field
- **Parts array, not string content**: Supports rich multi-modal messages natively
- **Nullable parentMessageId**: Avoids sentinel values; null = root message
- **Extensible metadata**: Allows layers (stream, ledger) to attach domain-specific data without schema changes
