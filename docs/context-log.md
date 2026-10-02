# Context log mode (experimental)

> **Status:** experimental. This release ships the contracts, an in-memory
> store, a store conformance suite and the core of the log-mode runtime:
> [request projection](#request-projection), [producers](#producers), the
> [hook rules](#hooks-in-log-mode) and the
> [commit boundary](#the-commit-boundary), which commits every call's input
> before dispatch and every model output before anything uses it,
> [compaction](#compaction) as a committed transition,
> [interrupts and resume](#interrupts-and-resume), and delegated
> [subagents on their own streams](#subagent-streams). Agents
> without `contextLog: { mode: "log" }` keep their legacy behaviour. The
> exports may change before they are marked stable.

Today an agent's history is a mutable `ModelMessage[]` checkpoint. The SDK
overwrites it after each generation, rebuilds the system prompt every time,
compacts by replacing the array and lets `PreGenerate` replace the input. That
makes it hard to say exactly what a model was sent, and every rewrite of an
earlier message invalidates the provider's prompt cache.

In log mode the history is an **append-only log**. Committed entries are the
source of truth, and every model request is a deterministic **projection** of
one path through the log. Nothing that was committed is rewritten. Compaction,
model changes and branches are declared **transitions** that start a new
version of the context, and earlier versions stay readable.

## Concepts

| Concept | What it is |
| --- | --- |
| Stream | One append-only sequence, identified by `{ threadId, branchId, streamId }`. A branch's main conversation and each subagent have their own stream. |
| Entry | An immutable item on a path: `user`, `assistant`, `tool_result` or `runtime_context`. Every entry has a key that is unique along its path, and a generic `metadata` bag. |
| Version | An immutable context version: a parent and how many of its leading entries it inherits, the reason it was created, the frozen core system bytes and the serialisation contract. |
| Path | The entries a version sees: the inherited prefix of its ancestors followed by its own entries. A `ContextPathRef` (version plus entry count) names a path exactly. |
| Head | A stream's current path boundary. It only moves forward, by compare and swap on `revision`. |
| Manifest | What one model call was prepared to send, committed before dispatch, with its lifecycle (dispatched, then an outcome). |
| Transition | A declared change that starts a new version: `initial`, `compaction`, `branch`, `model_change`, `adapter_change`, `core_policy_change`, `audience_transition`, `legacy_import`, or a host-defined reason. Transitions are declared by their cause, never inferred by comparing requests. |

Entries carry exact content. `assistant` entries keep every provider-specific
part and option (for example reasoning signatures), plus the model that
produced them, so a later request can replay them byte for byte. Content must
be JSON-serialisable: encode binary file data, dates and URLs as strings before
logging them. Conversion for a different provider happens in the projection
adapter, never to stored entries.

`metadata` is opaque to the SDK. The SDK defines no audience, trust or access
semantics for entries; a host that needs them keeps its own labels in
`metadata` and enforces them in its admit hook.

## Contracts

All exports are marked `@experimental`.

- **`ContextLogStore`** persists the log:
  - `readHead(stream)` reads a stream's head.
  - `readPath(ref, { after, limit })` reads one page of a path in position
    order. The result depends only on the reference, so a manifest always reads
    back exactly the path it committed.
  - `readVersion(id)` and `readManifest(id)` read committed records.
  - `prepare({ stream, expectedRevision, idempotencyKey, transition?, append, manifest, closeSuperseded? })`
    commits an optional transition, the entries to append and the manifest in
    one atomic, compare-and-swap write, and moves the head by one revision.
    With `closeSuperseded` (the head's `lastManifestId`), the same write
    closes that call if it has no outcome yet: `completed` if outputs were
    appended after its prepare, otherwise `unknown` if it was dispatched,
    otherwise `cancelled`. It is optional and additive; the log-mode runtime
    always sets it.
  - `markDispatched(manifestId)` records that dispatch started. It conflicts
    when the head has already moved past the manifest, so a stale candidate is
    never sent.
  - `appendOutputs({ manifestId, expectedRevision, items })` commits a
    dispatched call's assistant output and tool results. It requires the
    expected revision **and** that the manifest still owns the head
    (`head.lastManifestId`). Once a later prepare has moved the head, a call's
    late outputs are refused, so they never enter a newer call's context.
  - `recordOutcome(manifestId, outcome)` records `completed`, `failed`,
    `cancelled` or `unknown`.
- **`ContextProducer`** returns `runtime_context` entries to append before a
  call. Producers are deterministic and append-only. The entry key is the
  deduplication key: the runtime skips entries whose key is already on the path.
  See [Supersession and retraction](#supersession-and-retraction).
- **`ProjectionAdapter`** turns a version's core and contract and its path
  into model messages. It is versioned: changing its output for an existing
  path needs a new version and an `adapter_change` transition. Its input is
  content only (no positions, ids or timestamps), because a call is projected
  before it is committed and must project to the same bytes afterwards.
- **`ContextAdmitHook`** lets the host authorise every prepare and every
  dispatch (for example by re-checking access). It allows or refuses; it never
  rewrites the request.

### Supersession and retraction

A `runtime_context` entry may name an earlier entry in `supersedes`. Stores
enforce the rules at commit:

- The target must be a `runtime_context` entry earlier on the same path. It
  can be inherited, already committed, or earlier in the same request.
- The target must still be active (not already superseded), so each slot
  forms one chain. A target that is missing, already superseded, not runtime
  context, or later in the request is an `invalid_supersession` conflict.
  An entry that supersedes itself is `invalid`.
- A **retraction** (`retraction: true`) retires the entry it supersedes and
  emits nothing itself. It needs `supersedes` and a `null` payload. A later
  entry can supersede the retraction to give the slot a new value.

Superseded entries and retractions stay in the log. `activeContextEntries(path)`
returns the entries a projection should emit: it drops superseded entries
and retractions and keeps everything else in order.

### Producers

Producers run at the start of each generation attempt (not between the
steps of a tool loop), against the attempt's single head snapshot, and
return `runtime_context` entries to append. Their output passes the
`PreGenerate` hooks with the new user input, and the attempt's first
`prepare` commits both against that snapshot's revision. The agent's own
`contextLog.producers` run first, then each plugin's `contextProducers` in
plugin order; producer names must be unique. The runtime drops any entry
whose key is already on the path, and rejects entries that are not the
producer's own `runtime_context`. A producer's error stops the call.

`createSlotContextProducer` handles the bookkeeping for the common case, a
producer that keeps one current value per named slot:

```typescript
import { createSlotContextProducer, definePlugin } from "@lleverage-ai/agent-sdk";

const settings = createSlotContextProducer({
  name: "project-settings",
  optional: true,
  fingerprintSecret: process.env.CONTEXT_FINGERPRINT_SECRET,
  load: async () => {
    const settings = await loadSettings();
    return settings ? [{ slot: "settings", payload: settings }] : [];
  },
});

const plugin = definePlugin({ name: "settings", contextProducers: [settings] });
```

It reads its own earlier entries from the path and appends only changes:

| Situation | What is appended |
| --- | --- |
| A slot appears for the first time | An entry with key `ctx:<producer>:slot:<slot>:1:<fingerprint>` (`-` without a `fingerprintSecret`) |
| A slot's payload and metadata are unchanged | Nothing |
| A slot's value changes | A new entry that `supersedes` the slot's latest entry |
| A slot that was active is no longer returned | A retraction, unless `retractAbsent` is `false` (use that for retrieved data, which stays part of the history) |
| An `optional` loader throws | One `context_unavailable` marker (`{ type, producer, reason }`); earlier slots stay active |
| The loader recovers | A retraction of the marker, then any changed slots |
| A required loader throws, or the call was aborted | The error propagates and nothing is committed |

The marker's `reason` comes from `describeFailure` and never copies the
error message by default. Keys are deterministic, so a retry from the same
head re-derives byte-identical entries.

Deduplication needs to know whether a slot's **source** value changed, but
the committed payload may differ from the source because input filters (for
example the secrets filter) redact it before commit. With a
`fingerprintSecret`, the key's last segment is an HMAC-SHA-256 of the source
value keyed by that secret, and deduplication compares it, so a redacted
slot is not appended again on every call. The secret must stay the same for
a stream across processes; rotating it makes each slot re-append once.
Without a secret, nothing derived from the source is persisted (the segment
is `-`) and deduplication compares committed payloads, so a slot whose
payload a filter redacts is appended again on every call. An unkeyed hash is
never persisted, because anyone reading the redacted log could brute-force a
low-entropy value (a PIN, a short password) from it.

### Errors

Stores and the runtime reject with a `ContextLogError`. Use
`isContextLogError(error, kind)` rather than `instanceof`, so errors from
another copy of the SDK are recognised too.

| Kind | Class | Meaning | What the caller does |
| --- | --- | --- | --- |
| `conflict` | `ContextLogConflictError` | Lost a compare-and-swap race, reused an idempotency key, took an existing key, or broke the call lifecycle. `reason` says which; `head` carries the current head when known. | Do not dispatch. Reload the head and re-plan. |
| `not_found` | `ContextLogNotFoundError` | The thread, version or manifest does not exist, or was purged. | Stop. |
| `refused` | `ContextLogRefusedError` | The store or the admit hook refused the request. | Stop; retrying unchanged will not help. |
| `unavailable` | `ContextLogUnavailableError` | A transient failure; a write's outcome is uncertain. `retryable` is `true`. | Retry the same request, except `markDispatched` (see below). |
| `invalid` | `ContextLogInvalidError` | The request is malformed. | Fix the caller. |

### Idempotency and uncertain writes

Every write either commits completely or leaves the log unchanged, but a
caller can lose the response to a write that committed. Each write has a
recovery rule:

- **`prepare`**: retry exactly the same request, including its original
  expected revision. The store returns the committed manifest with
  `created: false` (even though the head has since moved), or commits it now.
  Reusing an idempotency key for any different request is an
  `idempotency_mismatch` conflict.
- **`appendOutputs`**: retry exactly the same request. Committed outputs are
  returned with `created: false`, even after a later transition has dropped
  them from the head's path.
- **`recordOutcome`**: repeat the same outcome; it is a no-op once recorded.
- **`markDispatched`**: never retry blindly. Read the manifest: if
  `dispatchedAt` is still `null`, mark it again; if it is set, do not send.
  Close the call (for example as `cancelled`) and prepare a new attempt.
  Nothing is sent until `markDispatched` has resolved, so a lost response
  never means the call was sent.

## The call lifecycle

```text
readHead ─▶ produce context ─▶ PreGenerate hooks ─▶ admit(prepare) ─▶ prepare
        ─▶ admit(dispatch) ─▶ markDispatched ─▶ send the committed input
        ─▶ PreGenerate hooks over the outputs ─▶ appendOutputs ─▶ recordOutcome
```

Nothing is sent without a committed manifest, and nothing generates from
output that has not been committed. An output lost to a crash before commit
leaves the call with an `unknown` outcome.

## Rules for the log-mode runtime

These constrain the runtime that later releases add on top of the contracts:

- **Redaction and guardrails apply before commit.** In log mode, the model
  only sees projections of committed entries, so content can reach it without
  passing through `options.messages`. Any check that legacy mode applies to
  `options.messages` (for example the secrets filter and guardrail
  `PreGenerate` hooks) must run on user input, producer output and tool
  results before they are committed.
- **One snapshot per call.** A call reads its stream's head once. Producers,
  admission, projection and the manifest all use that head's path. Decisions
  about history never combine separate reads.
- **Log mode and legacy history stay separate.** A log-mode agent never reads
  or writes `Checkpoint.messages` history, and the legacy checkpoint fallback
  paths do not apply to it.

## Request projection

With `contextLog: { mode: "log", store }`, every model request is built as

```text
project(core(version), path(head) + new user input, target)
```

through the configured `ProjectionAdapter`
(`createMessageProjectionAdapter()` by default):

1. The call reads its stream's head once. On a stream without a head, the
   call will create the first version (an `initial` transition) with the
   core from `systemPrompt` or `contextLog.resolveCore`.
2. Otherwise it reads the head's version and its full path. The **core is
   frozen per version**: the stored bytes are projected unchanged, and the
   resolver is never consulted for an existing version. The resolver is
   consulted again only when the call creates a `model_change` version (see
   [Model changes](#model-changes)). Adopting a new core for any other reason
   needs a `core_policy_change` transition.
3. The adapter projects the core, the path and the run's new user input
   for the target model. The result is sent as the request's messages, with
   no separate `system` parameter, alongside the agent's tools.
4. Every later provider step of the tool loop is projected the same way,
   from those entries followed by the assistant and tool messages the
   generation's earlier steps produced, as committed (see
   [the commit boundary](#the-commit-boundary)). No provider request bypasses the
   adapter, so its shaping and the contract's capability projection apply to
   tool results too, and each step's input starts with the previous step's.

Configuration:

```typescript
import { createAgent, MemoryContextLogStore } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  // The core of every new version. Or use contextLog.resolveCore.
  systemPrompt: "You are a helpful assistant.",
  checkpointer,
  contextLog: { mode: "log", store: new MemoryContextLogStore() },
});

await agent.generate({ prompt: "Hello", threadId: "thread-1" });
```

Rules in log mode:

- **Only new user input.** Pass it as `prompt`. Caller-supplied `messages`
  are rejected with a `ValidationError`, and so is a call without a
  `threadId`. Each attempt shows the prompt, with the producers' output, to
  the `PreGenerate` hooks as new input (see
  [Hooks in log mode](#hooks-in-log-mode)), so the secrets filter and
  guardrails redact or deny it before it is committed or sent. A retry
  resends the same, already committed input: retry hooks may only change
  operational options.
- **Frozen core.** `promptBuilder` is rejected: set a static `systemPrompt`
  (it may be empty) or `contextLog.resolveCore`, not both. Context that
  changes between calls belongs in runtime context entries.
- **The contract decides capability projection.** The runtime records
  `adapter`, `adapterVersion`, `imageInput` and `fileInput`
  (`ContextProjectionContractKey`) on the versions it creates. The default
  adapter replaces tool-result media with the legacy text placeholders when
  the contract says the model cannot accept it. A version whose recorded
  values differ from the current adapter and model's capabilities is not
  projected: the call fails with a `ContextLogConflictError` (reason
  `transition_required`) before anything is sent.
- **Checkpoints are control state.** A log-mode checkpoint holds the step,
  todos, files and any pending interrupt, plus a `ContextLogCursor` under
  `metadata.contextLog`. Its `messages` are always empty, and messages in a
  stored checkpoint are never restored. `invalidateCheckpoint()` reloads that
  control state; history always comes from the head.
- **Branches and streams.** A call runs on `{ threadId, branchId, streamId }`.
  Both ids default to `"main"`; set `contextStream: { branchId, streamId }` on
  the call to choose others (for example the host's session branch, or a
  delegated child's own stream). `contextStream` is rejected outside log mode.

## The commit boundary

Each generation attempt has a commit boundary. It wraps the attempt's
**terminal provider model**, so every provider request (each tool-loop step,
each AI SDK retry, each fallback attempt) passes through it, and it records
exactly what the provider receives:

1. **Prepare.** Before a call is sent, the boundary asks `contextLog.admit`
   (phase `prepare`), then commits the run's new input, any declared
   transition and the call's manifest in one compare-and-swap `prepare`
   against the head the call was planned from. The manifest's `inputDigest`
   is the SHA-256 of the provider call options (prompt, tool definitions and
   settings; not the abort signal, transport headers or `includeRawChunks`),
   `toolSnapshot` and `callOptions` hold their exact bytes, and
   `ordinal` / `attempt` number the run's calls (a retry with the same input
   is the next attempt of the same ordinal). The idempotency key is
   `call:<run>:<ordinal>:<attempt>`.
2. **Dispatch.** It asks `contextLog.admit` again (phase `dispatch`; a
   refusal closes the call as `cancelled`), marks the call dispatched, and only
   then calls the provider.
3. **Outputs.** Before the next step is projected, it commits the previous
   step's outputs with `appendOutputs`: the assistant message (with the model
   that produced it), then the tool results as the tool pipeline shaped them,
   and records the call `completed`. The outputs first pass the `PreGenerate`
   hooks as new input, so the secrets filter redacts them and guardrails can
   stop the run before they are committed; the committed, screened entries
   are what later steps see. The generation's options are fixed once it has
   started, so operational options a hook changes while screening outputs
   are ignored. A denial, hook violation or admit refusal is never retried,
   so a blocked step never runs its tools again. The next step is projected from the
   committed entries. The generation's last step is committed the same way
   before the run returns, so a run that ends with a plain reply leaves it as
   the last entry.

Failures:

| What happens | Result |
| --- | --- |
| `prepare` loses the compare-and-swap race, or the admit hook refuses | Nothing is sent; the call fails with the `ContextLogError`. |
| A write is uncertain (`unavailable`) | `prepare`, `appendOutputs` and `recordOutcome` are retried with the same request; `markDispatched` is never retried blindly (see above). |
| The provider call fails | The call is closed as `failed` (`cancelled` when aborted). A retry or fallback is a new attempt with its own manifest; the run's input is committed once. |
| An output commit fails | The run fails, including a streaming run whose failed commit the AI SDK turned into an error part. The call is closed as `unknown`, and nothing generates from the uncommitted output. The run is never retried and never falls back: the provider answered and its tools may have run. |
| The AI SDK throws after the provider answered (for example on invalid structured output) | The finished step's output is still committed and the call completed, then the error propagates without a retry or fallback. |
| Something fails after the run's last step was committed (a checkpoint save, a `PostGenerate` hook) | The error propagates and is never retried: a retry would run the model and its tools again and append a second reply. |
| The process crashes after prepare, or after dispatch before the output commit, or the call's outcome cannot be recorded | The call stays open until the next prepare on the stream, which closes it in the same atomic write (`closeSuperseded`): `cancelled` if it was never dispatched, `unknown` if it was (`completed` if its outputs were committed). Its outputs can no longer be committed, because the head has moved past its manifest. Tool side effects are recovered by the host's tool ledger, never by replaying the call. |

**One writer per stream.** The boundary treats any call it supersedes as
crashed. `markDispatched` does not move the head's revision, so another
process can read the head while a dispatched call and its tools are still
running, prepare, and close that live call as `unknown`: its outputs are then
refused, but its provider call and tool side effects continue. Hosts must
therefore enforce single-writer ownership of a stream across the whole
generation, tool and output lifecycle, with distributed fencing (for example
a run lease checked by the admit hook and the store). The SDK does not
enforce it.

When a call's tool definitions differ from the stream's previous call, the
manifest's `toolSnapshotChange` records the previous and new snapshot digests
and the cause (`model_change` when the previous call targeted another model,
otherwise `tool_definition`).

The boundary must be the last thing before the provider:

- Pass the **innermost provider model** as `model` and `fallbackModel`. A
  transform that runs after the boundary would send bytes the manifest does
  not describe.
- Put transforms that change the request (for example reasoning-option
  translation, tool-input sanitisation, JSON key ordering or media
  relocation) in `contextLog.requestMiddleware`, or in your
  `ProjectionAdapter`. The wrap order is

  ```text
  agent → projection → requestMiddleware[0] → … → requestMiddleware[n] → commit boundary → provider
  ```

  so the boundary digests and commits the request as the provider receives
  it: the prompt, tool definitions and settings, after the middleware. The
  digest never covers the abort signal, transport headers or
  `includeRawChunks`, so headers a middleware adds are not committed. The
  first middleware sees the projected request first. The middleware run on
  every provider call of the agent: each tool-loop step, each AI SDK retry
  and each fallback attempt, and SDK-built subagents inherit them with the
  projection adapter. Each middleware receives its own copy of the request
  data, so one that rewrites it in place cannot leak the change into the
  AI SDK's request, which a retry or later step reuses: every attempt
  applies the middleware exactly once to its projection. The log keeps the
  entries, not the transformed request: the manifest's `inputDigest`,
  `toolSnapshot` and `callOptions` describe the request after the
  middleware.
- Request middleware are part of the **serialisation contract**. A call is
  reconstructed offline by projecting the version's core and the path
  before the call, converting it to the provider prompt, adding the
  manifest's recorded `toolSnapshot` and `callOptions`, applying the pinned
  middleware once, and comparing the digest with `inputDigest`. For that to
  hold, request middleware must:
  - be deterministic, deriving changes only from the request they receive
    and their pinned configuration (no clocks, random values or external
    lookups);
  - leave the tool definitions and settings they produce unchanged when
    applied to them again, and never remove or overwrite a setting they read
    to shape the prompt (keep it, or record what they used in a setting
    they keep), because only the settings after the middleware are recorded;
  - be pinned like an adapter change: a change to what they produce needs a
    new projection adapter `id` or `version` (for example
    `{ ...createMessageProjectionAdapter(), version: "1+host.3" }`), which
    every version records.

  The SDK does not check these rules; a middleware that breaks them sends
  requests the log can no longer reproduce.
- Wrappers that do not change the request (usage accounting, telemetry,
  retries) can stay outside, around the agent, as before.
- A model id string is rejected in log mode, because the AI SDK would resolve
  it after the boundary. A model that already has a boundary is rejected too.

Background follow-ups (`waitForBackgroundTasks`) are runs of their own on the
same stream: each follow-up prompt passes the `PreGenerate` hooks as new user
input, then is planned and committed through a boundary like any other call.
In `streamDataResponse()`, a follow-up that raises an interrupt or stops the
run records the pending interrupt and ends the follow-ups.
Streaming fallbacks follow the legacy rules. `streamRaw()` and
`streamDataResponse()` retry or fall back only when starting the stream
throws synchronously. `stream()` retries within its own loop, but a provider
error raised inside the stream reaches it as the AI SDK's
`NoOutputGeneratedError`, which the default policy does not retry or fall
back on. A fallback that does happen is planned and committed like any
other attempt.
In `streamRaw()`, the last step is committed by the stream's `onFinish`; the
AI SDK cannot fail an already-returned stream, so a failed final commit closes
the call as `unknown` instead, and the log stays consistent.

### Model changes

A call to another model than the stream's previous call (a fallback, or a
host switching models) is a declared **`model_change`**, whether or not the
model's input capabilities differ, and so is a call to a model whose input
capabilities differ from the version's contract. The first prepare creates
a version that inherits the whole path, with the contract for the new model.
A different adapter id or version still fails with `transition_required`
until an `adapter_change` is declared.

The new version's core:

- With a static `systemPrompt`, it keeps the parent's core.
- With `contextLog.resolveCore`, the runtime calls the resolver with
  `reason: "model_change"`, the inherited `parent`, and the call's `target`
  (`{ provider, modelId }`, where the provider is the route the call takes)
  and terminal `model`. The `initial` call gets the same fields. A host whose
  core depends on the model family returns the core for the target; the
  `model_change` version records it, so the transition that declares the
  model change also declares the core change, and no separate
  `core_policy_change` is created. When the resolver returns the parent's
  bytes, the core is unchanged. The resolver must be deterministic for its
  input.

```typescript
const agent = createAgent({
  model: claude,
  fallbackModel: gpt,
  contextLog: {
    mode: "log",
    store,
    // Called for `initial` and `model_change` versions only.
    resolveCore: ({ target }) => corePromptFor(familyOf(target.modelId)),
  },
});
```

A compaction planned by the same call replaces the `model_change`, as
before, and its child records the resolved core.

## Compaction

With a `contextManager`, log mode compacts by a declared **`compaction`**
transition, never by rewriting history. When the context policy asks for
compaction, the call plans a child of the head's version:

```text
child path = the parent's leading runtime context (inherited)
           + the summary
           + the retained tail, re-appended unchanged in path order
           + the call's new input
```

and the call's own `prepare` commits the transition and those entries
before the compacted context is first sent. Later calls append to the
child and reuse its summary until the context policy asks for another
compaction.

- **When.** At the start of each attempt, on its head snapshot after the
  producers and the `PreGenerate` screening of new input, and between the
  steps of a tool loop, after the previous step's outputs are committed.
  Never while a call waits for its interrupt's resolution: such a stream
  fails with `interrupt_pending` before compaction is considered, and a
  resume's continuation compacts like any other generation. The
  decision is the context manager's policy (`shouldCompact`), and the
  `PreCompact` and `PostCompact` hooks run as in legacy mode.
- **Runtime context is never summarised.** The context manager sees every
  active `runtime_context` entry as a system message, which it always keeps,
  like the prompt-builder context it replaces. A version inherits a leading
  entry count, so the child inherits the leading run of active runtime
  context; everything after it is either summarised or re-appended.
- **The retained tail is re-appended exactly.** Each kept entry keeps its key
  and content, so assistant reasoning and provider options replay byte for
  byte, and a store that keeps content by digest stores no second copy. A
  tool call, its approval request, its resolution and its result are kept
  or summarised together. The context manager is shown a resolution and the
  result that follows it as one tool message, so its retention keeps or
  summarises the whole block before it generates a summary, and the pair
  counts once against its tool-result quota; with another manager, keeping
  any of them
  keeps all of them (a child that would still split them is refused with
  `ContextLogInvalidError`, reason `compaction_split_tool_call`). A
  re-appended entry whose `supersedes` target is no longer on the child's
  path loses the reference (it is the slot's current value), and a
  retraction of such a target is dropped.
- **Only progress is committed.** When the child would keep every
  conversation entry (for example a single tool block over budget on its
  own), or a context manager drops history without returning a summary, no
  transition is declared and the head's version stays current.
- **The summary is new content.** It is an `assistant` entry (or a `user`
  entry, if a custom context manager returns one) and passes the
  `PreGenerate` hooks before it is committed, so the secrets filter redacts
  it. Kept messages are recognised by identity: a custom `ContextManager`
  must return the messages it keeps as the same objects it was given, and
  every other message it returns is treated as new content.
- **Summaries run on their own stream.** A log-mode agent only accepts new
  user input, so it cannot generate a summary itself: configure
  `ContextManagerOptions.summarizer`. Each `SummaryRequest` carries
  `contextLog` (`CompactionContextLog`): the run id, the compacted stream, a
  `sourceDigest` identifying the compacted source, and `summaryStream`,
  `{ threadId, branchId, streamId: "<runId>/summary/<sourceDigest>" }`. Run
  the summary there, for example on a log-mode summary agent with
  `contextStream: { branchId, streamId }`. Without a summarizer the
  compaction fails.
- **A failed commit fails the run.** If the `prepare` that carries the
  transition fails after its identical-request retries, nothing compacted is
  sent and the step fails. The run is not retried and does not fall back,
  so a retry hook cannot summarise and compact again.
- **Input is committed once.** A run's input is never appended again once a
  prepare committed it, even after a compaction summarised it off the path,
  so a retry after a later failure resends the same compacted context.
- **Supersession is checked first.** New runtime context that supersedes a
  missing entry, a non-runtime entry or an entry that is already superseded
  fails with `invalid_supersession`, as it would at commit.
- **No legacy write.** `commitCompaction` is not called for a log-mode
  compaction (the transition is the commit), and `onCompact` still reports
  the generated result. The legacy error-fallback compaction, which rewrites
  checkpoint messages after a context-length error, does not run in log
  mode.
- **Pinned messages.** `pinMessage()` indices refer to the messages the
  context manager is shown (the core, then the active entries), which
  change between calls; prefer runtime context for content that must stay.

A compaction on a call that also changes model creates one `compaction`
version under the new model's contract.

## Interrupts and resume

A pending interrupt is control state: the checkpoint's `pendingInterrupt`,
as in legacy mode. The interrupted call itself is on the log, and resuming
it only appends:

| Step | What is committed |
| --- | --- |
| A tool calls `interrupt()` | The step's outputs, except the interrupted call's `[Interrupt requested]` placeholder result. The assistant entry that made the call also carries an AI SDK `tool-approval-request` part whose `approvalId` is the interrupt's id. Other results of the step are committed as usual. |
| `resume()` approves or answers | A `tool_result` entry with a `tool-approval-response` part (the **resolution**), then the tool runs, then a `tool_result` entry with its result |
| `resume()` rejects | The resolution and the denial result, in one write; nothing runs |

The resolution records the decision: `approved` and the approval's
`reason`, or, for a custom interrupt, `approved: true` with the answer in
`reason` as canonical JSON of `{ "answer": <value> }` (`{}` when there is no
answer), so a custom answer must be JSON-serialisable. The `PreGenerate`
hooks screen it like any other text. The **committed, screened resolution is
authoritative**: the tool always runs with the decision it records, on the
first run and on recovery alike, so a redacted answer reaches the tool
redacted. If screening leaves an answer that no longer decodes (for example
a redacted number), the resume fails closed with a `ContextLogInvalidError`
(reason `invalid_resolution`) and the tool does not run.

The AI SDK's prompt conversion drops approval requests and responses that
are not provider-executed, so neither ever reaches a provider. A custom
`ProjectionAdapter` must pass them through as stored (or drop them) and
must never re-render them as other content, such as text or tool results;
otherwise the resolution and a custom answer would reach the model.

Both entries are outputs of the interrupted call (`appendOutputs` on its
manifest, which still owns the head), so they pass the `PreGenerate` hooks
before commit like any other output. Their keys are
`interrupt:<id>:<createdAt>:resolution` and `interrupt:<id>:<createdAt>:result`.
After the commit, the pending interrupt is cleared and an ordinary log-mode
generation continues from the path, with no separate prompt derivation.
Producers run as they do before any generation, so a slot whose value is
unchanged appends nothing.

The AI SDK drops approval parts that are not provider-executed before a
request reaches the provider, and merges adjacent tool messages. The
continuation therefore sends the provider the same input as a run that was
never interrupted, and the log holds that run's entries plus the interrupt
and its resolution. (If the interrupted step also called other tools,
their results were committed when the interrupt was raised, so the resumed
result follows them.)

Rules:

- **The tool runs through the normal pipeline.** An approved or answered
  call runs again with the input the log committed for it and its own tool
  call id, through permission mode, the `PreToolUse` and `PostToolUse` hooks
  and signal catching. The resume's response answers the tool's
  `interrupt()`; for an approval, the permission layer also sees the
  decision. A thrown error becomes an `error-text` result, as in a normal
  step. A rejection does not run the tool: its result is
  `Tool "<name>" was denied by user[: <reason>]`, as in legacy mode.
- **An unresolved interrupt blocks the stream.** A call whose approval
  request has no result cannot be projected, so `generate()` and the other
  modes fail with a `ContextLogConflictError` (reason `interrupt_pending`)
  before anything is committed. Resume it first.
- **A tool that interrupts again** (for example a multi-step form) keeps its
  call unresolved. The round's resolution stays on the log, the new interrupt
  becomes the pending interrupt, and `resume()` returns it.
- **Stream.** `resume()` uses the call's `contextStream`, like `generate()`.
  An interrupt that is not on that stream's path is a
  `ContextLogNotFoundError` (resource `interrupt`). If the stream moved past
  the interrupted call, it cannot be resumed (`head_moved`).
- **Control state is restored first.** `resume()` loads the checkpoint
  through the agent's checkpoint runtime, so a fresh agent restores the
  thread's todos and files before the tool runs, and the checkpoint it saves
  keeps any changes the tool made.
- **`AgentSession`** leaves background task events queued, and their tasks
  registered, while an interrupt is pending, so their results are not
  consumed by a turn that would be refused. After every resume, whether it
  succeeded or failed, the session reads the pending interrupt back from the
  checkpoint before taking more events.
- Workflow-gated agents still cannot use `resume()`.

### Crash safety

The resolution is committed **before** the tool runs. A resume that finds
the resolution of the pending interrupt but no result knows that an earlier
attempt may have started the tool and stopped (for example a crash) before
its result was committed. The tool may have had its side effects, so by
default the resume fails with a `ContextLogConflictError` (reason
`resume_in_doubt`) and never runs the tool again. The stream stays blocked.

Recovering is the host's job, because only the host's **tool ledger** knows
whether the call ran. A host whose ledger makes a repeated execution of the
same tool call id safe sets `contextLog.inDoubtResume: "reexecute"`. The
resume then runs the call again through the pipeline with the same tool call
id, so a `PreToolUse` hook keyed by it can answer with the recorded result
(`respondWith`) instead of running the side effect a second time. The
re-run repeats the decision the log recorded (the approval, or the custom
answer), not the one passed to the new `resume()`; a rejection never re-runs
anything.

The host's single-writer requirement (see [the commit
boundary](#the-commit-boundary)) covers resume too. The SDK does not fence
two concurrent resumes of the same interrupt: the resolution is an
idempotent output commit, so both could commit it and both could run the
tool. Hold the stream's run lease across `resume()` as across a generation.

Other failure points recover without that:

| Crash or failure | Next `resume()` |
| --- | --- |
| Before the resolution is committed | Resumes normally; nothing ran |
| After the result is committed, before the pending interrupt is cleared | Does not run the tool; clears the interrupt and continues |
| After the interrupt is cleared, before the continuation finishes | There is nothing to resume. Continue with an ordinary generation without a prompt. |
| The `PreGenerate` hooks deny the result | The result is not committed, so the resume is in doubt as above |

## Subagent streams

When a log-mode agent delegates with the `task` tool, the subagent keeps its
history on a stream of its own in the parent's store, on the parent's thread
and branch:

- The child stream is derived from the parent call's stream and the
  originating `toolCallId`: by default
  `<parent stream>/subagent/<type>-<digest>`, where the type is
  percent-encoded (`encodeURIComponent`, so it never contains `/`) and the
  digest is the first 32 hex characters of the SHA-256 of the tool call id
  (`deriveSubagentContextStream`). A host can choose another with
  `contextLog.subagentStream`, which must be deterministic and give each
  delegation its own stream.
- The factory receives it as `SubagentCreateContext.contextLog`
  (`{ store, stream, parentStream }`) and must return an agent in log mode on
  that store. Give the child no checkpointer, or one of its own: a log-mode
  child that shares the parent's checkpointer is rejected, because both would
  save control state under the same `threadId`. The task tool runs the child
  with the task as its prompt on the child stream, so the child's calls go
  through its own commit boundary.
- The child's history is its stream, so a host that runs a delegation as
  several bounded `generate()` calls (for example to continue after a step
  limit) passes the same options with a new prompt each time, and every call
  continues from the committed history. No private checkpointer is needed.
- The delegation's result is always the child's **committed** final reply,
  read from its stream once the child's run (and, for a streaming subagent,
  its stream) has fully settled. A first run therefore returns exactly what
  recovery would later read back: the reply as the input filters screened it,
  without a `PostGenerate` hook's `updatedResult`, and for a streaming
  subagent the last reply's text rather than every step's streamed text. A
  run that did not commit a final reply (it stopped on a tool call, was
  interrupted, or its final output commit failed) rejects with
  `DelegationRecoveryRequiredError`, as below.
- The parent receives that reply as an ordinary tool result, committed on the
  parent's stream like any other.

```typescript
const researcher: SubagentDefinition = {
  type: "researcher",
  description: "Researches a topic",
  create: (ctx) =>
    createAgent({
      model: providerModel,
      systemPrompt: "You are a researcher.",
      contextLog: ctx.contextLog && { mode: "log", store: ctx.contextLog.store },
    }),
};
```

The built-in general-purpose and plugin subagents do this themselves, with
the parent's `admit` hook and projection adapter (not its producers).

**Recovery.** When a delegation is created again for the same tool call (for
example when a host re-executes a tool call after a crash), the task tool
reads the child stream before anything else (`readSubagentDelegation`):

| Child stream | Result |
| --- | --- |
| No head | The delegation starts. |
| The last call committed a final reply (an assistant message without tool calls, appended by that call's own output commit) and its outcome is `completed` or not yet recorded | That reply is the tool result. The factory, the subagent hooks and the model are not called. |
| Any other head (a crash mid-task, a call recorded `failed`, `cancelled` or `unknown`, a run that stopped on a tool call) | The tool call rejects with `DelegationRecoveryRequiredError` (a `ContextLogRefusedError` with reason `delegation_recovery_required`, carrying the stream and head). |

An outcome that is not yet recorded counts when the final reply is already
committed: the outputs are durable, and the stream's next prepare would
close the call `completed` (`closeSuperseded`). An explicit `failed`,
`cancelled` or `unknown` outcome is never read back.

The SDK never replays the task on an existing child stream: the child's tools
may already have run. A background delegation (`run_in_background`) checks the
stream before it starts, so the error rejects the tool call too. Under an
`ownedTaskPolicy`, the owned runner first replays an in-process delivery for
the same tool call; a background owned delegation that needs recovery is
reported as a failed task. The error reaches the host's `transformToolError` and
`PostToolUseFailure` hooks; as with any failed tool, the AI SDK then gives
the model a tool error, which is committed as the parent's tool result.


**Concurrent deliveries.** The task tool's check and the child's first call
are not one atomic step, so two deliveries of the same tool call could both
find no head. Each delegation therefore claims its stream: every child call
it makes plans only on the head revision the delegation itself last left
(none, before its first write), and the stream's compare-and-swap covers the
window between planning and prepare. A delivery whose stream another
delivery moved never appends the task again: it re-reads the stream and
returns the committed final reply, or rejects with
`DelegationRecoveryRequiredError`. The claim travels in the generate options
the task tool passes to the subagent, so a host that wraps the subagent's
`generate()` (for example in a bounded loop) must spread those options into
each call, or it loses this protection. Hosts should still hold one lease
over the whole delegation, from the tool call to its result, as part of
their single-writer obligation for streams.

## Hooks in log mode

Hooks never rewrite the log. In log mode they may only:

- **append context**, through producers;
- **transform new input** before it is committed. `PreGenerate` hooks see
  `options.messages` set to the call's new input only (the user's message,
  producer output, new tool calls and results, and any imported history),
  never committed entries. A message whose content is a string is shown as
  itself. Any other entry is shown as a message of the same role, with one
  text part per string it carries: text and reasoning parts, a tool call's
  input, a tool result's text or JSON value, or a runtime context payload.
  Inside caller data (a tool call's input, a JSON tool result's value, a
  runtime context payload) object keys and finite numbers are shown too: a
  number as its decimal text, a key as its name. A redacted number is
  written back as a string (deliberately: redaction wins, so a tool call's
  input may no longer match a numeric schema), and a key renamed onto a key the object already
  has (which would merge two fields) is a violation. Booleans and `null` are
  not screened. Ids, part types, binary data and provider options are not
  shown. Text
  filters can therefore scan and redact all of it, and the transformed text
  is written back without changing the entry's structure. The secrets filter
  and guardrails keep redacting and blocking new input, and the redacted
  content is what gets committed.

  Unlike legacy mode, where every hook sees the same input and the first
  `updatedInput` wins, log-mode `PreGenerate` hooks run one after another.
  Each hook sees the input as the earlier hooks left it, so an operational
  hook can never discard another hook's redaction. Any hook's denial stops
  the call.
- **change operational options**: `maxTokens`, `temperature`,
  `stopSequences`, `signal`, `shouldStopAfterStep`, `headers`, `telemetry`,
  `experimental_telemetry`, `requestClass` and `onStreamWriterReady`.
  `providerOptions` is fixed for the call, because some providers accept
  model input through it (such as replacement instructions or server-side
  history);
- **gate execution**: deny a generation (`permissionDecision: "deny"`, which
  throws `GeneratePermissionDeniedError` before anything is committed) or a
  tool call;
- **shape a new tool result** in `PostToolUse` (caps, notices, sanitisation).
  The tool's returned value is what the runtime commits, so the transform is
  in the committed `tool_result` entry and is never applied again later.

Anything else throws a `ContextLogInvalidError` with reason
`log_mode_hook_violation` and a message naming the hook and the change:
adding or removing messages, changing a message's role or a
runtime context entry's shape, setting `prompt`, changing `instructionLayers`,
`memory`, `output`, `threadId` or any other non-operational option, and
`respondWith` (its response would never be committed). Hooks receive
copies of the options, so changes made in place are caught as well as
returned ones. Options that are not plain JSON, such as `output` and
`streamingContext`, are withheld from hooks and restored afterwards. Options
a `PostGenerateFailure` hook or a retry policy returns for a retry follow
the same rule, and the input cannot change at all because it is already
being sent: the runtime snapshots the attempt's options before the hooks
run, gives them an isolated copy, and resends the attempt's own input.

| Legacy hook use | Log-mode equivalent |
| --- | --- |
| `PreGenerate` redacts or blocks `options.messages` (secrets filter, guardrails, PII transforms) | Unchanged: the hook sees and transforms only new input, before commit |
| `PreGenerate` injects context or rewrites history in `options.messages` | A `ContextProducer` that appends (and supersedes or retracts) `runtime_context` |
| `PreGenerate` changes `instructionLayers`, `memory` or the prompt | A producer for dynamic context; changing the frozen core is a `core_policy_change` transition |
| `PreGenerate` changes limits, sampling, headers or the signal | Unchanged |
| `PreGenerate` changes `providerOptions` | Not supported; set them on the call |
| `PreGenerate` `respondWith` (response cache) | Not supported |
| `PostGenerateFailure` retries with different messages | Not supported; retry with operational changes only |
| `PreToolUse` deny, `updatedInput` or `respondWith` | Unchanged; a synthetic result is a new tool result |
| `PostToolUse` `updatedResult` | Unchanged; the shaped result is what is committed |
| `PostGenerate` `updatedResult` | Unchanged: it shapes the result returned to the caller, not the committed output |

## How log mode maps to legacy concepts

| Legacy mode | Log mode |
| --- | --- |
| `Checkpoint.messages`, overwritten per thread | The path at the stream's head, read with `readPath` |
| `threadId` | `ContextStreamRef.threadId`; branches and streams are explicit |
| System prompt rebuilt every generation | Frozen core bytes on the version; changing it is a `core_policy_change` transition |
| Prompt builder context (dates, memory, files) | `ContextProducer`s appending `runtime_context` entries, deduplicated by key and superseded rather than rewritten |
| Compaction replaces the messages array | A `compaction` transition: a child version that inherits the leading runtime context, then holds the summary and the re-appended retained tail (see [Compaction](#compaction)) |
| Forking or editing a message | A `branch` transition on a new branch, inheriting the unedited prefix |
| `PreGenerate.updatedInput` | Only operational options and transforms of new input; see [Hooks in log mode](#hooks-in-log-mode) |
| Checkpoint save after a generation | `appendOutputs` for each step's output and tool results, then `recordOutcome` |
| Resume from a checkpoint | Read the head and project its path |
| `resume()` appends a constructed tool call and result to the checkpoint and regenerates | `resume()` appends the resolution and the tool's result as outputs of the interrupted call, then runs an ordinary generation |

Run control state that is not history (pending interrupts, todos, files) stays
in the checkpoint.

## Implementing a store

`MemoryContextLogStore` is the reference implementation. Any other store should
pass the conformance suite from `@lleverage-ai/agent-sdk/testing`. The suite
is framework-agnostic: pass your framework's `describe` and `it`.

```typescript
import { describe, it } from "vitest";
import { defineContextLogStoreConformanceSuite } from "@lleverage-ai/agent-sdk/testing";

defineContextLogStoreConformanceSuite(
  "PostgresContextLogStore",
  {
    createStore: () => store,
    // Provision a fresh thread (for example a session row) for each case.
    createThreadId: async () => (await createTestSession()).id,
  },
  { describe, it },
);
```

The cases cover compare-and-swap conflicts, concurrent prepares, idempotent and
uncertain retries, byte-exact content, pagination, the call lifecycle,
transitions, branch inheritance, independent streams, output ownership,
racing writes, supersession and sparse-array rejection. If your store
requires call fields that the contract leaves optional (such as `toolSnapshot`
or `ordinal`), the suite fills deterministic placeholders, and the
`completeManifest` hook can replace them with host-required values or add
required host keys to `metadata` (it must keep the keys the suite set). A store may scope
idempotency keys and manifest ids more narrowly (for example per session),
and it may report additional, store-specific conflict reasons.

Rules every store follows:

- Writes are atomic and leave the log unchanged when they fail.
- Content must survive a JSON round trip unchanged. Sparse arrays, `undefined`
  array elements, non-finite numbers and non-plain objects are `invalid`.
- Entries, versions and manifests never change after commit, except a
  manifest's dispatch time and outcome.
- A path reference reads only versions created on its own stream; read an
  ancestor's entries through a reference to the inheriting version.
- Entry keys are unique along a path, including the inherited prefix. Sibling
  branches may reuse keys after they diverge.
- A transition's parent must be on the same thread and stream id, and can be
  inherited by any branch. A stream without a head needs a transition; a root
  transition (no parent) is only allowed on a stream without a head.
- A store whose own digest depends only on content (for example a root over
  core, contract and inherited prefix) can expose a version-qualified digest,
  so that every new version still changes `pathDigest`.
- `pathDigest` is opaque and store-defined: rereading a head returns the same
  digest, and every write that adds entries or starts a new version changes
  it. A prepare without a transition that appends nothing keeps the digest but
  still moves `revision`.
