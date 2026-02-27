# Run Lifecycle

## Overview
A Run represents a single agent generation cycle — from receiving input to producing a final response. Runs have a well-defined state machine that governs their lifecycle, including support for cancellation, failure, and supersession (regeneration).

## State Machine

```
                  ┌──────────┐
                  │ created  │
                  └────┬─────┘
                       │ activateRun()
                  ┌────▼─────┐
                  │streaming │
                  └─┬──┬──┬──┘
                    │  │  │
               commit fail cancel
                    │   │    │
              ┌─────▼┐ ┌▼──┐ ┌▼───────┐
              │committed│failed│cancelled│
              └─────┬──┘ └────┘ └────────┘
                    │ superseded by newer commit at same fork point
              ┌─────▼─────┐
              │ superseded│
              └───────────┘
```

## States

| State | Description | Terminal |
|---|---|---|
| created | Run allocated, not yet streaming | No |
| streaming | Actively receiving events from the model | No |
| committed | Successfully completed, transcript persisted | Yes |
| failed | Error during generation or tool execution | Yes |
| cancelled | Explicitly cancelled by user or system | Yes |
| superseded | Replaced by a newer run (regeneration) | Yes |

## Transitions

| From | To | Trigger | Side Effects |
|---|---|---|---|
| created | streaming | `activateRun()` (invoked by `RunManager.beginRun()`) | Run becomes writable for stream events |
| streaming | committed | `finalizeRun({ status: "committed", messages })` | Persists transcript and marks same-fork committed runs as superseded |
| streaming | failed | `finalizeRun({ status: "failed" })` or recovery | Marks run terminal without committing transcript messages |
| streaming | cancelled | `finalizeRun({ status: "cancelled" })` or recovery | Marks run terminal without committing transcript messages |
| committed | superseded | A newer committed run finalizes at the same `forkFromMessageId` | Prior committed run is marked superseded |

## beginRun() Fork Semantics

`beginRun(options)` creates a new run. If `forkFromMessageId` is specified:
1. The new run's transcript branches from that message
2. Existing committed transcript tail after the fork point is replaced when the new run is committed
3. Other committed runs at the same fork point are marked `superseded` during finalization

## Supersession

Supersession occurs when a user regenerates a response and a newer run is committed from the same fork point.

### Resolution Rules
1. The most recently committed run at a fork point is the active run
2. Superseded runs retain their event log for audit/replay
3. No dedicated `run.superseded` transport event is emitted by `agent-threads` (ledger layer); consumers infer this from run records/transcript reads

## Concurrency

- Multiple runs can exist per thread; the store does not enforce a global single-streaming-run lock
- Supersession is resolved at commit time for runs that share the same `forkFromMessageId`
- SQLite store uses transactions for finalize operations; callers should still serialize higher-level workflow decisions

## Run Metadata

Each run tracks:
- `runId`: Unique identifier (ULID)
- `threadId`: Parent thread
- `forkFromMessageId`: Branch point (null for initial run)
- `status`: Current lifecycle state
- `createdAt`: Creation timestamp
- `finishedAt`: Terminal timestamp (or null if still active)
- `messageCount`: Number of canonical messages committed for this run
