# Context log mode (experimental)

> **Status:** experimental. This release ships the contracts, an in-memory
> store and a store conformance suite. The log-mode runtime (projection,
> commit before dispatch, append-only hooks, compaction, resume and subagent
> streams) lands in later releases. Until then `createAgent` rejects
> `contextLog: { mode: "log" }`, and every agent keeps its legacy behaviour.
> The exports may change before they are marked stable.

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
    dispatched call's assistant output and tool results.
  - `recordOutcome(manifestId, outcome)` records `completed`, `failed`,
    `cancelled` or `unknown`.
- **`ContextProducer`** returns `runtime_context` entries to append before a
  call. Producers are deterministic and append-only. The entry key is the
  deduplication key: the runtime skips entries whose key is already on the path.
  `supersedes` names an earlier entry that projection should skip from now on.
- **`ProjectionAdapter`** turns a version and its path into model messages. It
  is versioned: changing its output for an existing path needs a new version
  and an `adapter_change` transition.
- **`ContextAdmitHook`** lets the host authorise every prepare and every
  dispatch (for example by re-checking access). It allows or refuses; it never
  rewrites the request.

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
readHead ─▶ produce context ─▶ admit(prepare) ─▶ prepare ─▶ admit(dispatch)
        ─▶ markDispatched ─▶ send the committed input ─▶ appendOutputs
        ─▶ recordOutcome
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

## How log mode maps to legacy concepts

| Legacy mode | Log mode |
| --- | --- |
| `Checkpoint.messages`, overwritten per thread | The path at the stream's head, read with `readPath` |
| `threadId` | `ContextStreamRef.threadId`; branches and streams are explicit |
| System prompt rebuilt every generation | Frozen core bytes on the version; changing it is a `core_policy_change` transition |
| Prompt builder context (dates, memory, files) | `ContextProducer`s appending `runtime_context` entries, deduplicated by key and superseded rather than rewritten |
| Compaction replaces the messages array | A `compaction` transition: a child version that inherits a prefix and appends the summary |
| Forking or editing a message | A `branch` transition on a new branch, inheriting the unedited prefix |
| `PreGenerate.updatedInput` | No equivalent: hooks may only append context, shape a new tool result before commit or gate execution |
| Checkpoint save after a generation | `appendOutputs` for each output and tool result, then `recordOutcome` |
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
transitions, branch inheritance and independent streams. A store may scope
idempotency keys and manifest ids more narrowly (for example per session),
and it may report additional, store-specific conflict reasons.

Rules every store follows:

- Writes are atomic and leave the log unchanged when they fail.
- Entries, versions and manifests never change after commit, except a
  manifest's dispatch time and outcome.
- A path reference reads only versions created on its own stream; read an
  ancestor's entries through a reference to the inheriting version.
- Entry keys are unique along a path, including the inherited prefix. Sibling
  branches may reuse keys after they diverge.
- A transition's parent must be on the same thread and stream id, and can be
  inherited by any branch. A stream without a head needs a transition; a root
  transition (no parent) is only allowed on a stream without a head.
- `pathDigest` is opaque and store-defined: rereading a head returns the same
  digest, and every write that adds entries or starts a new version changes
  it. A prepare without a transition that appends nothing keeps the digest but
  still moves `revision`.
