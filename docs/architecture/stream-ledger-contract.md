# Stream ↔ Ledger Contract

## Overview
Defines the boundary between `agent-stream` (realtime event transport) and `agent-ledger` (durable transcript storage). The stream layer handles ephemeral, ordered events. The ledger layer materializes those events into canonical messages.

## Layer Responsibilities

| Concern | agent-stream | agent-ledger |
|---|---|---|
| Event ordering | ✓ (monotonic seq) | |
| Event storage | ✓ (append-only log) | |
| Event replay | ✓ (afterSeq, limit) | |
| Message materialization | | ✓ |
| Branching / fork tracking | | ✓ |
| Run lifecycle | | ✓ |
| Compaction | ✓ (log truncation) | ✓ (snapshot) |

## Event Flow

```
AI SDK StreamPart → StreamEvent → [store] → Projector → CanonicalPart
     (ephemeral)     (stored)               (materialized)
```

### Stage 1: Capture (agent-stream)
The SDK's streaming response emits `StreamPart` objects. These are mapped to `StreamEvent` values and appended to the event store with monotonic sequence numbers.

### Stage 2: Projection (agent-stream → agent-ledger)
A `Projector` reduces stored events into state. The ledger uses a projector to materialize `CanonicalMessage[]` from the event stream.

### Stage 3: Persistence (agent-ledger)
The ledger persists the materialized messages as the durable transcript. On restart, it can either:
- Replay events from the store and re-project, or
- Load the last snapshot and replay only events after the snapshot's sequence number

## Event Mapping

| StreamEvent Kind | Canonical Part | Notes |
|---|---|---|
| text-delta | Accumulated into TextPart | Multiple deltas → single part |
| tool-call | ToolCallPart | Emitted when tool call is complete |
| tool-result | ToolResultPart | Emitted when tool execution finishes |
| reasoning | ReasoningPart | Extended thinking content |
| file | FilePart | File attachments |
| step-started | (metadata) | Marks generation step boundary |
| step-finished | (metadata) | Carries finish reason, usage stats |
| error | (metadata) | Stored but not materialized as a part |

## Fork-Point Propagation

When the ledger starts a new run with `forkFromMessageId`:
1. Ledger determines the `seq` of the last event associated with that message
2. Ledger creates a new stream (or stream segment) for the new run
3. The projector for the new run initializes with the canonical state up to the fork point
4. New events are appended to the new stream and projected independently

## Sequence Diagram: Normal Generation

```
User        Ledger          Stream          AI SDK
 │           │               │               │
 │──prompt──►│               │               │
 │           │──beginRun()──►│               │
 │           │               │──generate()──►│
 │           │               │◄──text-delta──│
 │           │               │──append()────►│(store)
 │           │               │◄──tool-call───│
 │           │               │──append()────►│(store)
 │           │               │◄──step-end────│
 │           │──commitRun()─►│               │
 │           │──project()───►│               │
 │◄──result──│               │               │
```

## Sequence Diagram: Regeneration (Fork)

```
User        Ledger          Stream
 │           │               │
 │──regen(M3)►│              │
 │           │──supersede(oldRun)
 │           │──beginRun(fork=M2)──►│
 │           │  (new stream)  │
 │           │               │──append(events)──►│(store)
 │           │──commitRun()─►│
 │           │──project()───►│
 │◄──result──│               │
```

## Design Decisions

- **Stream is event-sourced, ledger is materialized view**: Clean separation of concerns. Stream never interprets events; ledger never handles transport.
- **Projector is shared code**: Both layers use the same `Projector` class, but with different reducers. Stream's projector is generic; ledger's projector knows about canonical types.
- **Fork creates new stream, not new branch in same stream**: Simpler ordering guarantees. Each run has its own monotonic sequence space.
