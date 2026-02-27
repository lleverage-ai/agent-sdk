# Compaction & Retention

## Overview
The system manages three distinct data planes with different retention characteristics. This document defines the compaction strategy, retention policies, and reconciliation procedures for each plane.

## Data Planes

### 1. Execution Memory (agent-sdk)
- **What**: In-flight generation state — messages array, tool call context, agent state
- **Lifetime**: Single generation cycle (one `generate()` or `stream()` call)
- **Storage**: In-memory only
- **Compaction**: Handled by `ContextManager` (summarization, token budgeting)
- **Retention**: None — discarded after generation completes

### 2. Transport Log (agent-stream)
- **What**: Ordered event log per stream — `StoredEvent[]` with monotonic sequences
- **Lifetime**: Active run + replay window
- **Storage**: `IEventStore` (memory or SQLite)
- **Compaction**: Planned (not yet implemented)
- **Retention**: Configurable (default: retain until explicitly deleted or compacted)

### 3. Durable Transcript (agent-ledger)
- **What**: Materialized `CanonicalMessage[]` — the source of truth for conversation history
- **Lifetime**: Indefinite (user-facing data)
- **Storage**: Persistent store (SQLite, external DB)
- **Compaction**: Planned (not yet implemented)
- **Retention**: Indefinite by default; user-controlled deletion

## Retention Matrix

| Plane | Default Retention | Compaction Trigger | Data After Compaction |
|---|---|---|---|
| Execution Memory | Generation lifetime | Generation end | Discarded |
| Transport Log | Until deleted | N/A (planned) | N/A |
| Durable Transcript | Indefinite | N/A (planned) | N/A |

## Compaction Flow

### Transport Log Compaction

```
1. Projector materializes current state from events
2. Snapshot is created: { state, lastSeq }
3. Events with seq ≤ lastSeq are eligible for deletion
4. Deletion is async and best-effort (doesn't block reads)
```

### Snapshot Schema

```typescript
interface Snapshot<TState> {
  streamId: string;
  state: TState;
  lastSeq: number;       // All events up to this seq are reflected
  createdAt: string;      // ISO 8601
}
```

### Reconciliation

After loading a snapshot, the projector catches up by replaying events with `seq > snapshot.lastSeq`. This handles events that arrived between snapshot creation and loading.

## Replay SLA

| Scenario | Source | Latency Target |
|---|---|---|
| Cold start (no snapshot) | Full event replay | O(n) events |
| Warm start (with snapshot) | Snapshot + tail replay | O(1) + O(delta) |
| Live client reconnect | Replay from last known seq | O(delta) |
| Branch switch | Snapshot at fork + new run events | O(1) + O(branch) |

## Reconciliation Policy

When the transport log and durable transcript disagree (e.g., after a crash):

1. **Transport log is authoritative for event ordering** — events are append-only and immutable
2. **Durable transcript is authoritative for message identity** — message IDs and parent relationships are set by the ledger
3. **On conflict**: Re-project from the transport log. The ledger's snapshot is treated as a cache, not a source of truth
4. **Partial runs**: If a run's events exist in the log but the run was never committed, the ledger ignores those events until explicitly told to recover them

## Design Decisions

- **Three planes, not two**: Separating execution memory from transport log prevents the stream layer from needing to understand token budgets or summarization
- **Append-only log + snapshots**: Classic event-sourcing pattern. Snapshots are optimization, not requirement — system is correct with log-only replay
- **Explicit compaction, not TTL**: Time-based deletion risks losing data the user expects to persist. Compaction is triggered by the application after confirming the snapshot is durable
- **Best-effort deletion**: Log truncation after snapshot doesn't need to be synchronous. Readers skip events below the snapshot's lastSeq anyway
