# Checkpoint contract

Status: **reviewed direction; implementation details remain open** (2026-09-17).
This replaces the earlier accepted proposal, whose compatibility, recovery and
durability claims did not follow from the existing implementations. Targets
`1.0.0`, but does not authorise implementation or change runtime behaviour.

The direction remains a lifecycle sink plus a checkpoint source. The first
implementation must be an **opt-in seam with legacy behaviour preserved**, not
a simultaneous storage migration, new recovery engine and change of defaults.

## Evidence and scope

SDK evidence is based on `bce8e5d` (#159). The consumer baseline landed in
[lleverage #6988](https://github.com/lleverage-ai/lleverage/pull/6988), merge
`9381b2038a`. Its README records the original capture, the subsequent consumer
step-boundary fix and both pinned SDK patch hashes.

The baseline uses the real SDK/model loop, `MemorySaver`, consumer event mapper,
publisher and pure projection helpers. It covers two turns, cooperative pause,
human interrupt, provider failure and tool failure. It does **not** prove database
reconstruction, crash recovery, the full `run-executor` retry loop, deployed flag
values or write latency. Human resume supplies a resolved-source fixture rather
than exercising `prepareResume`. Re-run it unchanged against migration candidates;
a mismatch needs investigation and explicit acceptance, not snapshot regeneration.

Consumer code has changed since the first review. At `9381b2038a` it also has
version-bound compaction methods, run-continuation loading and a resolved-interrupt
overlay. Those are not made obsolete by adding a generic SDK interface. Re-audit
the actual consumer and its SDK patch before each implementation/removal PR.

## Problem

`BaseCheckpointSaver` combines reads and writes even when the consumer derives
checkpoints from its own event stream. That makes extension hooks difficult to
type and creates redundant work, but it does not make the write path cost-free
or safe to remove without tracing its side effects.

| Existing behaviour | Consequence for this design |
| --- | --- |
| `SessionServiceCheckpointSaver.save()` serialises calls and clears `knownEmpty`, but does not persist the SDK blob | A durability no-op is not an entirely side-effect-free call. Preserve its observable effects during compatibility work. |
| Consumer `load()` includes sanitisation, degraded recovery, continuation handling and resolved-interrupt handling | Keep those policies in the consumer source. A ledger transcript alone is not equivalent. |
| Save/load decorators may compact, archive, repair or emit metrics | Preserve their gates, ordering and timing. Measure costs; do not assume every decorator always performs archive writes. |
| Every mode saves the checkpoint once, when the call returns normally (`checkpointAfterToolCall` was removed for 1.0) | A step-save adapter would add saver calls no mode makes today. Step durability belongs to the consumer's own storage. |
| The agent caches a thread's checkpoint after the first load and only re-reads the saver after `invalidateCheckpoint(threadId)` | A consumer whose `load()` projects its own records must invalidate before a call that needs records written since that load. |
| Resume usage and compaction extensions are reached through saver-shaped objects | Typed seams are useful, but must preserve the meaning of the data and rollout controls. |
| The SDK ledger already provides run records, raw event storage, accumulation and committed transcripts | These are useful building blocks, not a complete checkpoint recovery implementation. |

The [generation-mode matrix](./generation-modes.md) records behaviour on SDK
`main`. It remains authoritative until implementation changes and tests replace
individual rows.

## Direction and compatibility boundary

**The SDK may report its own execution lifecycle. The consumer owns storage,
recovery policy and the enclosing platform run.** A checkpoint source may be a
blob saver or an event-derived projection; the initial change supports both.

The first slice must preserve:

- Existing behaviour when `checkpointRuntime` is absent, including the absence
  of persistence when no checkpointer is configured.
- Existing `MemorySaver`, JSON-file `FileSaver`, third-party savers and their
  constructors, overwrite/load/list/delete behaviour and exception handling.
- Mode-specific save/interrupt timing, hooks, message assembly, cache short
  circuits, retries and background follow-ups. It must not silently fix the
  drifts documented in `generation-modes.md`.
- Consumer publication ownership, retry safeguards, feature flags, cohort gates
  and rollback paths. No new global default enables seeding or compaction.

A later PR may deliberately unify modes or remove APIs. Such changes are
behaviour changes with their own tests and migration notes, not consequences of
an allegedly behaviour-neutral extraction.

### Identity: an SDK invocation is not a platform run

lleverage may call `agent.stream()` repeatedly inside one platform run. A sink
must not publish `session.run.finalised` just because one SDK invocation ends:
the platform may retry, recover from truncation or continue after a pause.

The proposed observer uses a distinct `invocationId`. It is not a reinterpretation
of existing `_runId`/resume identities. Internal provider retries have distinct
attempt numbers; another public call gets another invocation identity, even when
the platform run is unchanged. The implementation must specify follow-up call
identity and event ordering before wiring callbacks.

The consumer adapter binds this identity to its existing platform run, attempt,
stream and message IDs. It remains the single owner of:

- User-message publication and its existing deduplication identities.
- Enriched tool metadata, output normalisation and sequence allocation.
- Suppression/classification of recoverable pre-output error events.
- Platform terminal events, claim tokens, retry budgets and handover decisions.

The existing publisher and a new sink must not both publish the same facts.
Shadow comparison must be non-publishing. Raw SDK chunks cannot replace the
platform's transformed events without a verified mapping.

## Proposed opt-in seam

These sketches define responsibilities, not shipped exports or final API names.
They deliberately separate observation from the source's recovery policy.

```ts
interface RunIdentity {
  threadId: string;
  invocationId: string;
}

interface RunSink {
  /** SDK invocation start, not platform run creation. */
  beginRun(input: RunIdentity & {
    // New caller input only, not loaded history or the assembled system prompt.
    inputMessages: ModelMessage[];
    state: AgentState;
  }): Promise<void>;

  /** Facts from one internal model attempt; preserve ordering and identities. */
  append(input: RunIdentity & {
    attempt: number;
    events: StreamEvent[];
  }): Promise<void>;

  /** Completed model/tool boundary, after this step's tool results. */
  stepFinished(input: RunIdentity & {
    attempt: number;
    step: number;
    messages: ModelMessage[];
    state: AgentState;
    /** This step's model-call usage (StepResult.usage), not an aggregate. */
    usage?: LanguageModelUsage;
  }): Promise<void>;

  /** Invocation outcome; interruption is not successful platform completion. */
  finalizeRun(input: RunIdentity & {
    messages: ModelMessage[];
    state: AgentState;
    /** Aggregate usage for telemetry/billing only; never a context-occupancy seed. */
    usage?: LanguageModelUsage;
    error?: unknown;
  } & (
    | { outcome: "interrupted"; interrupt: Interrupt }
    | { outcome: "completed" | "failed" | "cancelled"; interrupt?: never }
  )): Promise<void>;
}

interface CheckpointSource {
  load(threadId: string): Promise<Checkpoint | undefined>;
  exists(threadId: string): Promise<boolean>;
  delete(threadId: string): Promise<boolean>;
  list?(): Promise<string[]>;
}
```

Two explicitly different configurations are proposed:

- `createAgent({ checkpointRuntime: { mode: "persist", sink, source } })`
  selects the new persistence owner. Reject `checkpointer` alongside this mode:
  two load/write owners would be ambiguous. Require an explicit thread identity;
  do not create an implicit persistent thread for ordinary `createAgent({})` calls.
- `createAgent({ checkpointer, checkpointRuntime: { mode: "observe", sink } })`
  keeps the legacy saver as the sole persistence owner and allows the rollout's
  non-publishing comparison. Observer mode has no `source`; it must not replace
  legacy loads, saves, interrupt gates or their ordering/error propagation.
  Observation is not a durability barrier. Deliver owned copies through a
  bounded, non-blocking diagnostic path; observer errors or dropped records
  invalidate the comparison and are reported, not propagated into agent execution.
  Queue bounds, ordering and disposal semantics must be specified before coding.

Before implementation, define and test observer sequences for every method:
normal completion, `respondWith`, tool failure, provider error parts versus
thrown errors, interruption, `resume()`, `getInterrupt()`, emergency
compaction, cancellation, abandoned stream consumption, SDK retries and background
follow-ups. Name `runUIStreamFollowUps` explicitly: it does not re-enter the public
method and cannot inherit another-public-call identity by assumption. The
observation order should be explicit; it does not imply existing modes have
identical outcomes or saver side effects. Specify who produces `StreamEvent`s
for each mode, including non-streaming `generate()`; do not assume every mode
has raw stream chunks or bypass the consumer's verified mapping.
`inputMessages` must include explicit resume tool results when supplied, not
only user-role messages. Payload ownership must also be defined so mutable
agent state cannot change a queued record after a boundary was acknowledged.

### Acknowledgement and durability

Awaiting a callback proves only that its promise resolved. The adapter must
state what that means:

| Acknowledgement | What it establishes |
| --- | --- |
| Observed or queued in process memory | Ordering within this process; no crash durability or source visibility. |
| Accepted by an in-memory event store | Process-local persistence only. |
| Accepted by persistent storage | Only that store's documented durability tier, not necessarily projection visibility. |
| Stored through a known sequence/version and visible to the checkpoint source | The barrier required before a recovery reload can rely on that boundary. |

lleverage's ordinary `publishStoredSessionEvents()` path can enqueue into
`partition.batches`. That is not an outbox-row acknowledgement. Its explicit
flush, poison/quarantine handling and continuation APIs must be respected; an
SDK callback cannot infer successful persistence from enqueue alone. A new
adapter needs acknowledged sequence/version and read-your-writes evidence before
any existing recovery safeguard can be removed.

For the opt-in **persistence** runtime, callback failure must stop new model/tool
steps; it must not silently fall back to an in-memory source. This rule does not
apply to the non-publishing observer, whose failures invalidate diagnostic evidence
without changing the legacy execution outcome. Specify how terminal callback
failure preserves the original error, and how cancellation/stream abandonment
closes the invocation. Preserve legacy exception behaviour on the legacy path.

`beginRun` can offer input persistence before the model call only when its
adapter actually provides that barrier. It does **not** by itself solve user-turn
loss on retries. Keep the consumer's input tracking/re-supply logic until tests
prove that a reload sees the input after the relevant failure windows.

## Resume usage: context occupancy, not cumulative usage

Do not pass `metadata.lastRunUsage` directly to `contextManager.updateUsage()`.
The consumer's record can contain totals accumulated over many calls, while the
context manager interprets `totalTokens` as current context occupancy. For
example, an 8.2M-token run total says nothing about whether a 251k-token live
context fits a 300k window.

A separate opt-in typed seam should return a context measurement for the exact
checkpoint/version being loaded, for example `contextUsage: { contextTokens }`
alongside the checkpoint. Its implementation must:

1. Use the consumer's validated last-call `contextTokens`, never cumulative
   input/output/total usage as a substitute. Accept only finite, nonnegative
   values. Missing or invalid context occupancy means **no seed**.
2. Preserve the existing conversion when calling the current context manager:
   `{ inputTokens: undefined, outputTokens: undefined, totalTokens: contextTokens }`.
3. Bind the measurement to the loaded history. Do not reuse a stale measurement
   after compaction, branch selection or another source-version change.
4. Preserve rollout controls. At consumer merge `9381b2038a`, resume seeding is
   exposed through the legacy extras gate or the separately gated durable
   compaction cohort. Their defaults and deployed values are not assumptions
   the SDK may override. Flag-off must preserve the current no-seed path.

The sketch's `stepFinished.usage` is usage of that step's model call;
`finalizeRun.usage` is aggregate usage for billing/telemetry, not a source for
`contextTokens`. A per-call input-token count may inform occupancy, but its scope
and correspondence to the loaded/compacted history still need validation.

There is also a pre-existing in-process issue: `generate()` and the response/raw
modes pass aggregate result usage to `updateContextUsage`, whereas `stream()`
skips that update. Fixing only the source's resume seed would not address this
live path. The compatibility slice preserves it; the context-usage slice must
explicitly decide and test its replacement rather than silently changing budgets.

Billing/run totals remain available for telemetry without becoming context
occupancy. `RunRecord` and `FinalizeRunOptions` currently have no usage field;
a future ledger adapter needs an explicit versioned storage schema and source
projection rather than reading a nonexistent finalise-record field.

## Compaction and interrupt seams are separate changes

### Compaction

A typed compaction extension should replace casts only after it can preserve the
consumer's existing version/freshness checks and result semantics. A generic
`compaction(): Promise<void>` is insufficient for a version-bound write that can
be rejected or skipped. The exact result/anchor contract needs its own review.

At `9381b2038a`, `persistContextCompaction` and `loadCompactionSource` are active
extensions behind the durable gate and organisation cohort. The older
`persistCompactionSnapshot` hook remains for compatibility but is no longer the
active platform compaction path. Do not revive it by wiring a new SDK callback.
Preserve the checkpoint-compaction gate, durable-compaction gate/cohort, legacy
extras gate and metric gate independently. Source code does not prove their
values in deployment. Turning off new writes does not erase existing snapshots
or disable the source's required replay of them.

### Interrupts

Do not append an `interrupt-resolved` event to an already terminal SDK ledger
run. `RunManager.appendEvents()` rejects terminal runs. An interrupted invocation
outcome also does not create a paused ledger state automatically.

The initial seam keeps existing interrupt persistence and resume behaviour on
the **legacy and observer paths**. The persistence-runtime path must not claim
that support merely because a `CheckpointSource` exists. Its interrupted terminal
notification must carry the actual `Interrupt` (as required by the sketch), so
the sink has the request, identity and tool linkage needed for persistence.

In the first implementation slice, every direct-checkpointer path (`resume()`,
`getInterrupt()` and emergency compaction) must either route through
the new source/sink with specified semantics and tests or fail explicitly as
unsupported on the persistence-runtime path before side effects. Likewise, the
tool-pipeline checkpointer/approval gate must recognise a supported persistence
runtime; an arbitrary observer-only sink is not an interrupt persistence provider.
No silent no-op, lost pending interrupt or misleading generic-session guarantee
is acceptable. A runtime cannot claim `AgentSession` compatibility until its
resume path is supported and tested.

Before replacing the legacy resolution path, choose and test a durable model:
either an explicit resumable lifecycle in storage, or a separate idempotent resolution
record that can refer to an immutable terminal run. This is a prerequisite for
ledger-backed interrupt recovery, not an implementation detail to guess later.
The design must cover duplicate responses, conflicting responses, restart,
crash after accepting the answer but before starting generation, branch changes
and stale placeholder events arriving after the answer.

Keep `agent.resume()` for the generic single-process/`AgentSession` case.
lleverage continues its explicit tool-result `stream()` path. Its tool callback
and `seedResolvedInterrupt` source overlay have separate duties: preserve both
until real `prepareResume` and checkpoint reload tests establish a replacement.
Do not add a second interrupt publisher merely to cross-check the first one.

## Legacy saver compatibility

An internal adapter may route old saver operations through the new runtime, but
it must be driven by the existing mode-specific save decisions. A public
`sinkFromSaver` helper is not promised until its mode/option/error semantics are
specified. Blindly saving on every `stepFinished` is not compatible.

| SDK mode | Current ordinary successful invocation with a saver/thread |
| --- | --- |
| `generate()` | Final save; the per-step flag is ignored. |
| `stream()` | Final save; the per-step flag is ignored. |
| `streamRaw()`, `streamDataResponse()` | Flag-gated step saves plus final save. |

This table is not a universal save-count formula: interrupts, retries, follow-ups,
cache hits and error paths need their own regression cases. Test the exact
current sequence, checkpoint contents, wrapper effects and error propagation
for each mode with the flag on and off. Include `generate()`'s save followed by
`markPendingInterrupt`, and its thrown-interrupt save with step zero and pre-call
messages; neither is equivalent to a single normal final save. The consumer
session goldens deliberately
do not assert saver call counts; these are additional targeted compatibility
tests, not a reason to put implementation mechanics into those goldens.

Keep the current saver implementations during this phase. JSON `FileSaver`
options (`dir`, `extension`, `pretty`, `namespace`), file layout, existing data,
overwrite/list/delete semantics and restart behaviour are compatibility
contracts. A SQLite replacement requires import/versioning, rollback and data
compatibility tests; it is not an internal refactor. State snapshots, serialisation
and SQLite writes have costs that must be measured.

## Ledger-backed recovery is a later, opt-in design

The existing `createLedgerCheckpointer({ ledgerStore, resumeSaver?, branch? })`
from #149 already uses `canonicalMessagesToModelMessages`. Keep it and its resume
saver until a replacement is proven. It is not sufficient for the proposed
recovery behaviour:

- `RunManager.finalizeRun()` accumulates canonical messages only for committed
  runs. Memory and SQLite transcript reads do not materialise streaming, failed
  or cancelled raw events merely because those events were appended.
- `getTranscript()` and `getThreadTree()` expose committed message history. A
  run that fails before materialising any message cannot be selected reliably
  as the recovery run by looking for the active message-tree leaf.
- A `user-message` event can be present in raw replay while both transcript and
  tree remain empty. Adding a new `input-message` kind alone does not fix that.
- Trailing error-only content can be dropped by the accumulator after a finished
  step. The consumer baseline records the error in the terminal failure event;
  do not assume the transcript is a complete execution/recovery journal.

A future `createLedgerRuntime({ ledgerStore, eventStore })` needs both stores,
as `RunManager` does. Before implementation/activation, its design must specify:

1. A recovery-run selector independent of committed-message membership, with
   explicit branch, attempt, claim and status rules. Do not pick merely the
   latest timestamp or the message-tree tip.
2. A versioned recovery projection for input, tool call/result boundaries,
   state, compaction, context occupancy and pending/resolved interrupts.
   Define replay cutoffs, deduplication and how committed history joins an
   uncommitted tail without repeating tools or messages.
3. Status-specific load policy for streaming, failed, cancelled and interrupted
   invocations; handling of incomplete tool pairs and externally completed
   side effects; stale-run ownership and concurrent continuations.
4. Fork-point state and context ownership. Copying the currently loaded state
   into a branch made at an earlier message is not historical-state recovery.
5. Restart/crash tests around input persistence, tool completion, step/state
   acknowledgement, compaction, interrupt resolution and finalisation, for
   memory and persistent implementations as appropriate. In-memory tests do
   not prove disk durability.

Only after those gates can a ledger runtime be offered explicitly. Changing the
no-checkpointer default, replacing `FileSaver`, or removing the resume-delta
saver are separate decisions, not part of adding that opt-in runtime.

## Consumer adoption and what stays in lleverage

Start with `mode: "observe"` beside the existing checkpointer chain, using a
non-publishing comparison adapter. The observer cannot enable interrupt or
recovery capabilities; the legacy saver continues to provide them. Then switch
one publication path at a time to `mode: "persist"` behind the existing rollout
mechanism. Keep the old path available for rollback without running both writers
concurrently. A model invocation is
never enough evidence to finalise the enclosing platform run.

Do not delete these components in the additive phase:

- Checkpointer save wrappers or their compaction/archive/metric effects.
- Per-model sanitisation, degraded recovery, ordering repair, continuation-state
  loading and resolved-interrupt overlay.
- User-turn resupply, flush/read-your-writes safeguards and checkpoint freshness
  checks. Comments should describe the actual mechanism, not claim that
  the removed `checkpointAfterToolCall` option made `stream()` flush.
- Claiming, retry budgets, truncation/no-output handling, recovery classification,
  drain handover, idempotent replay and terminal publication.
- Gateway/model routing, organisation context, session-service projection lag,
  branch selection, retention and UI-specific interrupt data.

Replacing a cast or deleting a wrapper is a later change with an explicit
producer/consumer mapping and parity evidence. There is no credible line-count
saving estimate until those side effects and policies have been accounted for.

## Surface decisions for 1.0

lleverage remains the canonical consumer. An unused API needs a strong generic
single-process justification, but removals must follow a fresh usage audit of
both the consumer and SDK internals, including subagent/team callers.

| Surface | Direction and prerequisite |
| --- | --- |
| `agent.resume()`, `AgentSession` | Keep for generic interrupt and interactive sessions; preserve their existing path during the additive phase. |
| `MemorySaver`, `FileSaver` | Keep their current implementations and contracts. A ledger-backed alternative is separately opt-in. |
| Source `delete` / optional `list` | Keep for checkpoint management and local tooling. Specify cascading deletion if a new storage model is introduced. |
| `PreGenerate.respondWith` | Keep; consumer interception relies on it. Test each mode's existing short-circuit behaviour. |
| `checkpointAfterToolCall` | Removed for 1.0 ([#180](https://github.com/lleverage-ai/agent-sdk/issues/180)). Only `streamRaw()` and `streamDataResponse()` honoured it; the consumer passed it only to `stream()`, where it did nothing, and the SDK's own `streamRaw()` caller never set it. Every mode now saves once, when the call returns normally. There is no replacement save barrier: consumers that need per-step durability record steps in their own storage and use `invalidateCheckpoint()` to make the next call reload. |
| `invalidateCheckpoint(threadId)` | Added for 1.0 ([#180](https://github.com/lleverage-ai/agent-sdk/issues/180)). The only way to make an agent re-read a thread it has already loaded; the next call reloads, restores agent state and fires `PostCheckpointLoad` again. |
| `forkSession` / `forkedSessionId` | Removed for 1.0 (no consumer or internal caller). In-thread branching remains the ledger's `forkFromMessageId`. |
| `KeyValueStoreSaver` | Removed for 1.0 (no consumer caller). A `BaseCheckpointSaver` over a KV store is a few lines; see `docs/persistence.md`. |
| `streamResponse()` | Removed for 1.0 (no consumer or internal caller); `streamDataResponse()` is the `Response`-shaped mode. |
| `streamRaw()` | Retained: the SDK's own streaming-subagent path (`tools/task.ts`) calls it. |
| `streamDataResponse()` | Provisionally retain for generic HTTP use; a replacement recipe would need equivalent streaming/tool context. |
| Internal checkpoint write methods and ledger `resumeSaver` | Remove only when their replacements reproduce the required behaviour; not merely because a sink interface exists. |

There is no promised deprecation cycle for removed alpha APIs. That does not
make removals invisible to callers: each needs a breaking-change note and a
consumer type-check/migration. Do not mark `BaseCheckpointSaver.save` deprecated
until the alternative is shipped and covers its retained use cases.

## Implementation sequence and gates

Each slice is separately reviewable and revertible. No interim alpha release is
required: local package candidates can run against the merged consumer baseline.

1. **Correct and approve this design.** The historical accepted text is not
   implementation authority. Resolve the first-slice identity, observer-order
   and failure semantics before coding it.
2. **Add an opt-in sink/source seam and compatibility tests.** No storage/default
   changes, no API removals and no mode unification. Preserve the legacy path
   and all existing saver side effects. Validate every mode plus consumer
   session goldens unchanged.
3. **Add typed context-occupancy and compaction seams separately.** Preserve
   gates/cohorts, validated context-only seeding, version-bound writes, replay
   and skip/error behaviour. Test flag-off and flag-on paths independently.
4. **Validate the consumer adapter.** Prove attempt/run identity, single publisher
   ownership, deduplication, input reload, real resume, retry/error handling and
   acknowledged source visibility. Measure boundary-write latency with the
   actual service; an in-memory swap test is not that measurement. Use a
   controlled canary with an independently reviewed rollback plan.
5. **Design and implement optional ledger recovery.** Satisfy the selection,
   projection, interruption and crash-test prerequisites above. Any default or
   JSON-to-SQLite migration is a separate proposal with data rollback evidence.
6. **Review removals, migration notes and 1.0 readiness.** Re-audit the consumer's
   then-current SDK patch, type-check actual callers, add `**BREAKING**` changelog
   entries where applicable and rerun consumer parity. Do not treat the narrowed
   seam as proof that all release work is done.

## Decisions still requiring review

- Exact invocation/attempt identity, observer ordering and stream-abandonment
  semantics for the first opt-in seam, including cache hits, `runUIStreamFollowUps`
  and bounded observer delivery. Persistence-runtime support or explicit rejection
  for resume, interrupt inspection and emergency-compaction paths.
- Correcting existing in-process aggregate-usage seeding in the context-usage
  slice, separately from validated resume occupancy. Preserve legacy behaviour
  during the compatibility slice.
- Acknowledgement/visibility receipts and acceptable latency for the consumer
  adapter. Resolving on an in-process enqueue cannot satisfy a durable barrier.
- Typed source-version/context-occupancy and compaction anchor/result contracts.
- The separate ledger recovery selector and interrupt resolution state model.
- Historical state at branch points and any persistent storage migration.
- Final API removals, including the generic HTTP response story.
- Emergency overflow compaction for `stream()`: a separate behaviour change.
  Input persistence, resupply and retry correctness still need proof; a new
  `beginRun` callback does not make the hazard disappear.
