# Checkpoint Contract

Status: **accepted** (2026-09-16), pending lleverage agent-team review of the
[open questions](#open-questions). Targets `1.0.0`. Supersedes the "agent owns
durability" model implied by `BaseCheckpointSaver.save()` today. Implementation
tracked in the [migration plan](#migration-plan-sdk).

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

### Surface rule

lleverage is the canonical implementation. Any checkpoint-adjacent surface it
does not use stays in 1.0 only if it is fundamental to the generic case — a
single-process agent with no session service. "Someone might want it" is not
enough. Applied below in [Removed](#removed) and [Kept](#kept-and-why).

## Contract

### `RunSink` — the lifecycle observer

```ts
interface RunSink {
  /** A run is starting. Called once per public-method invocation, after PreGenerate. */
  beginRun(input: {
    threadId: string;
    runId: string;
    /** In-thread branch point (ledger semantics, `run-lifecycle.md`). */
    forkFromMessageId?: string;
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
    state: AgentState;          // todos/files after this step's tool calls
    usage?: LanguageModelUsage;
  }): Promise<void>;

  /** Context compaction happened mid-run or between runs. */
  compaction(input: { threadId: string; runId?: string; result: CompactionResult }): Promise<void>;

  /** A tool raised an interrupt. Replaces `markPendingInterrupt`. */
  interruptRequested(input: { threadId: string; runId: string; interrupt: Interrupt }): Promise<void>;

  /** `agent.resume()` accepted a response for the interrupt. Called before the resumed run's `beginRun`. */
  interruptResolved(input: { threadId: string; runId: string; interruptId: string; response: unknown }): Promise<void>;

  /** Terminal. `messages` is the final transcript the agent would previously have saved; `state` is the agent's todos/files at that point. */
  finalizeRun(input: {
    runId: string;
    status: "committed" | "failed" | "cancelled";
    messages: ModelMessage[];
    state: AgentState;
    usage?: LanguageModelUsage;
    error?: unknown;
  }): Promise<void>;
}
```

Rules:

- The runner calls these in exactly this order for every mode:
  `beginRun` → (`append`* | `stepFinished` | `compaction` | `interruptRequested`)* → `finalizeRun`,
  with `interruptResolved` preceding the `beginRun` of a resumed run.
  This resolves `generation-modes.md` rows 2, 3, 4, 5 and 6 by construction.
- `beginRun` must make `inputMessages` durable before returning. This is the
  contract's answer to LLE-10407: a retry that reloads the transcript sees the
  user turn even if the first model call never produced an `append`.
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
  `interruptRequested` and not yet seen an `interruptResolved` for; the agent
  never writes it.
- `state` is populated by the source from the last `finalizeRun` (or, for a
  run that never finalised, the last `stepFinished`). Sources that don't
  track it return `createAgentState()`, as `createLedgerCheckpointer` does
  today.
- `metadata.lastRunUsage?: { inputTokens?, outputTokens?, totalTokens? }` is
  read by the runner after `load()` and passed to `contextManager.updateUsage()`
  before the compaction check. Sources that want usage-seeded compaction set it;
  no listener registration.

### `BaseCheckpointSaver` compatibility

`BaseCheckpointSaver` keeps its current shape as
`CheckpointSource & { save(checkpoint): Promise<void> }`. The SDK provides
`sinkFromSaver(saver)`: a `RunSink` whose `finalizeRun` and `stepFinished`
call `saver.save()` with a `Checkpoint` built the way the agent builds one
today, whose `interruptRequested` stamps `pendingInterrupt` the way
`markPendingInterrupt` does, and whose `interruptResolved` clears it the way
`agent.resume()` does today. `createAgent({ checkpointer })` wraps
automatically. Third-party savers keep working unchanged.

Call cardinality is the one visible difference. Today a saver sees one
`save()` per run, plus one per step only when `checkpointAfterToolCall` is
set. In step 1 `sinkFromSaver` honours the option exactly as today, so the
swap-test sees identical `save()` calls. From step 4 (option removed)
`stepFinished` always saves: an N-step run produces N+1 `save()` calls. For
`MemorySaver`/`FileSaver` this is free (ledger append). A third-party saver
that cannot afford per-step writes debounces internally; the contract only
requires the promise to resolve.

`MemorySaver` and `FileSaver` keep their constructors and their
`BaseCheckpointSaver` shape — the retained-surface table below promises
unchanged tests — but their **implementation** moves onto the ledger: each
holds a `createLedgerRuntime(store)` internally and forwards `save()` to the
sink and `load()` to the source. Passing one to `createAgent({ checkpointer })`
is detected and short-circuits the `sinkFromSaver` wrapper, so the runner
talks to the ledger directly. `createAgent({ ledger })` is the same thing
without the class.

### Ledger-backed default

```ts
createAgent({ ledger: ILedgerStore })              // explicit
createAgent({ checkpointer: new MemorySaver() })   // ledger-backed saver; talks to the ledger directly
createAgent({ checkpointer: myThirdPartySaver })   // wrapped by sinkFromSaver
createAgent({})                                    // in-memory ledger
```

The SDK already has half of this: `createLedgerCheckpointer(ledgerStore)`
(#149) reconstructs `load()` from `ILedgerStore.getTranscript` via
`canonicalMessagesToModelMessages`, and persists only a resume delta (step,
state, pending interrupt) to an inner saver. It is unused by lleverage and
untested against `createAgent` end to end, but it is the right read side. This
proposal completes it with the write side.

`createLedgerRuntime(store)` returns `{ sink: RunSink, source: CheckpointSource }`:

- `sink.beginRun` → `RunManager.beginRun` (with `forkFromMessageId`; exposed
  as a new `GenerateOptions.forkFromMessageId`, replacing `forkSession`),
  then `appendEvents` with one `input-message` event (new core kind) per
  entry in `inputMessages`, in the same call, before returning. The
  accumulator materialises `input-message` into the corresponding user/system
  `CanonicalMessage`, so a run that fails before its first model part still
  leaves the user turn in the transcript. `BeginRunOptions` gains no field;
  the durability comes from the events.
- `sink.append` → `RunManager.appendEvents`.
- `sink.stepFinished` → appends a `step-finished` event carrying `step`,
  `usage` and a `state` snapshot (todos, files). The transcript itself is
  already in the events.
- `sink.compaction` → appends a `compaction` event (new core kind) carrying the
  `CompactionSummaryPart` so the projection can render it; `canonical-schema.md`
  already defines the carrier message.
- `sink.interruptRequested` → appends an `interrupt-requested` event (new core
  kind) carrying the `Interrupt`.
- `sink.interruptResolved` → appends an `interrupt-resolved` event (new core
  kind) carrying `interruptId` and the response. Appended to the run that
  raised the interrupt, before the resumed run's `beginRun`.
- `sink.finalizeRun` → appends a `run-state` event carrying the final `state`,
  then `RunManager.finalizeRun`.
- `source.load` → `getTranscript({ threadId, branch: "active" })` →
  `canonicalMessagesToModelMessages` (existing) → `Checkpoint` with:
  - `step` = number of `step-finished` events on the leaf run;
  - `pendingInterrupt` = the last `interrupt-requested` on the leaf run with
    no later `interrupt-resolved` carrying the same `interruptId`;
  - `state` = payload of the last `run-state` event on the leaf run, else the
    last `step-finished.state` on the leaf run, else `createAgentState()`;
  - `metadata.lastRunUsage` from the leaf run's finalize record.

  **Branch rule.** `load(threadId)` is always the active branch, and "leaf
  run" means the last run on that branch. A `forkFromMessageId` run
  supersedes the old tail (`run-lifecycle.md`), so an interrupt raised on an
  abandoned branch is never reported as pending: it belongs to a run that is
  no longer on the active path. Reading another branch is a ledger query
  (`getTranscript({ branch: { selections } })`), not a checkpoint operation;
  `CheckpointSource.load` deliberately has no branch parameter, matching
  today's `createLedgerCheckpointer` default of `"active"`.

  The resume-delta inner saver in today's `createLedgerCheckpointer` goes
  away: everything it stored is now derivable from events. Test: raise an
  interrupt, `resume()`, `load()` again → `pendingInterrupt` is `undefined`
  and `state` round-trips.

`createLedgerCheckpointer` is folded into `createLedgerRuntime`; `MemorySaver`
and `FileSaver` are re-implemented on it as described under
[compatibility](#basecheckpointsaver-compatibility).

### `StreamPart` → `StreamEvent`

The runner maps AI SDK parts to `StreamEvent` once, in `src/agent/run-events.ts`.
lleverage's `stream-event-mapper.ts` (`mapChunkToStreamEvents`) is the
reference implementation and moves upstream with its tests; the platform keeps
only the lleverage-specific kinds it appends on top.

### Removed

Per the surface rule. Each of these is unused by lleverage and not fundamental
to the generic single-process case.

| Surface | Why it goes |
| --- | --- |
| `GenerateOptions.checkpointAfterToolCall` | Replaced by `stepFinished`, which always fires. lleverage passes `true` and gets nothing; the generic case gets the same guarantee without the flag. |
| `GenerateOptions.forkSession` + `GenerateResultComplete.forkedSessionId` | Clones a thread's checkpoint to a fresh threadId. lleverage branches *within* a thread (branch ids, `forkFromEntryId`), which the ledger already models as `forkFromMessageId`. Thread cloning is a consumer-side copy of a transcript; nothing in the runner needs to know about it. Removing it deletes `generation-modes.md` row 2 and `CheckpointRuntime.fork()`. |
| `KeyValueStoreSaver` | A blob store abstraction over a blob store. `MemorySaver`/`FileSaver` cover the generic case; anyone with a KV store has a ledger store in ten lines. |
| `createLedgerCheckpointer`'s `resumeSaver` inner saver | Folded into the ledger; the resume delta is derivable. |
| `CheckpointRuntime.save / commit / fork / markPendingInterrupt` (internal) | Replaced by sink calls. |
| `streamResponse()`, `streamRaw()` | No consumer. `generate()`, `stream()` and `streamDataResponse()` cover the three real shapes (result, parts, UI-stream `Response`). Note `streamDataResponse()` is dead in lleverage too (`AgentService.chat()`/`resume()` have no callers); it survives only because a UI-stream `Response` is the generic Next.js/Hono case. |

### Kept, and why

| Surface | lleverage uses it? | Kept because |
| --- | --- | --- |
| `agent.resume()` | No — `executeResumeRun` builds the tool-result message and calls `stream()`. | It is the generic single-process interrupt story (`AgentSession`, agent-teams `session-runner`, every doc example). It reads `pendingInterrupt` from the source; a source that doesn't record interrupts makes it throw `NoPendingInterruptError`. |
| `AgentSession` | No. | Generic REPL/CLI loop; agent-teams depends on it. |
| `MemorySaver` | Yes (subagents, `createMemorySaver()`). | Re-implemented on the in-memory ledger; same name, same tests. |
| `FileSaver` | No. | The generic single-process durable case (CLI, local tools). Re-implemented on `SQLiteLedgerStore`. |
| `CheckpointSource.delete` | Yes (`clearCheckpoint`). | — |
| `CheckpointSource.list` | No (lleverage's `list()` hits are on other types). | Optional; needed by `FileSaver`-style tooling. |
| `PreGenerate.respondWith` cache short-circuit | Yes (skill-eval interception plugin). | — |

## What this resolves in `generation-modes.md`

| Row | Today | After |
| --- | --- | --- |
| Checkpoint thread when `forkSession` is set | 2 of 5 modes fork-aware | row deleted: `forkSession` removed |
| `contextManager.updateUsage` after run | `stream()` skips it | runner, all modes, plus pre-run seeding from `lastRunUsage` |
| Pending interrupt persisted + `InterruptRequested` | 3 of 5 | `sink.interruptRequested` + hook, all modes |
| Thrown `InterruptSignal` caught | `generate()` only | runner catch path, all modes |
| `checkpointAfterToolCall` | 3 of 5, ignored by the production caller | retired; `stepFinished` always |
| Emergency compaction on context overflow | `generate()` only | stays `generate()`-only in this proposal; see open question 2 |
| Follow-up turns bypass the public method | Response modes | `streamResponse`/`streamRaw` removed; `streamDataResponse` follow-ups run through the same runner and sink |
| `respondWith` cache replay, TTFT telemetry, `providerMetadata` telemetry | per-mode | unchanged; three modes, each with a documented output shape |

## lleverage migration

Target: `agent-checkpointer-chain.ts` and `SessionServiceCheckpointSaver`
become a `RunSink` + `CheckpointSource` pair with no casts and no `save()`.

| Today | After |
| --- | --- |
| `SessionServiceCheckpointSaver.save()` no-op + `saveTail` serialisation | Deleted. |
| `SessionServiceCheckpointSaver.load()` | Unchanged, now typed as `CheckpointSource.load`. Sets `metadata.lastRunUsage` (it already parses it). |
| `setResumeUsageListener` / `usageSeedingCheckpointer` cast | Deleted; the runner reads `lastRunUsage`. |
| `persistCompactionSnapshot` / `persistingCheckpointer` cast in `contextManager.onCompact` | Becomes `sink.compaction`. |
| `createCompactingCheckpointSaver` (agent-core) save path | Deleted. Its `load()` half stays as a `CheckpointSource` decorator. Candidate for upstreaming as a projection step; see open question 3. |
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
3. **Ledger runtime.** `createLedgerRuntime` (absorbing
   `createLedgerCheckpointer`), new core event kinds (`input-message`,
   `compaction`, `interrupt-requested`, `interrupt-resolved`, `run-state`),
   `createAgent({ ledger })`. `MemorySaver`/`FileSaver` re-implemented on top;
   their test suites must pass unchanged. Includes the interrupt-resolution
   and state round-trip tests from [Ledger-backed default](#ledger-backed-default).
4. **Remove per the surface rule**: `checkpointAfterToolCall`, `forkSession` /
   `forkedSessionId`, `KeyValueStoreSaver`, `streamResponse()`, `streamRaw()`,
   and the internal `CheckpointRuntime` write methods. `stepFinished` becomes
   unconditional. One PR, one `**BREAKING**` CHANGELOG block, one migration
   note per removal in `docs/migration/1.0.md`. No deprecation cycle — there is
   no released 1.x to be compatible with, and the alpha line has one consumer.
5. **1.0.0**: `BaseCheckpointSaver.save` marked `@deprecated` (kept for
   third-party savers via `sinkFromSaver`); docs (`persistence.md`,
   `checkpointer/README`) rewritten around the sink/source pair.

lleverage adopts after step 4 lands in a release; steps 1–2 are invisible to
it beyond the swap-test, and step 4 only removes things it doesn't call.

## Open questions

1. **Awaited `stepFinished` latency.** Awaiting the sink between steps adds
   the sink's write latency to every tool boundary. lleverage's publisher
   uses an outbox with a ~1s flush; the sink can resolve on enqueue rather
   than flush, which is what it effectively does today. Needs a number from
   the swap-test before adoption.
2. **Emergency compaction on context overflow** (`generate()` only,
   `enableErrorFallback`). lleverage sets the flag but never benefits because
   it uses `stream()`. Porting it to `stream()` today would drop the user turn
   lleverage re-supplies (LLE-10407). With `beginRun.inputMessages` making the
   turn durable first, the hazard goes away — but the compaction itself should
   then be a normal `sink.compaction` + retry, not a checkpoint rewrite. Under
   the surface rule it either becomes a runner-level behaviour lleverage
   actually gets, or it goes. Decide after step 2, with lleverage.
3. **Tool-result compaction as a projection step.** lleverage's
   `tool-result-compaction.ts` (1.9k lines, depends only on the SDK) is
   general. Upstreaming it as a `CheckpointSource` decorator in the SDK is
   attractive but is its own PR series; not blocking.
4. **`streamDataResponse()` is dead in lleverage.** It is kept only for the
   generic HTTP case. If the surface rule is applied strictly it goes too,
   and the SDK ships `generate()` + `stream()` with a documented recipe for
   turning `stream()` into a UI-message `Response`. Worth a deliberate call
   rather than a default.
