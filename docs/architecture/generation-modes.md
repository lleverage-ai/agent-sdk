# Generation Modes

`createAgent()` exposes four ways to run one generation. They share a lifecycle
(`src/agent/generation-runner.ts`) but differ in output shape and, in a few
places, in behaviour. This page records those differences so a change to one
mode is a deliberate decision rather than drift.

| Mode | Returns | AI SDK call |
| --- | --- | --- |
| `generate()` | `GenerateResult` | `generateText()` |
| `stream()` | `AsyncGenerator<StreamPart>` | `streamText()` + `fullStream` |
| `streamRaw()` | raw `streamText()` result | `streamText()` |
| `streamDataResponse()` | `Response` (UI message stream) with its own tool `StreamingContext` | `streamText()` inside `createUIMessageStream` |

## Shared lifecycle

Every mode goes through the runner in this order:

1. `beginRun` — resolve the run id (continuing a pending interrupt's run when
   resuming a thread), run `PreGenerate` hooks, surface a `respondWith` cache
   hit.
2. `createRetryState` — one retry state per call from `generationRetryPolicy`.
3. Per attempt: `beginAttempt` (build messages from checkpoint/history/prompt,
   run-boundary compaction, step and thread bookkeeping, base telemetry) and
   `prepareRequest` (signal state, tool pipeline, system prompt, call params).
4. `buildModelCallParams` — model-capability projection of tool results,
   execution context injection, stop conditions, AI SDK passthrough options.
5. Mode-specific call and output handling.
6. `updateContextUsage`, checkpoint save (once per call, when it returns
   normally), `PostGenerate` hooks.
7. Background-task follow-ups while `waitForBackgroundTasks` is on.
8. On error: `retryOrThrow` — `PostGenerateFailure` and
   `GenerationRetryDecision` hooks, fallback model, backoff; or throw the
   normalised `AgentError`.

## Behaviour differences

Recorded as of the #140 refactor. None of these were changed by it.
Checkpoint save timing is no longer a difference: `checkpointAfterToolCall`
was removed before 1.0 ([#180](https://github.com/lleverage-ai/agent-sdk/issues/180)),
and every mode now saves once, when the call returns normally.

| Behaviour | `generate` | `stream` | `streamRaw` | `streamDataResponse` |
| --- | --- | --- | --- | --- |
| `respondWith` cache short-circuit | result as-is | replayed as `StreamPart`s | not supported | plain-text `Response` |
| `contextManager.updateUsage` after the run | yes | **no** | yes | yes |
| `output` schema read from | effective options (after `PreGenerate`) | **caller's `genOptions`** | effective options | effective options |
| Pending interrupt persisted + `InterruptRequested` hook | yes (cooperative and thrown paths) | yes | **no** | yes |
| Non-cooperative `InterruptSignal` thrown out of the AI SDK call | caught, persisted, returned as `interrupted` | propagates to retry handling | propagates | propagates |
| Emergency compaction on context-length error | yes (once, when `enableErrorFallback`) | no | no | no |
| `timeToFirstTokenMs` in telemetry | no | yes | no | no |
| `providerMetadata` in telemetry usage | yes | no | no | no |
| `PostGenerate` `updatedResult` applied | yes | no (already streamed) | no | no |
| Follow-up turns | re-enter `agent.generate()` | re-enter `agent.stream()` | none | `runUIStreamFollowUps` |
| Follow-ups skipped when | `signalState.stop` | `signalState.interrupt \|\| stop` | n/a | `signalState.interrupt \|\| stop` |
| Follow-up messages when checkpointing | from checkpoint (no explicit `messages`) | from checkpoint | n/a | explicit transcript + prompt |
| Tool `StreamingContext` | caller's `GenerateOptions.streamingContext` | caller's | caller's | its own writer; a caller-supplied one is rejected |

### Follow-up retry differences

`generate()` and `stream()` follow-ups re-enter the public method, so each one
runs `PreGenerate` hooks, `buildMessages` (with run-boundary compaction), and
the full retry loop including emergency compaction. Failures are wrapped in
`NestedBackgroundGenerationError` so the parent rethrows the original error
instead of applying its own retry policy under the wrong request class.

`streamDataResponse()` follow-ups go through
`runUIStreamFollowUps`, which:

- builds the message list itself (`transcript + user prompt`) and compacts
  before the first step via `createStreamingCompactionState(…, true)`;
- retries only failures thrown while *creating* the stream
  (`startRetriedStreamText`), not mid-stream errors;
- when a retry hook returns `updatedOptions` without `_runId`, does **not**
  carry the previous `_runId` forward (the top-level `retryOrThrow` does).

## Where each difference lives

The runner takes the differences as inputs rather than hiding them:

- `stream()` overrides `output` after spreading `buildModelCallParams`.
- `createStreamLifecycleCallbacks` (usage, the end-of-stream checkpoint save,
  `PostGenerate`) is only used by `streamRaw()` and `streamDataResponse()`.
- Pending-interrupt persistence and `emitInterruptRequested` are called from the
  modes that support them.
- Emergency compaction and the thrown-`InterruptSignal` path stay in
  `generate()`.

## Related

The revised [checkpoint proposal](./checkpoint-contract.md) starts with an
opt-in sink/source seam, preserving these differences on the legacy path.
It does not claim that a common observer makes existing modes equivalent or
that a step notification is a durable checkpoint barrier. In particular,
no mode may acquire per-step saver calls during a compatibility extraction.

Mode unification, context-usage seeding, recovery/storage changes and API
removals need separate decisions and tests. This document describes code on
`main`; update or delete a row only in the PR that actually changes its
implementation. The consumer baseline in
[lleverage #6988](https://github.com/lleverage-ai/lleverage/pull/6988) is one
regression layer, not proof of database recovery or all five modes' save timing.
