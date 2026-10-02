# Context log mode (experimental)

> **Status:** experimental. This release ships the contracts, an in-memory
> store, a store conformance suite and the core of the log-mode runtime:
> [request projection](#request-projection), [producers](#producers), the
> [hook rules](#hooks-in-log-mode) and the
> [commit boundary](#the-commit-boundary), which commits every call's input
> before dispatch and every model output before anything uses it.
> Compaction, resume and subagent streams land in later releases. Agents
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
  - `prepare({ stream, expectedRevision, idempotencyKey, transition?, append, manifest })`
    commits an optional transition, the entries to append and the manifest in
    one atomic, compare-and-swap write, and moves the head by one revision.
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
   resolver is never consulted for an existing version. Adopting a new core
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
- **Not yet supported.** `contextManager` (compaction) and `resume()` /
  `resumeDataResponse()` throw until their log-mode support lands. Subagents
  do not inherit log mode.

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
| An output commit fails | The run fails, including a streaming run whose failed commit the AI SDK turned into an error part. The call is closed as `unknown`, and nothing generates from the uncommitted output. |
| The AI SDK throws after the provider answered (for example on invalid structured output) | The finished step's output is still committed and the call completed, then the error propagates. |
| Something fails after the run's last step was committed (a checkpoint save, a `PostGenerate` hook) | The error propagates and is never retried: a retry would run the model and its tools again and append a second reply. |
| The process crashes after prepare, or after dispatch before the output commit | The call stays open. The next prepare on the stream closes it: `cancelled` if it was never dispatched, `unknown` if it was (`completed` if its outputs were committed). Its outputs can no longer be committed, because the head has moved past its manifest. Tool side effects are recovered by the host's tool ledger, never by replaying the call. |

A fallback model whose input capabilities differ from the head version's
contract (for example no image input) is a declared **`model_change`**: the
first prepare creates a version that inherits the whole path under the same
frozen core and the new contract. A different adapter id or version still
fails with `transition_required` until an `adapter_change` is declared.

When a call's tool definitions differ from the stream's previous call, the
manifest's `toolSnapshotChange` records the previous and new snapshot digests
and the cause (`model_change` when the previous call targeted another model,
otherwise `tool_definition`).

The boundary must be the last thing before the provider:

- Pass the **innermost provider model** (after any media or transport
  middleware) as `model` and `fallbackModel`, or move those transforms into
  your `ProjectionAdapter`, which is pinned and versioned. A transform that
  runs after the boundary would send bytes the manifest does not describe.
- A model id string is rejected in log mode, because the AI SDK would resolve
  it after the boundary. A model that already has a boundary is rejected too.

Background follow-ups (`waitForBackgroundTasks`) are runs of their own on the
same stream: each follow-up prompt passes the `PreGenerate` hooks as new user
input, then is planned and committed through a boundary like any other call.
In `streamDataResponse()`, a follow-up that raises an interrupt or stops the
run records the pending interrupt and ends the follow-ups.
In `streamRaw()`, the last step is committed by the stream's `onFinish`; the
AI SDK cannot fail an already-returned stream, so a failed final commit closes
the call as `unknown` instead, and the log stays consistent.

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
| Compaction replaces the messages array | A `compaction` transition: a child version that inherits a prefix and appends the summary |
| Forking or editing a message | A `branch` transition on a new branch, inheriting the unedited prefix |
| `PreGenerate.updatedInput` | Only operational options and transforms of new input; see [Hooks in log mode](#hooks-in-log-mode) |
| Checkpoint save after a generation | `appendOutputs` for each step's output and tool results, then `recordOutcome` |
| Resume from a checkpoint | Read the head and project its path |

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
