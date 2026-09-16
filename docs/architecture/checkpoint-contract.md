# Checkpoint Contract

Status: **proposal** (2026-09-16). Targets `1.0.0`. Supersedes the "agent owns
durability" model implied by `BaseCheckpointSaver.save()` today.

## Problem

The SDK's checkpointer assumes the agent owns durability: after each run (or
each step, with `checkpointAfterToolCall`) the agent builds a `Checkpoint` and
calls `save()`; before the next run it calls `load()`; interrupts are stamped
into the checkpoint as `pendingInterrupt`; `agent.resume()` reads them back.

The canonical consumer (lleverage `agent-service`) has replaced every piece of
that model and keeps the SDK's version only because the interface forces it:

| SDK responsibility | What lleverage does instead |
| --- | --- |
| `save()` persists the transcript | `SessionServiceCheckpointSaver.save()` is a **deliberate no-op**. Session-service projects the checkpoint from durable session events (`finaliseRunProjection`, `checkpoint-projection.ts`). |
| `load()` reads the transcript | Real. Returns the projection plus per-model sanitisation, degraded recovery and resume-usage seeding. |
| `pendingInterrupt` stamped on save | Derived from events by session-service. The `ask_user` tool persists via its own `onInterrupt` callback. |
| `agent.resume()` | Unused. `executeResumeRun` builds the tool-result message and calls `agent.stream()`. |
| `checkpointAfterToolCall` gives per-step durability | Passed as `true` on every production call; `stream()` ignores it. The durability actually comes from session-event publishing. lleverage's own comments disagree with each other about this (`run-executor.ts:8541` vs `1166`, `5671`, `run-pause-state.ts:8`). |
| Compaction state travels in checkpoint messages | `persistCompactionSnapshot()` — a lleverage-only method reached by casting the saver. |
| Token usage seeds the next run's compaction gate | `setResumeUsageListener()` — another cast, because there is no SDK seam between `load()` and the compaction check. |

The cost of the mismatch is concrete:

- Four wrapper layers (`createCompactingCheckpointSaver`, interrupted-assistant,
  ordering-repair, breakdown-metric) run clone + tool-result compaction + archive
  writes + metric emission on **every `save()`**, feeding a call that discards
  the result.
- Five generation modes each hand-roll a different subset of the checkpoint
  lifecycle (see `generation-modes.md`, rows 2–6). `checkpointAfterToolCall` is
  documented on `agent.stream()` in TSDoc and silently ignored there.
- The SDK's own `threads/` ledger (`RunManager`, `ILedgerStore`, `Projector`,
  `accumulateEvents`) implements exactly the events → projection → transcript
  model lleverage built, and nothing in `createAgent` feeds it. lleverage
  extends `ILedgerStore` (`AgentLedgerStore`, `RedisLedgerStore`) but drives it
  from `run-executor`, not from the SDK.

## Decision

**The SDK owns the run lifecycle; the consumer owns durability. The checkpoint
is a projection of durable run events, never a thing the agent writes.**

Concretely:

1. `createAgent` emits every lifecycle fact as a `StreamEvent` through one
   `RunSink`, in every generation mode, from the shared generation runner.
2. The built-in durability is the existing `threads/` ledger: a `RunManager`
   over an `ILedgerStore`. The built-in checkpointer becomes a projection over
   that ledger. `MemorySaver` / `FileSaver` survive as thin adapters.
3. `BaseCheckpointSaver.save()` is removed from the contract the agent depends
   on. Consumers with their own durability (lleverage) implement the read side
   and the lifecycle observer; they no longer receive a checkpoint to discard.
4. Per-step durability is a lifecycle event (`step-finished`) that the runner
   **awaits** before the next step flows. `checkpointAfterToolCall` is retired.
5. The two lleverage extensions become part of the contract: resume-usage
   seeding via `Checkpoint.metadata.lastRunUsage`, and compaction persistence
   via a `compaction` lifecycle event.

This is lleverage's model with an SDK-native default backing. It is **not** a
port of `run-executor`: retry budgets, drain-pause handover, user-turn
re-supply, truncation classification and gateway routing stay in the platform.
The boundary is listed in [What stays in lleverage](#what-stays-in-lleverage).

## Contract

### `RunSink` — the lifecycle observer

```ts
interface RunSink {
  /** A run is starting. Called once per public-method invocation, after PreGenerate. */
  beginRun(input: {
    /** Thread the run writes to. Differs from the request's threadId when `forkSession` cloned it. */
    threadId: string;
    runId: string;
    /** Set when `forkSession` cloned `forkedFrom` into `threadId`; the sink performs the clone. */
    forkedFrom?: string;
    /** In-thread branch point (ledger semantics, see open question 2). */
    forkFrom?: { messageId: string };
    /** The turn's user/system input as canonical messages, so the sink can make it durable before generation starts. */
    inputMessages: CanonicalMessage[];
  }): Promise<void>;

  /** Ordered stream events for the run. Called with batches; may be called many times. Must resolve before the runner continues. */
  append(runId: string, events: StreamEvent[]): Promise<void>;

  /** A model step completed (tool calls resolved). Awaited before the next step's parts flow. */
  stepFinished(input: {
    runId: string;
    step: number;
    messages: ModelMessage[];   // transcript through this step, post-compaction
    usage?: LanguageModelUsage;
  }): Promise<void>;

  /** Context compaction happened mid-run or between runs. */
  compaction(input: { threadId: string; runId?: string; result: CompactionResult }): Promise<void>;

  /** A tool raised an interrupt. Replaces `markPendingInterrupt`. */
  interruptRequested(input: { threadId: string; runId: string; interrupt: Interrupt }): Promise<void>;

  /** Terminal. `messages` is the final transcript the agent would previously have saved. */
  finalizeRun(input: {
    runId: string;
    status: "committed" | "failed" | "cancelled";
    messages: ModelMessage[];
    usage?: LanguageModelUsage;
    error?: unknown;
  }): Promise<void>;
}
```

Rules:

- The runner calls these in exactly this order for every mode:
  `beginRun` → (`append`* | `stepFinished` | `compaction` | `interruptRequested`)* → `finalizeRun`.
  This resolves `generation-modes.md` rows 2, 3, 4, 5 and 6 by construction.
- Every call is awaited. A sink that wants fire-and-forget does it internally
  and returns a resolved promise. This gives the "next step cannot flow until
  the boundary is durable" guarantee that lleverage's drain-pause and
  continue-from-checkpoint logic assume today.
- A sink failure fails the run with the sink error as `cause`. There is no
  silent fallback to in-memory state.

### `CheckpointSource` — the read side

```ts
interface CheckpointSource {
  load(threadId: string): Promise<Checkpoint | undefined>;
  exists(threadId: string): Promise<boolean>;
  delete(threadId: string): Promise<boolean>;
  list?(): Promise<string[]>;
}
```

`Checkpoint` is unchanged except:

- `pendingInterrupt` is populated by the source from whatever it recorded on
  `interruptRequested`; the agent never writes it.
- `metadata.lastRunUsage?: { inputTokens?, outputTokens?, totalTokens? }` is
  read by the runner after `load()` and passed to `contextManager.updateUsage()`
  before the compaction check. Sources that want usage-seeded compaction set it;
  no listener registration.

### `BaseCheckpointSaver` compatibility

`BaseCheckpointSaver` keeps its current shape for one minor cycle as
`CheckpointSource & { save(checkpoint): Promise<void> }`. The SDK provides
`sinkFromSaver(saver)`: a `RunSink` whose `finalizeRun` and `stepFinished`
call `saver.save()` with a `Checkpoint` built the way the agent builds one
today, and whose `interruptRequested` stamps `pendingInterrupt` the way
`markPendingInterrupt` does. `createAgent({ checkpointer })` wraps
automatically. Existing savers keep working unchanged; the wrapper is the
migration path, not the destination.

### Ledger-backed default

```ts
createAgent({ ledger: ILedgerStore })            // explicit
createAgent({ checkpointer: new MemorySaver() })   // legacy, wrapped by sinkFromSaver
createAgent({})                                    // in-memory ledger
```

`createLedgerRuntime(store)` returns `{ sink: RunSink, source: CheckpointSource }`:

- `sink.beginRun` → `RunManager.beginRun` (with `forkFromMessageId`).
- `sink.append` → `RunManager.appendEvents`.
- `sink.stepFinished` → appends a `step-finished` event carrying `step` and
  `usage`; nothing else, the transcript is already in the events.
- `sink.compaction` → appends a `compaction` event (new core kind) carrying the
  `CompactionSummaryPart` so the projection can render it; `canonical-schema.md`
  already defines the carrier message.
- `sink.interruptRequested` → appends an `interrupt-requested` event (new core
  kind).
- `sink.finalizeRun` → `RunManager.finalizeRun`.
- `source.load` → `getTranscript` → `canonicalToModelMessages` (new, the inverse
  of the accumulator's mapping) → `Checkpoint` with `step` = number of
  `step-finished` events on the leaf run, `pendingInterrupt` = last unresolved
  `interrupt-requested`, `metadata.lastRunUsage` from the last committed run's
  finalize record.

`MemorySaver` and `FileSaver` become `createLedgerRuntime(new InMemoryLedgerStore())`
and `createLedgerRuntime(new SQLiteLedgerStore(path))` respectively, exported under
their current names. `KeyValueStoreSaver` is wrapped by `sinkFromSaver` and
deprecated.

### `StreamPart` → `StreamEvent`

The runner maps AI SDK parts to `StreamEvent` once, in `src/agent/run-events.ts`.
lleverage's `stream-event-mapper.ts` (`mapChunkToStreamEvents`) is the
reference implementation and moves upstream with its tests; the platform keeps
only the lleverage-specific kinds it appends on top.

### Removed

- `GenerateOptions.checkpointAfterToolCall` — replaced by `stepFinished`,
  which always fires. Deprecated for one cycle with a warning; no-op.
- `CheckpointRuntime.save / commit / markPendingInterrupt` (internal).
- `agent.resume()`'s dependence on `pendingInterrupt` having been written by
  the agent. It reads it from the source; sources that don't record interrupts
  make `resume()` throw `NoPendingInterruptError`.

## What this resolves in `generation-modes.md`

| Row | Today | After |
| --- | --- | --- |
| Checkpoint thread when `forkSession` is set | 2 of 5 modes fork-aware | `beginRun.forkFrom` in the runner, all modes |
| `contextManager.updateUsage` after run | `stream()` skips it | runner, all modes, plus pre-run seeding from `lastRunUsage` |
| Pending interrupt persisted + `InterruptRequested` | 3 of 5 | `sink.interruptRequested` + hook, all modes |
| Thrown `InterruptSignal` caught | `generate()` only | runner catch path, all modes |
| `checkpointAfterToolCall` | 3 of 5, ignored by the production caller | retired; `stepFinished` always |
| Emergency compaction on context overflow | `generate()` only | stays `generate()`-only in this proposal; see open question 3 |
| Follow-up turns bypass the public method | Response modes | follow-ups run through the same runner and sink; unchanged externally |

## lleverage migration

Target: `agent-checkpointer-chain.ts` and `SessionServiceCheckpointSaver`
become a `RunSink` + `CheckpointSource` pair with no casts and no `save()`.

| Today | After |
| --- | --- |
| `SessionServiceCheckpointSaver.save()` no-op + `saveTail` serialisation | Deleted. |
| `SessionServiceCheckpointSaver.load()` | Unchanged, now typed as `CheckpointSource.load`. Sets `metadata.lastRunUsage` (it already parses it). |
| `setResumeUsageListener` / `usageSeedingCheckpointer` cast | Deleted; the runner reads `lastRunUsage`. |
| `persistCompactionSnapshot` / `persistingCheckpointer` cast in `contextManager.onCompact` | Becomes `sink.compaction`. |
| `createCompactingCheckpointSaver` (agent-core) save path | Deleted. Its `load()` half stays as a `CheckpointSource` decorator. Candidate for upstreaming as a projection step; see open question 4. |
| `createInterruptedAssistantCheckpointer` | `load()` half stays as a source decorator; `save()` half deleted. |
| `createToolResultOrderingRepairCheckpointer` | Same split. The repair is a read-time fix for a write-time bug the SDK should not be able to produce once tool-result adjacency is enforced in the accumulator. Track separately. |
| `createCheckpointBreakdownMetricSaver` | Becomes a `RunSink` decorator on `finalizeRun` (same data, same `setImmediate` deferral). |
| `session-event-publisher` publishing per stream event | Becomes the `RunSink.append` implementation. Same events, same outbox. |
| `run-executor` `userTurnPersistedInCheckpoint` tracking (LLE-10407) | `sink.beginRun` receives `inputMessages` and lleverage publishes `user.message.created` there — before the first model call — so the user turn is durable before any retry can lose it. The flag and re-supply logic can go once that holds. |
| `run-executor` "checkpointAfterToolCall flushed the step" comments (LLE-10807, LLE-12233) | Become true statements: `stepFinished` is awaited by the runner. `persistedCheckpointThisAttempt` can be set from the sink rather than inferred from stream events. |
| `checkpointAfterToolCall: true` on both `agent.stream()` calls | Removed. |
| `ask_user` tool's `onInterrupt` persistence | Kept. The tool still knows things (`uiState`, `uiType`) the SDK doesn't. `sink.interruptRequested` runs in addition, so session-service can cross-check. |

Estimated deletion in lleverage: the `save()` side of 4 wrappers (~600 lines),
two duck-typed extension seams, the LLE-10407 re-supply branch, and the
`checkpointAfterToolCall` comment drift.

## What stays in lleverage

Not in scope, deliberately:

- Retry budgets and classification (`isRetryableAgentRunError`,
  `MAX_*_RETRIES`, provider-specific truncation handling).
- Drain-pause handover, continuation dispatch, run claiming, idempotent
  replay.
- Gateway resolution, model routing, provider options, cost headers.
- Session-service itself: event bus, outbox, projection lag, degraded
  transcript recovery, branch-path proofs, retention.
- Per-model checkpoint sanitisation (`sanitiseForCurrentModel`).
- The reasoning-only / no-output / step-budget continuation loops.

The SDK provides the lifecycle; the platform decides what to do when it goes
wrong.

## Migration plan (SDK)

Each step is a PR; the suite and the lleverage swap-test stay green at every
step. Steps 1–3 are additive.

1. **`RunSink` + `CheckpointSource` types, `sinkFromSaver`, `run-events.ts`
   mapper.** `createAgent` builds a sink from `options.checkpointer` and the
   runner calls it from every mode. Existing savers see identical `save()`
   calls, so behaviour is unchanged. Parity test: every mode produces the same
   sink call sequence for the same conversation. *This is the Slice C
   replacement.*
2. **`lastRunUsage` seeding and `compaction` events.** Runner reads
   `metadata.lastRunUsage` after `load()`; `contextManager.onCompact` is
   routed through `sink.compaction`.
3. **Ledger runtime.** `createLedgerRuntime`, `canonicalToModelMessages`, new
   core event kinds, `createAgent({ ledger })`. `MemorySaver`/`FileSaver`
   re-implemented on top; their test suites must pass unchanged.
4. **Retire `checkpointAfterToolCall`** (deprecation warning, no-op) and make
   `stepFinished` unconditional.
5. **1.0.0**: `BaseCheckpointSaver.save` marked `@deprecated`; `KeyValueStoreSaver`
   deprecated; docs (`persistence.md`, `checkpointer/README`) rewritten around
   the sink/source pair.

lleverage adopts after step 3 lands in a release; steps 1–2 are invisible to
it beyond the swap-test.

## Open questions

1. **Awaited `stepFinished` latency.** Awaiting the sink between steps adds
   the sink's write latency to every tool boundary. lleverage's publisher
   uses an outbox with a ~1s flush; the sink can resolve on enqueue rather
   than flush, which is what it effectively does today. Needs a number from
   the swap-test before adoption.
2. **`forkSession` vs ledger forks are different operations.** Today
   `forkSession: true` copies the source thread's checkpoint to a **new
   threadId** and the run continues there (`checkpoints.fork()`). The ledger's
   `forkFromMessageId` branches **within** a thread and supersedes the old
   tail (`run-lifecycle.md`). Both are legitimate; lleverage uses the
   in-thread kind (branch ids, `forkFromEntryId`) and never `forkSession`.
   Proposal: `beginRun` carries both — `threadId` (may differ from the
   request's when `forkSession` is set; the sink is told `forkedFrom:
   sourceThreadId`) and `forkFrom?: { messageId }` for in-thread branching,
   exposed as a new `GenerateOptions.forkFromMessageId`. The runner never
   copies messages itself; a sink that supports thread cloning does it in
   `beginRun`. Whether `forkSession` survives 1.0 at all is worth asking —
   it is the only reason `generation-modes.md` row 2 exists.
3. **Emergency compaction on context overflow** (`generate()` only). Porting
   it to `stream()` today would drop the user turn lleverage re-supplies
   (LLE-10407). With `beginRun.inputMessages` making the turn durable first,
   the hazard goes away — but the compaction itself should then be a normal
   `sink.compaction` + retry, not a checkpoint rewrite. Decide after step 2.
4. **Tool-result compaction as a projection step.** lleverage's
   `tool-result-compaction.ts` (1.9k lines, depends only on the SDK) is
   general. Upstreaming it as a `CheckpointSource` decorator in the SDK is
   attractive but is its own PR series; not blocking.
5. **Five modes.** With the lifecycle in one place, `streamResponse` and
   `streamRaw` have no known consumer and `streamDataResponse` is dead in
   lleverage. Deprecating two of them for 1.0 is an API-shape decision
   alongside #142/#139, not part of this contract.
6. **Session (`AgentSession`)** uses `agent.generate()` + `agent.resume()`.
   It stays on the built-in ledger path and needs no change beyond step 3.
