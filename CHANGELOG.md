# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `GenerateOptions.contextHistory` (`ContextHistoryInput`, experimental)
  lets a log-mode host commit history written outside the agent with a
  run's first prepare, before the run's input. With `root` on a stream
  without a head, the entries become the stream's first version, declared
  as the new `legacy_projection_import` transition reason
  (`LEGACY_PROJECTION_IMPORT_REASON`) with the root's metadata; on a stream
  that already has a head, or on a `branchFrom` branch, the root history is
  ignored, so concurrent first runs converge on one import. Without `root`,
  entries already on the path are skipped and the rest are pure appends
  after it, so a repeated or retried run never duplicates them (the host
  tracks what it supplied across compactions). Every entry
  passes the `PreGenerate` hooks with the run's input and keeps its key and
  metadata. A root import whose history ends with an unanswered tool call
  fails with `ContextLogInvalidError` (reason
  `history_unanswered_tool_call`) before anything is committed. Malformed
  history is a `ValidationError`, and `contextHistory` outside log mode is a
  `ConfigurationError`. The store conformance suite checks that a store
  round-trips an imported root version and appended history. (LLE-14014)

## [1.0.0-rc.8] - 2026-10-02

Eighth release candidate for 1.0.0. In log mode, supersession is
append-only in the projection: a superseded `runtime_context` entry or a
retraction stays where it was committed, so a changing slot such as the
date or a memory digest only extends the projected prefix and the
provider prompt cache survives it. The default projection adapter moves
to version `2`, so existing default-adapter log streams declare one
`adapter_change` (rc.7) on their next call. Legacy agents are unchanged.

### Migration notes

- **Legacy mode.** No code change and no behaviour change from rc.7. The
  projection adapter only runs in log mode.
- **Default adapter.** Existing log-mode streams on the default adapter
  declare one `adapter_change` on their next call (version `1` to `2`); the
  new version projects append-only, which re-sends superseded entries once.
  An `admit` hook that allow-lists transition reasons must admit
  `adapter_change` (see rc.7).
- **Host adapters** that wrap `createMessageProjectionAdapter()` get the new
  behaviour on versions that record `supersession: "append"`. Bump your
  adapter's version so existing streams move to such a version with an
  `adapter_change`; without a bump, existing versions keep dropping
  superseded entries and new streams project append-only. Hosts that persist
  contracts must keep the `supersession` key.

### Changed

- **Log mode: supersession is append-only in the projection** (LLE-14025).
  `createMessageProjectionAdapter()` (now version `2`) keeps superseded
  `runtime_context` entries and retractions in their original positions
  instead of dropping them, so a slot change (a date, a memory digest) only
  extends the projected prefix and the provider's prompt cache survives it.
  An entry that supersedes another is rendered with the line
  `(updates earlier context)` before its payload; a retraction is rendered as
  `(removes earlier context: the following no longer applies)` followed by
  the retracted entry's text. Keys and producer names are never rendered.
  The runtime records `supersession: "append"` in the contract of every
  version it creates for a new contract (initial, branch, and adapter, model
  or core transitions; a compaction child keeps its parent's contract);
  versions without it keep projecting as before. Compaction is the only
  place superseded entries are dropped: the child inherits only active entries
  (`activeContextEntries()`). On an append-only version the context manager
  also counts superseded entries and retractions (as system messages it
  never summarises), and a compaction that keeps every conversation message
  and only drops them is declared without a summary. A compaction child
  keeps its parent's contract, as it does for `userMedia`.

## [1.0.0-rc.7] - 2026-10-02

Seventh release candidate for 1.0.0. It adds four log-mode changes that
hosts need to run log mode on existing sessions: `Agent.resumeStream()`
streams the continuation of a resumed interrupt, a prepare names which of
its `user` entries are the run's new input, log mode declares an
`adapter_change` or `core_policy_change` instead of failing when the host's
projection adapter version or core version changes, and
`contextStream.branchFrom` starts a branch that continues another branch's
path. Legacy agents are unchanged.

### Migration notes

- **Legacy mode.** No behaviour change from rc.6. `resumeStream()` also
  works in legacy mode, with `resume()` semantics, and `resume()` and
  `resumeDataResponse()` are unchanged. Code that implements the `Agent`
  interface itself (rather than using `createAgent()`, `createMockAgent()`
  or the recorder) must add `resumeStream()`; it is a type error until it
  does.
- **Resuming with a stream.** Hosts that resumed with `resume()` and then
  called `stream()` for the continuation can call `resumeStream()` instead:
  it commits the resolution and the tool result exactly as `resume()` does,
  then yields `stream()`'s parts. It is lazy, so a refused resume throws from
  the first `next()`. `prompt` and `input` are ignored. If the tool interrupts
  again, the generator ends without parts; read the new interrupt with
  `getInterrupt()`. If the continuation fails after the result is committed,
  continue with plain `stream({ threadId })`.
- **Run input on prepares.** `ContextPrepareRequest.runInput` lists the
  run's new `user` entries with their index in `input` (`0` for `prompt`).
  Hosts that parsed SDK entry keys to find the run's input can read it
  instead. It is absent when a prepare appends no new input, so those
  requests are unchanged. A `ContextLogStore` need not persist it. A custom
  store that digests the whole request for idempotency gets a different
  digest for a prepare with new input than rc.6 did; an uncertain prepare
  written by rc.6 and retried by rc.7 then conflicts instead of replaying.
  `MemoryContextLogStore` digests it only when present.
- **Adapter version changes.** A head version projected under another
  `version` of the same adapter `id` used to fail every later call with
  `transition_required`. rc.7 declares an `adapter_change`: the new version
  inherits the whole path, keeps the frozen core without calling
  `resolveCore`, and records the current contract. Hosts that bump their
  adapter version (for example because it pins dependency versions) no
  longer have to rewrite or abandon existing log streams. An `admit` hook
  that allow-lists transition reasons must admit `adapter_change`, or those
  calls are refused. A different adapter `id` still fails with
  `transition_required`, and an adapter version change alone is no longer a
  `model_change`. Known limitation: reading a pending interrupt for
  `resume()` or `resumeStream()` projects the head's version with the
  current adapter and does not check its contract, as in rc.6.
- **Core versions (opt-in).** Set `contextLog.coreVersion` to record the
  host's core version on every new version (contract key
  `CORE_VERSION_CONTRACT_KEY`, `"coreVersion"`). A call whose head recorded
  another value, or none, declares a `core_policy_change` that inherits the
  whole path with the current core, from `resolveCore({ reason:
  "core_policy_change", ... })` or the static `systemPrompt`. Turning the
  option on therefore declares one `core_policy_change` on each existing
  stream's next call; an `admit` hook must allow it. Without the option
  nothing is recorded or declared. When several causes hold, one transition
  is declared, in the precedence `core_policy_change`, `model_change`,
  `adapter_change`, and it records the current contract; a compaction
  planned by the same call still replaces it.
- **Branches (log mode).** A fork, an edited message or a regenerated reply
  can pass `contextStream.branchFrom` (a `ContextPathRef` on the same thread
  and stream id, on another branch) on a stream with no head. The first
  prepare commits a `branch` transition that inherits exactly that path and
  records the call's contract, including `coreVersion` when it is set. Its
  core is the one `resolveCore` returns for `reason: "branch"`; without a
  resolver it is the source version's core, or the static `systemPrompt`
  when the source recorded another `coreVersion` (the branch adopts the
  current core). Because the branch records the current contract, a source
  projected under another `version` of the same adapter is continued
  without a separate `adapter_change`; a source under another adapter `id`
  still fails with `transition_required`. A source with an unresolved
  interrupt is refused with the interrupt conflict. An `admit` hook must
  allow `branch` for these calls. Later calls may keep passing the same
  `branchFrom`; if the branch's head no longer descends from that
  transition they fail with `branch_source_mismatch` before committing
  anything. Calls without `branchFrom` plan exactly as in rc.6, and
  `ContextLogStore` implementations need no change.

### Added

- `Agent.resumeStream()` resumes a pending interrupt like `resume()` and
  streams the continuation as `StreamPart`s through `stream()`. In context log
  mode it commits the resolution and result exactly as `resume()` does, never
  takes new input, and follows `stream()`'s commit boundary and retry-safety
  rules. If the tool interrupts again it ends without parts; read the new
  interrupt with `getInterrupt()`. `createMockAgent()` and the recorder
  implement it. Code that implements the `Agent` interface itself needs the
  new method. (LLE-14004)
- `ContextPrepareRequest.runInput` (`ContextRunInputRef[]`, experimental)
  lists the `user` entries of a prepare's `append` that are the run's new
  input, each with its `index` in `GenerateOptions.input` (`0` for
  `prompt`), so hosts can map input messages to their own records without
  parsing SDK key formats. A compaction's summary and retained tail, and
  input an earlier prepare committed, are never listed; the field is absent
  when a prepare appends no new input. `MemoryContextLogStore` includes it in
  the idempotency digest when present; other stores need not persist it.
  Requests without new input are unchanged. (LLE-14003)
- `ContextLogOptions.coreVersion` (experimental) and the exported
  `CORE_VERSION_CONTRACT_KEY` (`"coreVersion"`). When set, every version the
  log-mode runtime creates records the host's core version in its contract,
  and a call whose head version recorded another value (or none) declares a
  `core_policy_change` that inherits the whole path with the current core:
  `contextLog.resolveCore` is called with `reason: "core_policy_change"`, or
  the static `systemPrompt` is used. Without the option nothing is recorded
  and nothing changes. (LLE-13914)
- `contextStream.branchFrom` (a `ContextPathRef` on the call's
  thread and stream id, on another branch) declares that a new branch
  continues another branch's path, for a fork, an edited message or a
  regenerated reply. On a stream without a head, the call's prepare commits
  a `branch` transition whose version inherits exactly that path, keeps the
  source version's core (or the core `contextLog.resolveCore` returns for
  `reason: "branch"`, or the static `systemPrompt` when the source recorded
  another `coreVersion`) and records the call's contract and `coreVersion`,
  so it also resolves an adapter version that differs from the source's. A
  source under another adapter `id` fails with `transition_required`. Later
  calls may keep declaring it: the head must still descend from that
  transition, or the call fails with a `branch_source_mismatch` conflict
  before anything is committed (LLE-14001).

### Changed

- Log mode declares an `adapter_change` when the head's version was
  projected under another `version` of the same projection adapter, instead
  of failing with `transition_required`: the new version inherits the whole
  path, keeps the frozen core (the resolver is not called) and records the
  current contract. A different adapter `id` still fails with
  `transition_required`. An adapter version change alone is no longer
  treated as a `model_change`. When several causes hold on one call, one
  transition is declared, in the precedence `core_policy_change`,
  `model_change`, `adapter_change`, and it records the current contract;
  a compaction planned by the same call still replaces it. (LLE-13914)

## [1.0.0-rc.6] - 2026-10-02

Sixth release candidate for 1.0.0. It adds two log-mode changes that hosts
need to map their product events onto the log: a run's new input can be
several user messages, including image and file parts, each committed as
its own `user` entry; and a model step with parallel tool calls commits one
`tool_result` entry per result. Provider input for existing logs is
unchanged. Legacy agents are unchanged.

### Migration notes

- **Legacy mode.** No code change and no behaviour change from rc.5.
  `GenerateOptions.input` is rejected outside log mode, so legacy callers
  keep using `prompt` or `messages`.
- **Log mode, several user messages and attachments.** Hosts that joined
  queued messages into one `prompt`, or relocated attachments, can pass them
  as `input`: an array of `UserModelMessage`s, each committed as its own
  `user` entry, in order. Messages must be plain JSON: text, image and file
  parts only, with image and file data as a string (base64, a data URL or a
  URL) and a `mediaType` on file parts. `input` is rejected together with
  `prompt`. A retry resends the committed input and never appends it again.
  A new user message's `providerOptions` (message and part level) are
  screened by the `PreGenerate` hooks like caller data, so a secrets filter
  or guardrail sees them. Context versions created by rc.6 record
  `userMedia: "placeholder"` in their contract; on those, user image and
  file parts the version's capability contract excludes project as the
  legacy text placeholders. Versions created earlier lack the key and
  project user parts as stored, and the key is not compared, so its absence
  never forces a transition. A store that persists only known contract
  keys must keep `userMedia`, or a reloaded version projects user media as
  stored.
- **Log mode, parallel tool results.** A step whose tool message holds more
  than one result now commits one entry per result, in call order, keyed
  `<step key>:<part index>` (the step's entry key in rc.5 was
  `<step key>`). A step with a single result, or a tool message with
  message-level provider options, keeps one entry and its rc.5 key. Hosts
  whose `ContextLogStore` mapped one `tool_result` entry to several product
  events can now map each entry to one event; hosts that matched on entry
  keys must accept the `:<part index>` suffix. Logs written by rc.5 stay
  readable and need no rewrite: a multi-result entry and its split form
  give the provider the same input, because the AI SDK merges adjacent
  tool messages.

### Added

- **Log mode:** `GenerateOptions.input` takes a run's new input as an array
  of user messages (several queued messages, or text with image and file
  parts). Each message passes the `PreGenerate` input-security hooks and is
  committed as its own `user` entry, in order, under the call's one head
  snapshot; a retry never appends any of it again. It is rejected together
  with `prompt` and outside log mode. A new user message's `providerOptions`
  (message and part level) are screened like caller data. New versions
  record `userMedia: "placeholder"` in their contract, and on those the
  default projection adapter replaces user image and file parts the
  version's capability contract excludes with the legacy text placeholders.
  Existing versions, without the key, keep projecting user parts as stored
  (LLE-13995).

### Changed

- **Log mode:** a model step with parallel tool calls commits one
  `tool_result` entry per result, in call order, instead of one entry holding
  every result, so a host that records one result per entry (a product event
  per tool call) can commit it. Keys of a split step are
  `<step key>:<part index>`; a step with a single result, or a tool message
  with message-level provider options, keeps one entry and its key.
  Provider input is unchanged, because the AI SDK merges adjacent tool
  messages (LLE-13965).

## [1.0.0-rc.5] - 2026-10-02

Fifth release candidate for 1.0.0. It adds two log-mode seams that hosts
need to adopt context log mode: request middleware that run inside the
commit boundary, so the log commits the request as the provider receives
it, and a core that is resolved again for the target model on a
`model_change`. Legacy agents are unchanged.

### Migration notes

- **Legacy mode.** No code change and no behaviour change from rc.4.
  `contextLog.requestMiddleware` is ignored unless `mode` is `"log"`.
- **Request middleware (log mode).** Hosts that wrapped the provider model
  in request-changing middleware (reasoning-option translation, tool-input
  sanitisation, JSON ordering, media relocation) before passing it to
  `createAgent` should now pass the innermost provider model as `model` and
  `fallbackModel` and move those middleware to
  `contextLog.requestMiddleware`. The order is agent → projection → request
  middleware → commit boundary → provider. Request middleware must be
  deterministic, must not remove or overwrite a setting they read to shape
  the prompt, must call the wrapped model, and must be pinned with the
  projection adapter's `id` and `version` (see
  [docs/context-log.md](./docs/context-log.md#the-commit-boundary)).
  Middleware that do not change the request (usage, telemetry, retries) can
  stay outside, around the agent. Transport headers are not part of the
  committed digest.
- **Core resolution (log mode).** `contextLog.resolveCore` is now called for
  `model_change` versions as well as `initial` ones, and its input has
  `target` (`{ provider, modelId }`) and `model`. A resolver that keyed only
  on `reason === "initial"` must handle `"model_change"`: return the core
  for the target model, or the parent's bytes to keep it. The
  `model_change` version records the returned core; no separate
  `core_policy_change` is created. Code that constructs a `ContextCoreInput`
  must supply the two new fields. Agents with a static `systemPrompt` are
  unaffected.

### Added

- Experimental `ContextLogOptions.requestMiddleware`: host
  `LanguageModelMiddleware` run, in order, between the log-mode projection
  and the commit boundary (agent → projection → request middleware →
  boundary → provider), so the manifest's `inputDigest`, `toolSnapshot` and
  `callOptions` describe the request as the provider receives it. They apply
  to every provider call of a log-mode agent, including tool-loop steps,
  retries and fallback attempts, and SDK-built subagents inherit them with
  the projection adapter. Each middleware gets its own copy of the request
  data, so an in-place rewrite is applied once per attempt. They must be
  deterministic, must not remove or overwrite a setting they read to shape
  the prompt, and must be pinned with the adapter's `id` and `version` (see
  docs/context-log.md). Transport headers stay outside the digest. A
  middleware that returns a response without calling the wrapped model fails
  the run with a `ContextLogInvalidError` (reason `boundary_bypassed`)
  before any tool runs. Ignored outside log mode.
- `ContextCoreInput.target` and `ContextCoreInput.model`: the target
  `{ provider, modelId }` and terminal model of the version being created.

### Changed

- **BREAKING** (experimental): in log mode, `contextLog.resolveCore` is now
  also called when a call creates a `model_change` version (a fallback, a
  host switching models, or a model with different input capabilities). The
  `model_change` version records the core the resolver returns for the target
  model, so a host can switch to a per-family core; returning the parent's
  bytes keeps the core. Previously a `model_change` version always kept the
  parent's core. Agents with a static `systemPrompt` are unaffected. A
  resolver that does not return a string now fails the call with a
  `ContextLogInvalidError` (reason `invalid_core`) before anything is sent.

## [1.0.0-rc.4] - 2026-10-02

Fourth release candidate for 1.0.0. It ships experimental context log mode,
in which an append-only log is the source of truth for an agent's history and
every model request is a projection of it, together with a fix that stops
`AgentSession` resending history the checkpointer already holds and a new
`search_tools` ranking. Log mode is opt-in: agents without
`contextLog: { mode: "log" }` keep their legacy behaviour.

### Migration notes

- **Legacy mode.** No code change is needed. Two behaviours differ from
  rc.3: an `AgentSession` with a checkpointer and a `threadId` no longer
  sends earlier turns twice (see Fixed), and `search_tools` returns the tools
  a query names first (see Changed). Hosts that assert either exact message
  history or exact search order may need to update those expectations.
- **Log mode is experimental.** Its exports are marked `@experimental` and
  may change before 1.0.0. Enable it per agent with
  `contextLog: { mode: "log", store, ... }`; read
  [docs/context-log.md](./docs/context-log.md) first. An agent in log mode
  rejects caller-supplied `messages`, `promptBuilder`, non-empty
  `AgentSession` `initialMessages` and a session without a `threadId`, and
  never reads or writes `Checkpoint.messages`. The SDK does not import a
  legacy thread's checkpoint history into the log.
- **Host obligations in log mode.** The SDK does not enforce these:
  - One writer per stream across the whole generation, tool and output
    lifecycle, with distributed fencing (for example a run lease checked by
    `contextLog.admit` and the store). The boundary treats any call it
    supersedes as crashed, and resume is not fenced either.
  - Pass the innermost provider model (after any media or transport
    middleware) as `model` and `fallbackModel`, or move those transforms
    into the `ProjectionAdapter`. Model id strings and models that already
    have a boundary are rejected.
  - A store other than `MemoryContextLogStore` must pass
    `defineContextLogStoreConformanceSuite()` from
    `@lleverage-ai/agent-sdk/testing`, including the `closeSuperseded`
    cases added in this release.
  - Subagent factories under a log-mode parent must return a log-mode agent
    on the store and stream in `SubagentCreateContext.contextLog`, without
    the parent's checkpointer.
  - Log-mode compaction needs `ContextManagerOptions.summarizer`, and custom
    interrupt answers must be JSON-serialisable.

### Added

- Experimental context log contracts for the upcoming log mode, in which
  persisted entries are the source of truth for an agent's history and every
  model request is a projection of them. See
  [docs/context-log.md](./docs/context-log.md). All are marked `@experimental`:
  - Entry, version, transition, head, path and manifest types
    (`ContextEntryInput`, `ContextVersion`, `ContextTransition`, `ContextHead`,
    `ContextPathRef`, `ContextManifest` and related types). Every entry has a
    generic `metadata` bag.
  - `ContextLogStore` with `readHead`, `readPath`, `readVersion`,
    `readManifest`, `prepare`, `markDispatched`, `appendOutputs` and
    `recordOutcome`.
  - `ContextProducer`, `ProjectionAdapter` and `ContextAdmitHook`. A
    projection's input (`ProjectionInput`) is content only: the version's
    core and contract, the entries' content and the target model, so a call
    can be projected before it is committed and reproduced byte for byte
    afterwards.
  - `ContextLogError` and its `ContextLogConflictError`,
    `ContextLogNotFoundError`, `ContextLogRefusedError`,
    `ContextLogUnavailableError` and `ContextLogInvalidError` subclasses, plus
    `isContextLogError()`.
  - `activeContextEntries()`, which applies supersession and retraction to a
    path (committed entries or entry inputs) for projection. `RuntimeContextEntryInput.retraction` marks an entry
    that retires its target and is never emitted.
  - `MemoryContextLogStore`, the in-memory reference store.
  - `defineContextLogStoreConformanceSuite()` and
    `createContextLogStoreConformanceCases()` in
    `@lleverage-ai/agent-sdk/testing`, a framework-agnostic suite any store
    implementation can run. A `completeManifest` hook supplies call fields
    that a store requires.
- `AgentOptions.contextLog` (experimental). Log mode is off by default and an
  agent without the option is unchanged.
- Log-mode request projection (experimental). With `contextLog.mode: "log"`
  each request is a projection of the stream's head path through the
  projection adapter, under the frozen core stored on the head's version. See
  [docs/context-log.md](./docs/context-log.md):
  - `createMessageProjectionAdapter()`, the default adapter. Capability
    projection of tool-result media happens inside it, keyed by the version's
    contract (`ContextProjectionContractKey`).
  - `ContextLogOptions.resolveCore` (`ContextCoreResolver`) supplies the core
    of a new version; a static `systemPrompt` is the alternative. An existing
    version always projects its stored core.
  - Caller-supplied history (`messages`) is rejected; the prompt reaches
    `PreGenerate` hooks as a user message in `options.messages`, so the
    secrets filter and guardrails see it before it is sent.
  - `promptBuilder` is rejected in log mode (the core is frozen per
    version).
  - Checkpoints hold control state and a `ContextLogCursor` under
    `metadata.contextLog`, never messages.
  - Every provider step of a tool loop is projected through the adapter, and
    retry hooks cannot change a log-mode call's input.
- Append-only context producers and hook rules for log mode (experimental):
  - `createSlotContextProducer()` builds a `ContextProducer` that keeps one
    value per slot: unchanged values are deduplicated, a changed value
    supersedes the slot's latest entry, removed configuration is retracted,
    and a failed `optional` loader appends a `context_unavailable` marker
    (`CONTEXT_UNAVAILABLE`, `ContextUnavailablePayload`) that is retracted
    when the loader recovers. With a host `fingerprintSecret`, deduplication
    compares a keyed HMAC of the source value, so redacting input filters do
    not defeat it; without one, no source fingerprint is persisted.
  - `AgentPlugin.contextProducers` and `PluginOptions.contextProducers` let
    plugins register producers. They run after the agent's own
    `contextLog.producers`, and producer names must be unique.
  - In log mode, `PreGenerate` hooks run one after another and see only new,
    not-yet-committed input, including new tool calls and tool results as
    text, and object keys and numbers inside caller data. They may deny it, transform its text (so the secrets filter and
    guardrails still redact or block it before it is committed, and no hook
    can discard another's redaction) and change operational options.
    Changing history, `prompt`, `instructionLayers`, `memory`,
    `providerOptions` or other non-operational options, or short-circuiting
    with `respondWith`, throws a `ContextLogInvalidError` with reason
    `log_mode_hook_violation`, whether the change is returned or made in
    place. Retry options from `PostGenerateFailure` hooks and retry
    policies are held to the same rule: log-mode retries now snapshot the
    attempt's options before the hooks run and hand them an isolated copy,
    which also covers call-level `providerOptions`. A rejected retry throws
    `ContextLogInvalidError` rather than `ValidationError`. See the hook mapping in
    [docs/context-log.md](./docs/context-log.md#hooks-in-log-mode).
- Log-mode commit boundary (experimental). Every provider call in log mode,
  including each tool-loop step, AI SDK retry and fallback attempt, goes
  through a boundary around the terminal provider model that commits the
  call's input before dispatch and its outputs before anything uses them:
  - `prepare` (new input, any declared transition and the manifest, by
    compare-and-swap with an idempotency key), `contextLog.admit` at prepare
    and at dispatch, `markDispatched`, then the provider call. The manifest's
    `inputDigest`, `toolSnapshot` and `callOptions` describe exactly the
    provider call options.
  - Each step's assistant output and tool results pass the `PreGenerate`
    hooks (redaction, guardrails) and are committed with `appendOutputs`
    before the next step is projected from them; the last step is committed
    before the run returns. A failed output commit fails the run.
  - Producers (`contextLog.producers`, plugin `contextProducers`) are wired
    in: each attempt runs them on its head snapshot, the new user input and
    their output pass `invokeLogModePreGenerateHooks`, and the first prepare
    commits both against that snapshot's revision. In log mode the
    `PreGenerate` hooks now run per attempt over new entries, not once per
    run over `options.messages`.
  - Retries and fallbacks are separate attempts that commit the run's input
    once. A call to another model than the stream's previous call (for
    example a fallback, with or without different capabilities) is a declared
    `model_change` transition.
  - A call left open by a crash, or whose outcome could not be recorded, is
    closed by the next prepare on its stream in the same atomic write
    (`cancelled` before dispatch, otherwise `unknown`, or `completed` if its
    outputs were committed). `ContextPrepareRequest.closeSuperseded` is the
    additive store-contract field for this, with conformance cases.
  - Once a provider answered and its outputs were lost, or a reply was
    committed, the run is never retried and never falls back.
  - Hosts must enforce one writer per stream across the generation, tool and
    output lifecycle; the boundary treats any superseded call as crashed.
  - `ContextManifestInput.toolSnapshotChange` (`ContextToolSnapshotChange`)
    attributes a tool-definition change to a model change or a definition
    change.
  - `GenerateOptions.contextStream` selects the branch and stream a log-mode
    call runs on (both default to `"main"`).
  - `streamDataResponse()` background follow-ups run in log mode, each
    passing `PreGenerate` and committing through its own boundary.
  - Model id strings, and models that already have a boundary, are rejected
    in log mode: pass the innermost provider model.
- Log-mode subagent streams (experimental). When a log-mode agent delegates
  with the `task` tool, the subagent runs on its own stream in the parent's
  store, and the parent receives its reply as an ordinary tool result:
  - `SubagentCreateContext.contextLog` (`SubagentContextLog`) gives the
    factory the store, the child stream and the parent's stream. The factory
    must return an agent in log mode on that store, without the parent's
    checkpointer; the task tool runs it on the child stream.
  - The child stream defaults to
    `<parent stream>/subagent/<percent-encoded type>-<digest of the toolCallId>`
    on the parent's branch (`deriveSubagentContextStream()`); hosts can
    choose it with `contextLog.subagentStream`.
  - The delegation's result is the child's committed final reply, read from
    its stream after the run settles, so a first run and a later read-back
    agree. A run that ends without a committed final reply (stopped on a tool
    call, interrupted, or a failed final output commit) fails with
    `DelegationRecoveryRequiredError`.
  - Each delegation claims its child stream: its calls only plan on the head
    it last left, so a concurrent second delivery of the same tool call never
    appends the task again; it reads the reply back or fails with the typed
    error.
  - Recreating a delegation whose stream holds a committed final reply
    returns that reply without running anything. A stream with any other
    head fails with `DelegationRecoveryRequiredError` (a
    `ContextLogRefusedError`, reason `delegation_recovery_required`); the task
    is never replayed. `readSubagentDelegation()` reads a child stream's
    state.
  - The built-in general-purpose and plugin subagents run in log mode under a
    log-mode parent, with the parent's `admit` hook and projection adapter.
  - `createSubagent()` now passes `contextLog` through to the subagent.
- `AgentSession` supports log mode (experimental). Each turn passes only the
  new prompt, since the thread's log holds the history, and `getMessages()` is
  a display copy. A log-mode session needs a `threadId` and does not accept
  non-empty `initialMessages` (both are a `ConfigurationError`). Sessions
  without log mode are unchanged.
- Log-mode compaction (experimental). `contextManager` is accepted in log
  mode, and compaction is a declared `compaction` transition the call's
  prepare commits before the compacted context is first sent. A failed
  commit fails the run without a retry or fallback; nothing is sent from an
  uncommitted compaction, and a run's input is never appended twice, even
  after a compaction summarised it:
  - The child version inherits the leading run of runtime context, then
    holds the summary, then the retained tail re-appended unchanged in path
    order (reasoning, tool calls with their approval requests, resolutions
    and results kept together), then the call's new
    input. A compaction that would keep every conversation entry declares no
    transition. Runtime context is never summarised. Later calls append to the
    child and reuse its summary until the context policy asks for another
    compaction.
  - Compaction runs at the start of an attempt and between tool-loop steps,
    with the same context policy and `PreCompact` / `PostCompact` hooks. The
    summary passes the `PreGenerate` hooks before it is committed.
  - Summaries must come from `ContextManagerOptions.summarizer`, which
    receives `SummaryRequest.contextLog` (`CompactionContextLog`) with the
    run id, a source digest and the `<runId>/summary/<sourceDigest>` stream
    to run on. `ContextManager.compact()` takes an optional fourth
    `CompactOptions` argument carrying it. `commitCompaction` is not called
    for log-mode compactions, and the legacy error-fallback compaction does
    not run in log mode.
- `resume()` and `resumeDataResponse()` support log mode (experimental).
  Legacy resume is unchanged.
  - An interrupt leaves the model's tool call on the log without the
    `[Interrupt requested]` placeholder result. The assistant entry records it
    as an AI SDK `tool-approval-request` part, and the pending interrupt stays
    in the checkpoint as control state.
  - Resuming commits a resolution (a `tool-approval-response` part) and the
    call's result as outputs of the interrupted call, screened by the
    `PreGenerate` hooks, then continues with an ordinary log-mode generation.
    The provider receives the same input as a run that was never interrupted.
  - Approved and answered calls run again through the normal tool pipeline
    (permission mode, `PreToolUse` / `PostToolUse` hooks, signal catching),
    with the tool call's committed input, after the thread's todos and files
    are restored from the checkpoint.
  - The resolution records the decision: the approval and its reason, or a
    custom interrupt's answer as canonical JSON of `{ "answer": <value> }` in
    `reason` (log-mode custom answers must be JSON-serialisable). The
    committed, screened resolution is what the tool runs with, on the first
    run and on recovery; an answer that no longer decodes after screening
    fails closed with `ContextLogInvalidError` (reason `invalid_resolution`).
    Custom projection adapters must not re-render approval parts.
  - The resolution is committed before the tool runs. A resume that finds a
    resolution without a result fails with a `ContextLogConflictError`
    (reason `resume_in_doubt`) instead of running the tool again, unless
    `contextLog.inDoubtResume` is `"reexecute"`, which a host sets when its
    tool ledger makes repeating a tool call id safe. The re-run repeats the
    recorded decision. Resume is covered by the host's single-writer
    requirement: the SDK does not fence concurrent resumes.
  - A generation on a stream with an unresolved interrupt fails with a
    `ContextLogConflictError` (reason `interrupt_pending`) before anything is
    committed.
  - Log-mode screening treats `approvalId` as structure, like `toolCallId`.
  - A log-mode `AgentSession` leaves background task events queued while an
    interrupt is pending, and reads the pending interrupt back from the
    checkpoint after every resume, so a failed continuation does not strand
    them.

### Changed

- `MCPManager.searchTools()`, and so `search_tools`, now ranks the tools a
  query names first. A tool whose own name appears in the query, in snake
  case (`list_skills`) or as words (`list skills`), gets a fixed boost, so a
  query naming several tools returns all of them first. Plural terms now match
  their singular (`emails` finds `find_email`), and a term repeated in the
  query counts once.

### Fixed

- `AgentSession` no longer resends earlier turns when the agent has a
  checkpointer and the session has a `threadId`. The agent already prepends the
  thread's checkpoint messages, so from the second turn on the model received
  every earlier turn twice (`U1, A1, U1, A1, U2`). In that setup the session
  now passes its own history as a fallback. Before PreGenerate hooks run, the
  agent drops the fallback if its checkpoint load for the thread finds a
  checkpoint, and otherwise passes it to hooks and the model as `messages` as
  before. `initialMessages` therefore reach the model only while there is no
  checkpoint, still through input hooks such as the secrets filter and
  guardrails, and `getMessages()` remains a display copy of the session's
  turns. Sessions without a checkpointer or `threadId` are unchanged.

## [1.0.0-rc.3] - 2026-09-30

Third release candidate for 1.0.0. `call_tool` now returns proxied object and
array results as compact JSON, and the task tool passes the originating tool
call ID to subagent factories.

### Added

- `SubagentCreateContext.toolCallId`: the ID of the `task` tool call that
  started the delegation, passed to `SubagentDefinition.create()`. A host can
  use it to key durable state for the delegated run to the call that owns it.
  It is `undefined` when the task tool is executed without a tool call ID.

### Changed

- `call_tool` now returns object and array results from proxied tools as
  compact JSON (`JSON.stringify(result)`) instead of JSON indented by two
  spaces. The data is the same, but the model sees fewer bytes, and a tool
  result stays in the conversation for every later model call. String results
  are still passed through unchanged. Primitives and `null` keep their JSON
  form, and a result that cannot be serialised still falls back to
  `String(result)`. The error text and interrupt propagation have not changed.
  Hosts that assert the exact text of a proxied result need to update those
  expectations.

## [1.0.0-rc.2] - 2026-09-23

Second release candidate for 1.0.0. It removes `checkpointAfterToolCall`, so
every generation mode saves the checkpoint once, and adds
`invalidateCheckpoint()` so a host can make an agent reload a thread from its
checkpoint store.

### Added

- `agent.invalidateCheckpoint(threadId)`: makes the next generation for a
  thread reload its checkpoint from the checkpointer. Until now an agent
  loaded each thread once and never read the store again, so a host whose
  store changed behind the agent had to build a new agent to see it. The
  reload behaves like a first load: it calls `checkpointer.load()`, restores
  `todos` and `files`, and fires `PostCheckpointLoad` again. The reloaded
  checkpoint, including its `pendingInterrupt`, replaces the cached one; until
  the reload, the cached checkpoint stays the base for saves, so a generation
  already in flight is unaffected. No-op without a checkpointer. Without a
  call, caching is unchanged.

### Removed

- **BREAKING**: `GenerateOptions.checkpointAfterToolCall`. Only `streamRaw()`
  and `streamDataResponse()` honoured it, by saving after every step;
  `generate()` and `stream()` ignored it despite the docs. Every mode now saves
  the checkpoint once, when the call returns normally, so `streamRaw()` and
  `streamDataResponse()` no longer call `checkpointer.save()` per step. Remove
  the option from your calls. `shouldStopAfterStep` still drains at a step
  boundary: the stopped call returns normally and its save includes the last
  completed step. If you need each step to be durable, record steps in your own
  storage, build the checkpoint from them in `load()`, and call
  `invalidateCheckpoint()` before the call that should see them.

## [1.0.0-rc.1] - 2026-09-22

Release candidate for 1.0.0. These entries track behaviour upstreamed from
Lleverage's `pnpm patch` against `0.1.0-alpha.9`, the narrow host seams that
replaced the patch's integration workarounds, and the API removals audited
against the consumer. The pre-release entries below will be consolidated into
the final 1.0.0 entry.

### Added

- `ILedgerStore<TBeginRunOptions>` and `RunManager<TBeginRunOptions>` (threads
  ledger): an optional type parameter, defaulting to `BeginRunOptions`, for
  stores whose `beginRun()` records extra per-run fields. `new RunManager(store,
  eventStore)` infers it from the store, so `manager.beginRun()` accepts those
  fields without a cast and forwards the options object unchanged. No runtime
  change: the SDK still neither reads nor validates fields beyond
  `BeginRunOptions`, and the activate / recover-on-activation-failure sequence
  is unchanged. Existing non-generic usage compiles as before.
- `chainPostToolUseHooks(callbacks)`: composes `PostToolUse` callbacks so each
  sees the previous one's `updatedResult` as its `tool_response` and the
  final value is returned as one `updatedResult`. Side-by-side `PostToolUse`
  hooks still all receive the original response with only the first
  `updatedResult` applied; that is unchanged. No-op callbacks leave the
  running value alone, an all-no-op chain returns `undefined` so the tool's
  own output is kept, non-`PostToolUse` inputs are ignored, and callback
  errors propagate to the pipeline's existing containment.
- `GenerateOptions.streamingContext`: a caller-supplied, request-local
  `StreamingContext` for `generate()`, `stream()`, `streamResponse()` and
  `streamRaw()`. Function-based plugin tools receive it as `ctx`, `call_tool`
  and MCP tools stream through it, every tool can read it as
  `ExtendedToolExecutionOptions.streamingContext`, and subagents registered
  with `streaming: true` inherit it; other subagents never see the parent's
  writer. Tools are built per request, so concurrent generations on one agent
  keep separate writers. Background-task follow-ups reuse the request's
  context. `streamDataResponse()` still creates its own writer and rejects a
  caller-supplied context with a `ConfigurationError`.
- `StreamingWriter` (`Pick<UIMessageStreamWriter, "write">`), so a host sink
  that only implements `write()` can be a context writer. The SDK only ever
  calls `write()` on a context writer.
- `ContextManagerOptions.summarizer`: a `SummaryExecutor` that generates
  compaction summaries in place of the agent passed to `compact()`. It
  receives the exact summary messages, output limit, trigger, strategy and
  tier the built-in path uses and returns text plus optional usage, so hosts
  can run summaries on an isolated tool-free agent with a deadline and abort
  signal without wrapping `agent.generate`. A rejection fails the compaction.
- `ContextManagerOptions.commitCompaction`: awaited after `onCompact` and
  before `compact()` resolves, so awaiting compaction also awaits a durable
  write. Rejections are contained and do not open the failure circuit.
- `CompactionResult.summaryUsage` (executor-reported) and
  `CompactionResult.summaryDurationMs`. Exported `SummaryExecutor`,
  `SummaryRequest`, `SummaryResponse`, `SummaryUsage`.
- `PostCheckpointLoad` hook. Fires each time the checkpointer's `load()`
  returns a checkpoint (cached re-reads within an agent instance do not
  re-fire) and before that generation's compaction check, with `PostCheckpointLoadInput` (`thread_id`, `step`,
  `messages`, `metadata`, `has_pending_interrupt`). It is the only hook that
  sees the restored transcript, so hosts can seed a context manager from
  persisted usage or rebuild cross-turn plugin state without wrapping the
  checkpointer. Observation only; hook failures are contained. Registrable via
  `hooks`, plugins, middleware (`onPostCheckpointLoad`) and subagent
  `inheritHooks`. The `HookEvent` name existed before but was never fired.
- Near-miss tool suggestions. An unknown tool name now names the closest
  discoverable tools instead of only pointing at `search_tools`: `call_tool`
  returns `Closest available tools: ...` and a direct call of an unknown name
  is repaired to a `NoSuchToolError` carrying the suggestions in
  `availableTools` (when `transformToolError` is configured). Exported
  `suggestNearMissTools()` and `NEAR_MISS_SUGGESTION_LIMIT` (3). The requested
  name is never suggested and nothing is auto-executed. With no suggestions,
  `call_tool` keeps the plain `search_tools` hint and the direct-call path
  passes the original `NoSuchToolError` through unchanged.
- Added `UsageUpdateContext`, `UsageAnchor` and optional
  `ContextManager.getUsageAnchor()` for provider-input-plus-append-growth context
  accounting. Streaming steps update usage before appending output, validate
  input measurements, tolerate one stale step, check prefix token estimates and
  clear anchors after successful compaction.
- Exported `SUMMARY_TOOL_RESULT_MAX_CHARS` (4,000) for per-result summary payload
  bounds. Compaction now unwraps text/JSON/error outputs and preserves tool names,
  call IDs and omitted-character recovery markers.
- Added opt-in `AgentOptions.ownedTaskPolicy` / `ownedTaskCallbacks`, typed
  ownership contracts and `TaskManager` scope/settlement/consume APIs. Foreground
  and background delegations are registered before initialisation, carry
  cancellation through factories/hooks/generation, retain unresolved ownership
  and admission permits, and fence completed tool-call replay across attempts.
  Omitted lifetime/drain durations create no timers. Host admission, tenant
  policy, worker recovery and run finalisation remain host-owned.
- Added `includeGeneralPurposeSubagent: false` to keep only the host-supplied
  delegation roster, and `SubagentCreateContext.signal` for initialisation.

- Added opt-in `AgentOptions.workflowExecutionGate` and its typed host decision,
  request and receipt contract. Tool execution fails closed before hooks,
  permissions and proxy dispatch when authority is denied, unavailable,
  malformed, timed out or cancelled. Hook-transformed inputs and proxy targets
  are re-authorised. The earlier AI SDK `needsApproval` / `canUseTool` callback
  path is gated separately, with fresh authority at execution and cancellation
  fences after awaited permission callbacks. `createSubagent()` inherits the
  parent's gate unless explicitly overridden, including the built-in task child.
  Diagnostic callbacks are not awaited; synchronous and async failures are
  contained. Agents without the option retain their existing behaviour.
  Gated agents explicitly reject `resume()` / `resumeDataResponse()` because
  those legacy methods invoke raw tools outside the gated pipeline; use
  host-resolved tool-result continuation instead.

- Added `AgentOptions.transformToolError`, a boundary hook applied to tool
  failures before the AI SDK records them. It runs for `execute()` rejections
  and for tool calls that fail before execution (unknown tool name, invalid
  input), so consumers can sanitise what the model sees and what checkpoints
  persist without losing the original in-process error. Exported the
  `ToolErrorTransform` type.
- **BREAKING**: Added `tool-error` and `tool-output-denied` variants to
  `StreamPart`. `agent.stream()` previously dropped these AI SDK parts, leaving
  the matching `tool-call` permanently unresolved for consumers, who then had to
  synthesise misleading terminal errors at end of stream. Consumers that switch
  exhaustively on `StreamPart["type"]` need cases for the new variants.
- Added automatic repair of direct calls to discoverable proxy tools. When a
  model emits a deferred tool's qualified name instead of calling `call_tool`,
  the SDK now re-routes the call through `call_tool` (via the AI SDK
  `repairToolCall` hook), preserving the tool call id and sending it through
  the normal validation/approval pipeline. Only exact, currently discoverable
  names with object-shaped JSON input are repaired. Disable per agent with
  `AgentOptions.repairDiscoveredToolCalls: false` or globally with
  `AGENT_SDK_DISABLE_TOOL_CALL_REPAIR=true` (the option wins).
- Added `ExtendedToolExecutionOptions.stop()`. A tool can call it to end the
  turn cleanly after its step completes (no further model call, background
  follow-up loop skipped), for terminal presentation tools such as rendering
  buttons.
- Added `GenerateOptions.shouldStopAfterStep`, a cooperative pause hook
  evaluated as a stop condition after every completed step. Combined with
  `checkpointAfterToolCall`, it lets a host drain in-flight runs at a durable
  step boundary (e.g. on `SIGTERM`) and resume them later on the same
  `threadId`.
- Added mid-run context compaction for streaming generations. `stream()`,
  `streamResponse()`, `streamDataResponse()` and their background-task
  follow-ups now pass a `prepareStep` hook that re-checks the context budget
  before every model call after the first, so long tool loops compact
  mid-run instead of only at run boundaries. `PreCompact`/`PostCompact` hooks
  and `onCompact` fire for mid-run compactions too.
- Added `SkillDefinition.discoverable` (default `true`). Skills registered
  with `discoverable: false` are hidden from the `skill` tool catalogue but can
  still be loaded by name (explicit-only skills). Added
  `SkillRegistry.hasUnloadedExplicitOnlySkills()` and
  `SkillRegistry.anySkillConsumesArgs()`.
- Added `toSkillRuntimeName()`, which slugs arbitrary skill names into a stable
  tool-safe identifier (with an FNV-1a `skill--<hash>` fallback for names that
  contain no usable characters). `SkillRegistry.get()`/`load()` accept either
  the registered name or its unambiguous slug, so models can use the name they
  see in the catalogue.
- Added `SkillToolOptions.continuationInstruction` (default
  `DEFAULT_SKILL_CONTINUATION_INSTRUCTION`, pass `false` to disable). The
  `skill` tool appends it to successful load results so the model continues the
  task instead of stopping after loading a skill.

### Changed

- **BREAKING** (types only): `StreamingContext.writer` is `StreamingWriter | null`
  instead of `UIMessageStreamWriter | null`. Code that forwards `ctx.writer`
  into a `UIMessageStreamWriter`-typed slot should widen that slot to
  `StreamingWriter`; a plugin that calls `merge()` or `onError` on
  `ctx.writer` must narrow first. `streamDataResponse()` still supplies a
  full `UIMessageStreamWriter` at runtime.
- The `skill` tool only advertises an `args` input when at least one
  registered skill has function-based instructions that consume arguments, and
  its description explains that explicit-only skills are still loadable when
  the discoverable catalogue is empty.
- The `skill` tool's `description` and `inputSchema` are captured once at
  `createSkillTool()` by default (`catalogue: "snapshot"`), so the definition
  the model sees is byte-identical across the steps of a run and a mid-run
  skill load does not invalidate provider prompt caches keyed on the tool
  block. `execute` still consults the live registry. Pass
  `catalogue: "live"` for the per-request evaluation (AI SDK 7 function
  description and `() => Schema`) that reflects skills registered or loaded
  after creation without recreating the tool; with `"live"`, code that reads
  `tool.description` as a string must handle the function form (the SDK's own
  prompt builder and `VirtualMCPServer` do). Not a change from the last
  published release: 0.1.0-alpha.9 captured both at creation; the
  per-request evaluation only ever existed unreleased on `main`.
- `ContextManager.getBudget()` now uses `max(actual usage, estimate)` instead
  of trusting the last reported usage outright. Actual usage describes the
  *previous* model input; the current message list may already contain newer
  tool results, so stale usage could hide growth between generations. Usage
  is also cleared after a successful compaction so the next budget check
  estimates the compacted transcript rather than comparing against the
  pre-compaction total.
- Dependencies refreshed to current releases: `ai` ^7.0.101,
  `@ai-sdk/anthropic` ^4.0.53, `@ai-sdk/gateway` ^4.0.81, `zod` ^4.6.5,
  `@modelcontextprotocol/sdk` ^1.30.0, `ajv` ^8.20.0, `yaml` ^2.9.1; dev
  tooling to Vitest 4.1.11, Biome 2.5.13, `@types/node` 22 (matching
  `engines.node >=22`). The `ai` peer range stays `^7.0.0`; the tool-call
  repair hook is passed as both `repairToolCall` (stable since 7.0.20) and
  `experimental_repairToolCall` (the only name older 7.0.x reads).

### Removed

- **BREAKING**: `GenerateOptions.forkSession` and `GenerateResult.forkedSessionId`.
  Passing `forkSession` copied the source thread's checkpoint to a new thread id
  and ran the generation there; `generate()` and `stream()` then persisted to the
  forked thread while the `Response`-shaped modes persisted to the request
  `threadId`. Every mode now persists to and reports the request `threadId`, and
  the internal `CheckpointRuntime.fork()` and `"fork-aware" | "request"`
  checkpoint-thread strategy are gone. To branch a conversation, load the source
  checkpoint with your checkpointer, save it under the new thread id, and call
  `generate({ threadId: newId })`; in-thread branching of ledger transcripts
  (`beginRun({ forkFromMessageId })`) is unaffected.
- **BREAKING**: `agent.streamResponse()`. It was `streamDataResponse()` without
  the tool `StreamingContext`: the same `createUIMessageStream` + `streamText()`
  shape, `createStreamLifecycleCallbacks`, `runUIStreamFollowUps` follow-ups and
  `respondWith` plain-text short-circuit, but it did not persist a pending
  interrupt or fire `InterruptRequested`. Call `streamDataResponse()` instead;
  the returned `Response` is the same UI message stream. If you need to hand
  tools your own writer, use `stream()`, `streamRaw()` or `generate()` with
  `GenerateOptions.streamingContext`. `createMockAgent()` and
  `createRecordingAgent()` drop their `streamResponse()` pass-throughs; the mock
  now serves the plain-text `Response` from `streamDataResponse()`.
- **BREAKING**: `KeyValueStoreSaver`, `createKeyValueStoreSaver()` and
  `KeyValueStoreSaverOptions`. It was a JSON blob wrapper over a
  `KeyValueStore`; implement `BaseCheckpointSaver` (`save`/`load`/`delete`,
  optional `list`) over your store directly — `docs/persistence.md` shows the
  shape. `KeyValueStore`, `InMemoryStore`, `PersistentBackend` and `KVTaskStore`
  are unchanged.
- **BREAKING**: Seven `@internal`-tagged helpers are no longer re-exported from
  the package root: `invokeHooksWithTimeout`, `matchesToolName`,
  `createMiddlewareContext`, `MiddlewareContextResult`, `isSchemaEmpty`,
  `parseSimpleYaml` and `LOG_LEVEL_VALUES`. `defaultLogger` from
  `@lleverage-ai/agent-sdk/threads` and `/threads/stream` (the internal
  console fallback for stores and `WsServer`) is likewise no longer exported;
  the observability `defaultLogger` on the package root is unchanged. Hooks
  are invoked by the agent itself; middleware hooks are composed through
  `applyMiddleware()` / `mergeHooks()`, and log levels are configured through
  `createLogger({ level })`. None of these were used by the lleverage consumer.

### Fixed

- `createApproximateTokenCounter()` and `createCustomTokenCounter()` now
  discriminate content parts on `part.type` instead of field presence, matching
  Lleverage's platform counter exactly. Previously dropped from the count:
  multi-modal tool-result `content`, `image` parts without an `image` field
  (`{ data, mediaType }`), `file` parts without `data` (URL files),
  `tool-approval-request` / `tool-approval-response`, `custom`, `reasoning-file`
  and any unknown part type (now charged its serialised size). A tool call
  carrying both `input` and legacy `args` counts `input` once instead of both.
  `null` and unserialisable payloads count as empty, and a message with
  `content: undefined` no longer throws from the cache hash.
- `agent.stream()` restores the structured cause on invalid-tool-call
  `tool-error` parts. AI SDK 7 emits an invalid `tool-call` (unparsable input,
  unknown tool) carrying the `InvalidToolInputError` / `NoSuchToolError` cause,
  then a `tool-error` whose `error` has been flattened to a string. The stream
  now yields the structured error for that adjacent pair when tool call ID,
  tool name and input identity match; the receipt clears on every chunk and
  error text is never used to infer a cause. Execution rejections and
  non-adjacent errors are unchanged.
- Context occupancy updates use final-step usage rather than multi-request totals
  in `generate()` and Response-mode completion/follow-ups; summariser requests
  cannot overwrite active-context usage. Public result/billing usage is unchanged.
- Summary formatting handles failed JSON serialization, including `undefined`
  serialization results, without crashing on `text.length`.
- Owned task settlement now precedes SDK retries/emergency compaction and cannot
  become successful disposal when cleanup is unresolved. Final checkpoint saves
  and `PostGenerate` hooks are fenced after cancellation, including UI follow-ups.
- Clean up hook timeout timers/listeners after callbacks settle. Owned start/stop
  and child `PostGenerate` hooks observe real promises instead of abandoning work
  behind a timeout race. Cancellation during `PostGenerate` reaches its hook
  context and prevents late result rewrites, including with host-composed signals.
- Initialise owned cancellation before registration events, release permits on
  registration failure, and contain async unresolved-report/release rejections.

- `createApproximateTokenCounter()` now counts tool result outputs. The
  `toolName` branch matched tool-result parts before the `output`/`result`
  branch, so tool results were counted as just their tool name and the output
  was dropped, undercounting tool-heavy transcripts several-fold and preventing
  compaction from ever triggering.
- Token-counter cache keys for tool results and tool calls now include the
  payload. They were keyed on the tool name alone, so a large result from a
  tool reused the cached count of an earlier small result from the same tool.
- `createApproximateTokenCounter()` and `createCustomTokenCounter()` no longer
  throw when a tool result `output`/`result` or tool-call `input`/legacy `args`
  is `undefined` (a tool that returns no value, or a call with no arguments),
  or when a payload holds a `bigint` or a cyclic reference.
  `JSON.stringify` returns `undefined` for the former and throws for the
  latter, and both reached the character counter.
- `createCustomTokenCounter()` counted a tool result as just its tool name and
  dropped the output, the same branch-ordering bug fixed for
  `createApproximateTokenCounter()` above. The summarization prompt had the
  same ordering and rendered tool results as `[Tool call: …]`.
- `generate()` now builds checkpoints from every step's response messages
  rather than the top-level `response.messages`, which the AI SDK populates
  with only the *final* step. Multi-step tool runs no longer lose their
  intermediate tool calls and results from persisted transcripts.
- Streaming checkpoints (`stream()`, `streamResponse()`, `streamDataResponse()`)
  are now built from the tracked, possibly compacted, message base instead of
  being re-derived from the response, which would resurrect history that
  mid-run compaction had discarded.

### Internal

- Extracted the tool execution pipeline from `agent.ts` into
  `src/agent/tool-pipeline.ts`. The permission, task-manager, hook, streaming
  context and signal-catching wrappers moved verbatim; the composition order
  they were previously hand-assembled in at seven call sites is now a single
  `createToolPipeline().buildTools()` with a documented layer diagram and
  ordering tests. No public API or behaviour change.
- Extracted the checkpoint runtime from `agent.ts` into
  `src/agent/checkpoint-runtime.ts`. `loadCheckpoint` / `saveCheckpoint` /
  `forkCheckpoint` and the per-thread cache moved verbatim; the pending
  interrupt stamping that was hand-written at five call sites, the run-id
  continuation preamble duplicated across all five generation modes, and
  the save-then-cache pattern on the resume path are now single runtime
  methods. No public API or behaviour change.
- Extracted message assembly from `agent.ts` into `src/agent/messages.ts`:
  `buildMessages`, `compactMessagesIfNeeded`, `createStreamingCompactionState`
  (behind `createMessageRuntime()`), and the pure `appendResponseMessages` /
  `buildMessagesFromStepResponses` transcript helpers. No public API or
  behaviour change.
- Extracted the generation lifecycle shared by `generate()`, `stream()`,
  `streamResponse()`, `streamRaw()` and `streamDataResponse()` into
  `src/agent/generation-runner.ts` (`createGenerationRunner()`): PreGenerate
  and cache handling, per-attempt message/tool/prompt setup, the AI SDK call
  params, context-usage updates, `InterruptRequested` / `PostGenerate` hook
  emission, the streaming `onStepFinish` / `onFinish` callbacks, the UI-stream
  background follow-up loop, and the retry decision. Each mode keeps only its
  output shape. The model-capability projection helpers and `mapSteps` moved
  with it. Documented the remaining behaviour differences between the modes in
  `docs/architecture/generation-modes.md`; none were changed. Closes #140.

## [0.1.0-alpha.9] - 2026-06-30

### Changed

- **BREAKING**: Upgraded the AI SDK peer dependency from `ai@^6` to `ai@^7`. The
  SDK now targets AI SDK 7 only; `ai@6` is no longer supported. Update the
  matching providers (`@ai-sdk/anthropic@^4`, `@ai-sdk/gateway@^4`) when adopting
  this release. See [docs/migration/ai-sdk-7.md](./docs/migration/ai-sdk-7.md)
  for the full compatibility audit and migration notes.
- **BREAKING**: Raised the minimum Node.js version from 18 to 22, as required by
  AI SDK 7.
- **BREAKING**: `GenerateOptions.experimental_telemetry` is now typed as the
  AI SDK 7 `TelemetryOptions` type instead of the removed `TelemetrySettings`.
  The v6 `metadata` and `tracer` fields are no longer part of the type; provide
  custom attributes via a registered telemetry integration instead. The
  `recordInputs`/`recordOutputs` redaction controls are unchanged and still
  default to `true`.
- Folded the `@lleverage-ai/agent-threads` package into `@lleverage-ai/agent-sdk`.
  Its stream + ledger transport, replay, and durable-transcript primitives are
  now published from `@lleverage-ai/agent-sdk` under `./threads` subpath exports
  (`@lleverage-ai/agent-sdk/threads`, `/threads/stream`, `/threads/ledger`,
  `/threads/server`, `/threads/client`, `/threads/stores/*`). The internal
  cross-package re-export layer is gone — the canonical transcript primitives are
  imported directly from the SDK's own modules.

### Added

- Added `createLedgerCheckpointer`, an event-sourced checkpoint saver that
  reconstructs message history from a transcript ledger (`ILedgerStore`) on
  `load()` and persists only the resume delta (step, agent state, pending
  interrupt) to an inner saver on `save()` — it never re-writes the message blob,
  so the ledger stays the single source of truth. This makes the projection
  pattern (previously hand-rolled as no-op `save()` implementations on
  event-sourced platforms) a first-class SDK primitive. Also added the supporting
  `canonicalMessagesToModelMessages` projection (exported from the root and from
  `@lleverage-ai/agent-sdk/threads/ledger`).
- Added a forward-looking `GenerateOptions.telemetry?: TelemetryOptions` option
  (the AI SDK 7 name). `experimental_telemetry` remains supported as a deprecated
  alias; when both are set, `telemetry` takes precedence.
- Generation now passes `allowSystemInMessages: true` to every model invocation,
  preserving AI SDK 6 behavior where system-role messages may appear inside the
  message history (AI SDK 7 rejects them by default).

### Removed

- **BREAKING**: Removed the standalone `@lleverage-ai/agent-threads` package. Its
  code now ships inside `@lleverage-ai/agent-sdk` under the `./threads` subpaths.
  Migrate imports by replacing the package name, e.g.
  `@lleverage-ai/agent-threads` → `@lleverage-ai/agent-sdk/threads`,
  `@lleverage-ai/agent-threads/stream` → `@lleverage-ai/agent-sdk/threads/stream`,
  `@lleverage-ai/agent-threads/stores/event-memory` →
  `@lleverage-ai/agent-sdk/threads/stores/event-memory`, etc. The exported symbols
  are unchanged.

### Internal

- Replaced the AI SDK 6 call-level `experimental_context` passthrough (removed in
  AI SDK 7) with an internal `wrapToolsWithExecutionContext` wrapper that injects
  the per-call execution context into tool execution options, preserving inline
  tools' model-capability awareness.
- Annotated the core tool factories (`createBashTool`, `createReadTool`,
  `createWriteTool`, `createEditTool`, `createGlobTool`, `createGrepTool`,
  `createSkillTool`, `createTodoWriteTool`) with explicit `Tool` return types so
  the emitted declarations stay portable under AI SDK 7's tool typing.

## [0.1.0-alpha.8] - 2026-06-01

### Added

- Added an optional `experimental_telemetry?: TelemetrySettings` field to `GenerateOptions`, passed straight through to the underlying `generateText`/`streamText` calls at every model-invocation site in the agent loop. When a caller opts in and an OpenTelemetry tracer provider is registered, the AI SDK emits `ai.*` spans with `gen_ai.*` semantic-convention attributes for each model invocation and tool call. Pure passthrough — no behaviour change unless the caller opts in.

## [0.1.0-alpha.7] - 2026-05-14

### Added

- Added canonical transcript compaction summary types, an in-memory `CompactionStore`, `SummaryAwareContextBuilder`, and an `@lleverage-ai/agent-threads` ledger-backed compaction store adapter for persistent branch-aware transcript summary substitution.
- Compaction carriers persisted by `createLedgerCompactionStore` are now treated as branch annotations: `chooseActiveChild` and `buildThreadTree` exclude `metadata.isCompactionCarrier === true` messages from active-child resolution and fork-point detection, and `getTranscript({ branch: "active" })` emits carrier children immediately after their parent in tree-document order so async compaction lands cleanly without stealing the active branch.
- Exported `isCompactionCarrierMessage` helper for identifying compaction carrier messages.

### Changed

- `@lleverage-ai/agent-threads` now depends on `@lleverage-ai/agent-sdk`. The canonical transcript primitives (`CanonicalMessage`, `CanonicalPart`, `CompactionSummaryPart`, `CompactionTrigger`, `BranchSelections`, `CANONICAL_MESSAGE_SCHEMA_VERSION`, etc.) are owned by `@lleverage-ai/agent-sdk` and re-exported from `@lleverage-ai/agent-threads/ledger` for source compatibility. Consumers importing types from `@lleverage-ai/agent-threads/ledger` continue to work unchanged.
- The duplicate `FullContextBuilder` in `@lleverage-ai/agent-threads/ledger` has been removed; the ledger barrel now re-exports `FullContextBuilder` and `SummaryAwareContextBuilder` from `@lleverage-ai/agent-sdk`.
- `CompactionTrigger` is now defined once in `@lleverage-ai/agent-sdk` (canonical 5-value union including `"manual"`); `context-manager.ts` no longer declares its own.
- Context summarization output budget is now configurable via `summarization.summaryMaxTokens` and defaults to 8,000 tokens instead of the previous hardcoded 1,000-token summary call limit.
- `CompactionSummaryPart.coveredMessageIds` is now a non-empty tuple `readonly [string, ...string[]]` to make it impossible to construct an unanchored summary.
- Compaction carriers are persisted with the `summaryId` as their canonical message id, so duplicate writes are caught by the underlying store's id uniqueness rather than relying solely on a load-then-check window.

### Fixed

- `CANONICAL_MESSAGE_SCHEMA_VERSION` was re-exported from `@lleverage-ai/agent-threads/ledger` as a type, so the runtime value was stripped from the compiled barrel and consumers received `undefined`. It is now exported as a value.
- `createLedgerCompactionStore.save` no longer passes `forkFromMessageId` when creating the carrier run, so compaction commits cannot supersede unrelated regenerations at the covered range's end message.
- `FullContextBuilder` and `SummaryAwareContextBuilder` now normalize an omitted `branch` option to the documented `"active"` default before calling the store, ensuring the public contract no longer depends on per-store semantics for `undefined` and keeping the `branch === "all"` safeguard tight.
- `filterMessages` in the context builders now repairs `parentMessageId` references after dropping tool-result/reasoning-only messages or truncating with `maxMessages`, walking up the original ancestry to the nearest still-visible parent so canonical ancestry is preserved in the returned context.
- `@lleverage-ai/agent-threads/ledger` no longer locally redeclares the canonical transcript primitives (`CanonicalMessage`, `CanonicalPart`, `CompactionSummaryPart`, `CompactionTrigger`, `BranchSelections`, `CANONICAL_MESSAGE_SCHEMA_VERSION`, `isCompactionSummaryPart`, `isCompactionCarrierMessage`, etc.) or `FullContextBuilder`/`IContextBuilder`/`ContextBuilderOptions`/`BuiltContext`/`ProvenanceMetadata`. They are now re-exported from `@lleverage-ai/agent-sdk`, aligning the code with the documented ownership and preventing silent drift between the two packages.

## [0.1.0-alpha.6] - 2026-05-08

### Fixed

- `agent.stream()` now normalizes AI SDK v6 tool input chunks that use `id`/`delta` fields, preserving `toolName` across start/delta/end events so real provider streams expose progressive tool arguments (#132)

## [0.1.0-alpha.5] - 2026-05-08

### Added

- `agent.stream()` now forwards streamed tool input lifecycle chunks (`tool-input-start`, normalized `tool-input-delta`, and `tool-input-end`) before the final `tool-call`, allowing clients to render tool arguments as they are generated (#132)
- `PreToolUse` hooks now support `respondWith` in `HookSpecificOutput` to short-circuit tool execution and return a synthetic result without calling the original tool. `PostToolUse` hooks still fire with the synthetic result for observability, and the `PostToolUseInput` carries `tool_result_synthetic: true` so audit/log/metrics hooks can distinguish intercepted calls from real ones
- `agent.stream()` now emits `turn-start` and `turn-end` lifecycle events bracketing each assistant message in the stream. `turn-end` carries the AI SDK response id (as `messageId`), the per-turn `finishReason`, and per-turn `usage`. This lets consumers attach a stable message identifier to deltas and tool calls without inventing one, and lets per-turn telemetry be recorded without awaiting the final result. The events are additive — exhaustive `switch` statements on `StreamPart` will see new variants but no existing variant changes shape
- Backend `read()` methods can now return typed `SandboxReadResult` values for text, image, file, rendered page, and unsupported reads. The default `read` tool projects supported images/files into AI SDK tool-result content and downgrades them to text fallbacks when `AgentOptions.modelCapabilities` declares the active model cannot accept those inputs
- `PromptComponent` now supports `stability` and `budget` metadata, and `PromptBuilder.buildWithDiagnostics()` returns prompt and section fingerprints for lightweight prompt-cache diagnostics

### Fixed

- `@lleverage-ai/agent-threads` accumulation now preserves assistant turn boundaries when `tool-result` events arrive before `step-finished`, queuing tool results until the assistant step is committed so step metadata remains attached to the correct message

## [0.1.0-alpha.3] - 2026-04-23

### Added

- First-class execution telemetry in `@lleverage-ai/agent-sdk`: generation results and hook inputs now carry `telemetry` metadata with `runId`, `threadId`, requested/response model identity, usage, and timing data for reliable per-run correlation
- Built-in tracing hooks via `createTracingHooks()`, including generation, tool, compaction, and subagent spans with execution correlation metadata

### Changed

- `createObservabilityPreset()` now auto-wires metrics and tracing hooks in addition to logging hooks, so enabling observability also instruments agent requests, tools, compaction, retries, and subagent lifecycle events by default
- Built-in logging, audit, metrics, and observability event hooks now record resolved model identity and execution correlation metadata emitted by the SDK runtime instead of relying on app-level labels
- Checkpointed interrupt/resume flows now persist SDK-generated `runId` metadata alongside thread state so resumed executions keep stable correlation IDs across interrupts

### Fixed

- Execution telemetry follow-up runs, cached responses, tracing spans, and rate-limit metrics now preserve accurate model attribution and clean up request-scoped observability state
- Observability metrics now avoid negative in-progress request gauges and token overcounts when lifecycle starts or usage fields are absent
- Background follow-up tool hooks now receive execution telemetry, and observability metric timing state is pruned for abandoned lifecycle pairs
- Cached generation results now receive fresh per-request telemetry, and request metrics stay open across retryable generation failures until the retry decision is terminal
- Cached `PostGenerate` hooks now apply updated results, resume-time tool execution receives telemetry, and in-progress metrics reuse their original gauge labels when closing
- `call_tool` now preserves the original execution context for proxied inline plugin tools, forwarding the incoming `toolCallId`, `interrupt`, and abort context instead of replacing them with synthetic proxy values (#117)

## [0.1.0-alpha.1] - 2026-04-14

### Added

- `@lleverage-ai/agent-threads` — new unified package merging `@lleverage-ai/agent-stream` (event transport/replay) and `@lleverage-ai/agent-ledger` (durable transcripts/run lifecycle) into a single package with subpath exports (`./stream`, `./ledger`, `./server`, `./client`, `./stores/*`)
- Active/terminal run status helpers (`ACTIVE_RUN_STATUSES`, `TERMINAL_RUN_STATUSES`, `isActiveRunStatus()`, `isTerminalRunStatus()`) and the narrowed `ActiveRunStatus` / `TerminalRunStatus` types for safer lifecycle logic reuse
- Protocol decoding now includes explicit `decodeClientMessage()` and `decodeServerMessage()` validators, enabling directional wire-message validation at transport boundaries
- Branch navigation metadata via `ILedgerStore.getThreadTree(threadId)`, including message nodes and fork-point active-child resolution across both in-memory and SQLite ledger stores
- Request-class-aware generation retry policy via `AgentOptions.generationRetryPolicy`, `GenerateOptions.requestClass`, failure classification metadata on `PostGenerateFailure`, and the new `GenerationRetryDecision` observability hook
- Prompt-builder V2 inputs: `PromptContext.instructionLayers`, `PromptContext.memory`, and `PromptContext.loadedSkills`, plus agent-level / per-generation `instructionLayers` and `memory` options for structured prompt composition

### Changed

- `@lleverage-ai/agent-stream` and `@lleverage-ai/agent-ledger` have been merged into `@lleverage-ai/agent-threads` with subpath exports (`./stream`, `./ledger`, `./server`, `./client`, `./stores/*`)
- Workspace scripts (`build`, `type-check`, `test`, `clean`) now use the simplified two-package build order (`agent-threads` → `agent-sdk`)
- `createDefaultPromptBuilder()` now uses a goal-directed, behavior-first default prompt shape with compact capability summaries; verbose tool, skill, and plugin listings remain available as opt-in components
- Context compaction is now protocol-aware: token budgets can reserve output headroom, retained history preserves tool-call/tool-result blocks, and repeated compaction failures open a bounded cooldown circuit instead of retrying indefinitely
- The default prompt builder now renders precedence-ordered instruction layers, surfaces activated skill instructions as a high-priority layer, and renders structured recalled memory separately from standing instructions
- Subagent coordination defaults now better distinguish foreground versus background delegation, encourage self-contained task prompts, and make default background task follow-ups describe subagent work instead of falling back to `Command: unknown command`
- `RecoverResult` typing is now status-narrowed to active-to-terminal transitions (`created|streaming` → `failed|cancelled`)
- `TypedEmitter` now accepts interface-based event maps, allowing `WsClientEvents` to follow the repository `interface` convention without requiring index-signature workarounds
- Fork finalization in both ledger stores is now non-destructive: committing a run at a fork point preserves previously committed branch messages while still superseding older runs at that fork
- `GetTranscriptOptions.branch` now supports explicit branch selections via `{ selections: Record<string, string> }`, and ledger stores now resolve `"active"` transcripts by walking parent-child message links with committed-branch preference
- Removed the `simple-git-hooks` workspace dependency so `bun install` no longer depends on a failing Bun postinstall path
- Refreshed contributor-facing docs to cover workspace commands, changelog expectations, and current deferred/proxy tool-loading behavior
- Generation retry handling now classifies overload, authentication, authorization, transport, and context-overflow failures; hosts can recover auth/transport failures explicitly, bound consecutive overload retries per request class, and optionally reduce `maxTokens` automatically on context-overflow retries
- **BREAKING**: Inline plugin tools now use the `<plugin>__<tool>` namespace instead of `mcp__<plugin>__<tool>`. This also changes helper outputs such as `toolsFromPlugin()` to return inline plugin names in the new qualified form. External MCP servers keep the `mcp__<server>__<tool>` namespace, and DX helpers now distinguish the two with `pluginTools()` / `pluginToolsFor()` vs `mcpTools()` / `mcpToolsFor()`

### Removed

- **BREAKING**: Removed the redundant package-root exports `createFilesystemToolsOnly()`, `createContext()`, `AgentContext`, and `createStateBackend()`. Use `createFilesystemTools()`, an inline `BackendFactory` such as `(state) => new StateBackend(state)`, or your own app-level context object instead.

### Fixed

- Restored missing package entrypoints/barrels after monorepo split, plus restored missing `errors/` and `security/` source trees under `packages/agent-sdk/src`
- Inline plugin tool metadata generation now warns when input-schema conversion fails instead of silently falling back to an empty schema
- Fixed CI/release Bun installs failing on hook setup by setting `SKIP_INSTALL_SIMPLE_GIT_HOOKS=1` in install steps
- Published `@lleverage-ai/agent-sdk` package tarballs now include a package README for npm/GitHub package consumers
- `SQLiteEventStore.append()` now runs in an explicit transaction and rolls back on failure, preventing read-head/insert races and partial writes under concurrency
- `Projector.reset()` no longer reuses mutable initial-state references, preventing dirty-state reuse with mutating reducers (including accumulator flows)
- WebSocket server/client transport resilience hardening in agent-threads (stream layer):
  - replay failures now emit `REPLAY_FAILED` with server-side context logging
  - server and client `sendMessage()` paths now surface/send failures instead of silent drops
  - server now listens for websocket `error` events and cleans up clients safely
  - server broadcast no longer stops delivery to healthy clients when one client overflows
  - client now throws a descriptive constructor-missing error and rejects `connect()` after `close()`
  - reconnect exhaustion/disabled paths now terminate outstanding subscriptions and emit errors
  - invalid inbound server frames now emit client errors instead of being silently ignored
- `FinalizeRunOptions` is now a discriminated union that requires `messages` for `status: "committed"`, preventing transcript-less commits
- `CanonicalMessage.metadata` now enforces `schemaVersion: number` at the type level via `CanonicalMessageMetadata`, and SQLite transcript reads now validate this invariant when decoding stored metadata
- `RunManager.appendEvents()` now rejects appends to terminal-status runs
- `SQLiteLedgerStore.deleteThread()` now runs in a transaction to avoid partial thread deletion on crash
- Stale-run reconciliation now continues recovering remaining runs when one recovery fails
- Release workflow now validates that internal runtime dependencies are already published on npm before publishing a package
- `SQLiteLedgerStore.getTranscript()` now validates branch selector shape and rejects invalid selector payloads
- `WsClient.subscribe()` now handles already-aborted `AbortSignal`s immediately and cleans up abort listeners across unsubscribe/close/failure paths to avoid orphaned iterators and dangling listeners
- `Projector.getState()` now returns a cloned snapshot so external callers cannot mutate internal projector state by reference
- `RunManager.finalizeRun()` now passes `forkFromMessageId` into accumulation so the first committed message of a forked run is correctly linked via `parentMessageId`
- Added and fixed regression coverage for replay failures, websocket error cleanup, broadcast overflow behavior, projector reset mutability, terminal run append rejection, branched regeneration fixtures, and accumulator text-delta edge cases
- Corrected architecture docs with current API/runtime behavior (`run-lifecycle`, `stream-ledger-contract`, `canonical-schema`, `compaction-retention`, and `AGENTS.md` websocket descriptions)
- Deferred function-based plugin tools now register for discovery/proxy loading, and `call_tool` forwards the live `StreamingContext` when they run during `streamDataResponse()`
- `streamDataResponse()` now respects deferred/proxy loading rules for plugin tools instead of leaking deferred tools directly into the active tool set

## [0.0.14] - 2026-03-09

### Added

- `SkillOptions.skillPath` — `defineSkill()` now forwards `skillPath` to `SkillDefinition`, fixing a field that was present on the definition type but missing from the options interface
- `MCPManager.registerStreamingPluginTools()` — registers function-based (streaming) plugin tools for deferred loading via `search_tools` / `call_tool`, calling the factory with `{ writer: null }` at init for schema extraction and re-invoking with request-local `StreamingContext` at execution time

### Fixed

- Function-based (streaming) plugin tools now respect `deferred: true` — the plugin processing loop applies the same deferred/proxy/eager logic as static tools (#89)
- `call_tool` → `MCPManager.callTool()` now receives request-local `StreamingContext`, so deferred streaming tools can stream custom data to the client (#90)
- Deferred streaming plugin tools receive request-local streaming context when invoked via `call_tool`, preventing concurrent `streamDataResponse()` calls from writing to the wrong UI stream
- `search_tools` auto-threshold creation now only counts plugin tools that are actually indexed/discoverable via MCP, so eager streaming-only plugins no longer advertise an empty `search_tools` surface

## [0.0.13] - 2026-02-25

### Changed

- `MCPManager.searchTools()` now uses weighted lexical ranking across tool name, source, description, and input-schema fields, with fuzzy fallback for typo-tolerant matching; this improves result quality for `search_tools` + `call_tool` workflows while keeping lookup latency low via a precomputed in-memory index
- `skill` tool responses now include a structured `content` payload wrapped in `<skill_content>` XML-style tags (with instructions, tool names, optional `skill_path`, and discovered skill resource paths from metadata), enabling consistent context injection for progressive skill activation
- Default prompt composition is now more cache-friendly by excluding the dynamic context section and todo count from default components; this keeps the base system prompt stable across turns unless users explicitly customize it

### Fixed

- `MCPManager.searchTools()` now clamps negative `limit` values to `0`, preventing unintended `Array.slice(0, -n)` behavior and ensuring negative limits return no results
- Checkpoint persistence for `generate()`, `stream()`, `streamResponse()`, and `streamDataResponse()` now prefers provider `response.messages` (assistant tool-call and tool-result transcript) over plain text-only fallbacks, preserving full tool interaction context for resume and continuation flows
- Proxy-mode tool exposure now avoids creating `call_tool` / `search_tools` when no proxied plugin tools or external MCP servers are available, reducing unnecessary tool surface area

## [0.0.12] - 2026-02-22

### Fixed

- `agent.stream()` now forwards reasoning stream parts (`reasoning-start`, `reasoning-delta`, `reasoning-end`) in `StreamPart`, preserving event ordering with text/tool chunks and normalizing `reasoning-delta` payloads across `text`/`delta` field variants

## [0.0.11] - 2026-02-19

### Fixed

- File-based skills (loaded via `loadSkillsFromDirectories`) are now registered in the skill registry and accessible via the `skill` tool — previously the `.tools` filter gate excluded them, dumping all instructions statically into the system prompt instead of using progressive disclosure

## [0.0.10] - 2026-02-19

### Changed

- Replace hand-rolled YAML parser with `yaml` npm package for correct parsing of complex YAML features (e.g. inline JSON mappings in skill frontmatter)
- Metadata values from skill frontmatter are now normalised to `Record<string, string>` for SDK compatibility

## [0.0.9] - 2026-02-18

### Changed

- **BREAKING**: Move `ai` and `zod` from dependencies to peerDependencies — consumers must provide their own versions to avoid duplicate copies and version conflicts

## [0.0.8] - 2026-02-18

### Added

- `resumeDataResponse()` method on Agent for resuming interrupts with a data-stream response
- `executeResumeCore()` shared helper extracted from resume logic, reducing duplication (~270 lines)
- `forkedSessionId` support in `stream()` checkpoint saves, matching the pattern in `generate()`

### Fixed

- `stream()` now saves `pendingInterrupt` to the checkpoint so `agent.getInterrupt(threadId)` works correctly after a streamed interrupt
- `stream()` now emits `InterruptRequested` hooks on interrupt
- `stream()` now uses the correct thread ID (`forkedSessionId ?? threadId`) for all checkpoint saves when session forking is active
- In-memory `threadCheckpoints` cache is now updated in the approval resume path, preventing stale reads on subsequent `generate()` calls

## [0.0.7] - 2026-02-16

### Added

- `call_tool` proxy for invoking plugin tools without loading them into the active ToolSet (`pluginLoading: "proxy"` or per-plugin `deferred: true`)
- Subagent delegation (`plugin.subagent` field) — plugin tools can be scoped to auto-created subagents, keeping the main agent's context clean
- `DelegationPromptComponent` for prompt builder — auto-generates delegation instructions when subagent plugins are present
- `default` export condition in package exports for bundler/runtime compatibility

### Changed

- **BREAKING**: Removed `lazy` and `explicit` plugin loading modes — superseded by proxy mode which keeps the schema stable for prompt caching
- **BREAKING**: Removed `ToolRegistry` class, `createUseToolsTool`, `preloadPlugins` option, and `loadTools()` method
- Plugin registration cascade simplified from 7 branches to 3

## [0.0.6] - 2026-02-11

### Fixed

- Empty assistant message in checkpoint causing API rejection on resume — when the model responds with only a tool call (no text), the checkpoint no longer saves `{ role: "assistant", content: "" }` which the Anthropic API rejects with "text content blocks must be non-empty"

## [0.0.5] - 2026-02-10

### Fixed

- Interrupt resume flow for custom interrupts: fixed `pendingResponses` key mismatch (raw `toolCallId` vs `"int_" + toolCallId`), added manual tool execution on resume instead of relying on model re-calling the tool, and fixed `ToolResultOutput` format to use the discriminated union (`{ type: 'text', value }` / `{ type: 'json', value }`)
- Re-interrupt during custom interrupt resume now works correctly — the interrupt function provided during resume mirrors the original permission-mode wrapper (returns stored response on first call, throws `InterruptSignal` on subsequent calls)
- Interrupt checkpoint not saved on first generation — both the cooperative path and catch-block path now save messages before adding `pendingInterrupt`, ensuring `resume()` always finds a valid checkpoint

## [0.0.4] - 2026-02-10

### Added

- Plugin hook support: plugins can now define `hooks` in their configuration, automatically merged into the agent's hook registration
- Custom hook system: `HookRegistration.Custom` field and `invokeCustomHook()` for plugin-defined lifecycle events
- Middleware `onCustom()` method for subscribing to custom hook events
- Agent Teams plugin (`createAgentTeamsPlugin()`) for multi-agent team coordination
  - `InMemoryTeamCoordinator` for task management, messaging, and teammate tracking
  - `HeadlessSessionRunner` for running teammate agents in the background
  - Team tools: `start_team`, `end_team`, `team_spawn`, `team_message`, `team_task_create`, `team_task_claim`, `team_task_complete`, and more
  - Custom hook events: `TeammateSpawned`, `TeammateIdle`, `TeammateStopped`, `TeamTaskCreated`, `TeamTaskClaimed`, `TeamTaskCompleted`, `TeamMessageSent`
- Automatic background task handling in `agent.generate()`, `stream()`, `streamResponse()`, and `streamDataResponse()`
  - `waitForBackgroundTasks` option (default: `true`) — agent automatically waits for background tasks and triggers follow-up generations
  - `formatTaskCompletion` / `formatTaskFailure` options for custom task result formatting
  - `TaskManager.waitForNextCompletion()` method for awaiting the next terminal task event

### Changed

- Interrupt signals now use a cooperative signal-catching approach (`wrapToolsWithSignalCatching`) that intercepts `InterruptSignal` before the AI SDK's internal tool error handling can convert it to a tool-error result, combined with a custom `stopWhen` condition to cleanly stop generation

## [0.0.3] - 2026-02-07

### Added

- PromptBuilder system for dynamic, context-aware system prompts
  - `PromptBuilder` class for composing prompts from reusable `PromptComponent`s
  - `PromptContext` provides agent state (tools, skills, backend, etc.) to components
  - 7 default components: identity, tools, skills, capabilities, guidelines, context, custom
  - Full backward compatibility with string `systemPrompt`
  - Auto-uses default builder when neither `systemPrompt` nor `promptBuilder` provided

## [0.0.2] - 2026-02-07

### Added

- `AgentSession` class for event-driven agent interactions
  - Async generator interface for processing agent events
  - Automatic handling of background task completions
  - Interrupt and checkpointing integration
- Background task management via `TaskManager`
  - `run_in_background` parameter for bash and task tools
  - `kill_task` and `list_tasks` tools for agent-controlled task lifecycle
  - `executeBackground()` on `FilesystemBackend` for non-blocking commands
  - `task_output` tool for retrieving results with blocking/non-blocking modes
  - Auto-cleanup of tasks after observation via `task_output`
  - Distinct "killed" status separate from "failed" for intentionally stopped tasks
- General-purpose subagent included by default, enabling any agent to spawn subagents without configuration
- Skills system aligned with [Agent Skills specification](https://agentskills.io/specification)
  - File-based skill loading via `loadSkillsFromDirectories()`
  - `instructions` field (renamed from `prompt`) for clarity
  - Metadata fields: license, compatibility
- `createToolHook` helper for creating tool-specific hooks without boilerplate
- `search_tools` auto-loads found tools without requiring `load: true` parameter
- GitHub Action to unpublish/deprecate on tag deletion

### Changed

- **BREAKING**: Removed `LocalSandbox`, `BaseSandbox`, and `createLocalSandbox` - use `FilesystemBackend` with `enableBash: true` instead
- **BREAKING**: Removed `SandboxBackendProtocol` and `isSandboxBackend()` - use `hasExecuteCapability()` instead
- **BREAKING**: Removed `sandbox` option from `createCoreTools()` and `BashToolOptions` - use `backend` instead
- **BREAKING**: Renamed `getSandboxOptionsForAcceptEdits()` to `getBackendOptionsForAcceptEdits()`
- **BREAKING**: Auto threshold for plugin tools no longer overrides default eager loading; to defer loading, explicitly set `toolSearch.enabled: "always"`
- `FilesystemBackend` now provides both file operations and optional bash execution via `enableBash` option
- Hooks can now return `void`/`undefined` for observation-only use cases (e.g., logging)
- `search_tools` only created when deferred loading is explicitly enabled, auto threshold exceeded, or external MCP servers exist
- Deduplicated task completion events between pull and push paths in `AgentSession`

### Removed

- `ask_user` tool - users can implement custom user interaction tools using interrupt/resume mechanisms
- `CoreToolsLegacy` type alias

### Fixed

- Plugin tools not available without explicit configuration
- Hook return type requiring unnecessary boilerplate for observation-only hooks
- Race condition when killing background tasks (status now set before kill)
- `task_output` and `task` tools now correctly share `TaskManager` instance

## [0.0.1] - 2026-02-04

### Added

- Initial release
- Core agent creation with `createAgent()`
- Plugin system with `definePlugin()`
- Skill system with `defineSkill()`
- 10 core tools: read, write, edit, glob, grep, bash, todo_write, task, skill, search_tools
- Backend abstractions: FilesystemBackend, StateBackend, CompositeBackend
- MCP (Model Context Protocol) integration with MCPManager
- Unified hooks system for lifecycle events
- Hook utilities: caching, retry, rate limiting, guardrails, secrets filtering, audit logging
- Middleware system for request/response transformation
- Observability: logging, metrics, tracing with OpenTelemetry compatibility
- Memory system with filesystem and in-memory stores
- Checkpointing with MemorySaver, FileSaver, KeyValueStoreSaver
- Context compaction with multiple strategies (rollup, tiered, structured)
- Background task persistence with FileTaskStore, MemoryTaskStore, KVTaskStore
- Subagent system for task delegation
- Security policy presets (development, ci, production, readonly)
- Production agent presets with `createProductionAgent()`
- Comprehensive error types and graceful degradation utilities
- Testing utilities via `@lleverage-ai/agent-sdk/testing`

[Unreleased]: https://github.com/lleverage-ai/agent-sdk/compare/agent-sdk@1.0.0-rc.8...HEAD
[1.0.0-rc.8]: https://github.com/lleverage-ai/agent-sdk/compare/agent-sdk@1.0.0-rc.7...agent-sdk@1.0.0-rc.8
[1.0.0-rc.7]: https://github.com/lleverage-ai/agent-sdk/compare/agent-sdk@1.0.0-rc.6...agent-sdk@1.0.0-rc.7
[1.0.0-rc.6]: https://github.com/lleverage-ai/agent-sdk/compare/agent-sdk@1.0.0-rc.5...agent-sdk@1.0.0-rc.6
[1.0.0-rc.5]: https://github.com/lleverage-ai/agent-sdk/compare/agent-sdk@1.0.0-rc.4...agent-sdk@1.0.0-rc.5
[1.0.0-rc.4]: https://github.com/lleverage-ai/agent-sdk/compare/agent-sdk@1.0.0-rc.3...agent-sdk@1.0.0-rc.4
[1.0.0-rc.3]: https://github.com/lleverage-ai/agent-sdk/compare/agent-sdk@1.0.0-rc.2...agent-sdk@1.0.0-rc.3
[1.0.0-rc.2]: https://github.com/lleverage-ai/agent-sdk/compare/agent-sdk@1.0.0-rc.1...agent-sdk@1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/lleverage-ai/agent-sdk/compare/agent-sdk@0.1.0-alpha.9...agent-sdk@1.0.0-rc.1
[0.1.0-alpha.1]: https://github.com/lleverage-ai/agent-sdk/compare/agent-sdk@0.0.14...agent-sdk@0.1.0-alpha.1
[0.0.14]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.13...agent-sdk@0.0.14
[0.0.13]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.12...v0.0.13
[0.0.12]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.11...v0.0.12
[0.0.11]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.10...v0.0.11
[0.0.10]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.9...v0.0.10
[0.0.9]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/lleverage-ai/agent-sdk/releases/tag/v0.0.1
