# Run Lifecycle

## Overview
A Run represents a single agent generation cycle — from receiving input to producing a final response. Runs have a well-defined state machine that governs their lifecycle, including support for cancellation, failure, and supersession (regeneration).

## State Machine

```
                  ┌──────────┐
                  │ created  │
                  └────┬─────┘
                       │ begin()
                  ┌────▼─────┐
          ┌──────►│streaming │◄──────┐
          │       └──┬──┬──┬─┘       │
          │          │  │  │         │
     resume()   commit │ cancel  fail
          │          │  │  │
          │    ┌─────▼┐ │ ┌▼───────┐
          │    │commit-││ │cancelled│
          │    │ted    ││ └────────┘
          │    └──────┘│
          │            │
          │      ┌─────▼──┐
          └──────┤failed   │
                 └────────┘
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
| created | streaming | `beginRun()` | Allocates stream, starts event capture |
| streaming | committed | All events received, no errors | Persists transcript, emits run.committed |
| streaming | failed | Unrecoverable error | Persists partial transcript, emits run.failed |
| streaming | cancelled | User/system cancellation | Persists partial transcript, emits run.cancelled |
| streaming | superseded | New run begins from same fork point | Marks old run superseded, emits run.superseded |
| failed | streaming | `resume()` (retry) | Re-allocates stream from last checkpoint |

## beginRun() Fork Semantics

`beginRun(options)` creates a new run. If `forkFromMessageId` is specified:
1. The new run's transcript branches from that message
2. Any existing active run from the same fork point is superseded
3. Events after the fork point in the old run are not deleted (immutable log)

## Supersession

Supersession occurs when a user regenerates a response. Only one run can be "active" for a given branch point at a time.

### Resolution Rules
1. The most recently created run at a fork point is the active run
2. Superseded runs retain their event log for audit/replay
3. UI clients receive a `run.superseded` event and should switch to the new run's stream

## Concurrency

- Only one run per thread can be in `streaming` state at a time
- Creating a new run while one is streaming triggers supersession of the old run
- Concurrent `beginRun()` calls are serialized by the ledger

## Run Metadata

Each run tracks:
- `runId`: Unique identifier (ULID)
- `threadId`: Parent thread
- `forkFromMessageId`: Branch point (null for initial run)
- `state`: Current lifecycle state
- `createdAt`: Creation timestamp
- `committedAt` / `failedAt` / `cancelledAt`: Terminal timestamp
- `eventCount`: Total events in this run's stream
