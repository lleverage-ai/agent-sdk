# Generation Modes

`createAgent()` exposes five ways to run one generation. They share a lifecycle
(`src/agent/generation-runner.ts`) but differ in output shape and, in a few
places, in behaviour. This page records those differences so a change to one
mode is a deliberate decision rather than drift.

| Mode | Returns | AI SDK call |
| --- | --- | --- |
| `generate()` | `GenerateResult` | `generateText()` |
| `stream()` | `AsyncGenerator<StreamPart>` | `streamText()` + `fullStream` |
| `streamResponse()` | `Response` (UI message stream) | `streamText()` inside `createUIMessageStream` |
| `streamRaw()` | raw `streamText()` result | `streamText()` |
| `streamDataResponse()` | `Response` (UI message stream) with tool `StreamingContext` | `streamText()` inside `createUIMessageStream` |

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
6. `updateContextUsage`, checkpoint save, `PostGenerate` hooks.
7. Background-task follow-ups while `waitForBackgroundTasks` is on.
8. On error: `retryOrThrow` — `PostGenerateFailure` and
   `GenerationRetryDecision` hooks, fallback model, backoff; or throw the
   normalised `AgentError`.

## Behaviour differences

Recorded as of the #140 refactor. None of these were changed by it.

| Behaviour | `generate` | `stream` | `streamResponse` | `streamRaw` | `streamDataResponse` |
| --- | --- | --- | --- | --- | --- |
| `respondWith` cache short-circuit | result as-is | replayed as `StreamPart`s | plain-text `Response` | not supported | plain-text `Response` |
| Checkpoint thread when `forkSession` is set | `forkedSessionId` | `forkedSessionId` | request `threadId` | request `threadId` | request `threadId` |
| `forkedSessionId` on the result | yes | no | n/a | n/a | n/a |
| `contextManager.updateUsage` after the run | yes | **no** | yes | yes | yes |
| `output` schema read from | effective options (after `PreGenerate`) | **caller's `genOptions`** | effective options | effective options | effective options |
| Pending interrupt persisted + `InterruptRequested` hook | yes (cooperative and thrown paths) | yes | **no** | **no** | yes |
| Non-cooperative `InterruptSignal` thrown out of the AI SDK call | caught, persisted, returned as `interrupted` | propagates to retry handling | propagates | propagates | propagates |
| `checkpointAfterToolCall` (save after every step) | no | no | yes | yes | yes |
| Emergency compaction on context-length error | yes (once, when `enableErrorFallback`) | no | no | no | no |
| `timeToFirstTokenMs` in telemetry | no | yes | no | no | no |
| `providerMetadata` in telemetry usage | yes | no | no | no | no |
| `PostGenerate` `updatedResult` applied | yes | no (already streamed) | no | no | no |
| Follow-up turns | re-enter `agent.generate()` | re-enter `agent.stream()` | `runUIStreamFollowUps` | none | `runUIStreamFollowUps` |
| Follow-ups skipped when | `signalState.stop` | `signalState.interrupt \|\| stop` | `signalState.stop` | n/a | `signalState.interrupt \|\| stop` |
| Follow-up messages when checkpointing | from checkpoint (no explicit `messages`) | from checkpoint | explicit transcript + prompt | n/a | explicit transcript + prompt |

### Follow-up retry differences

`generate()` and `stream()` follow-ups re-enter the public method, so each one
runs `PreGenerate` hooks, `buildMessages` (with run-boundary compaction), and
the full retry loop including emergency compaction. Failures are wrapped in
`NestedBackgroundGenerationError` so the parent rethrows the original error
instead of applying its own retry policy under the wrong request class.

`streamResponse()` and `streamDataResponse()` follow-ups go through
`runUIStreamFollowUps`, which:

- builds the message list itself (`transcript + user prompt`) and compacts
  before the first step via `createStreamingCompactionState(…, true)`;
- retries only failures thrown while *creating* the stream
  (`startRetriedStreamText`), not mid-stream errors;
- when a retry hook returns `updatedOptions` without `_runId`, does **not**
  carry the previous `_runId` forward (the top-level `retryOrThrow` does).

## Where each difference lives

The runner takes the differences as inputs rather than hiding them:

- `beginAttempt(…, "fork-aware" | "request")` selects the checkpoint thread.
- `stream()` overrides `output` after spreading `buildModelCallParams`.
- `createStreamLifecycleCallbacks` (usage, `checkpointAfterToolCall`,
  `PostGenerate`) is only used by the three `Response`-shaped modes.
- Pending-interrupt persistence and `emitInterruptRequested` are called from the
  modes that support them.
- Emergency compaction and the thrown-`InterruptSignal` path stay in
  `generate()`.

## Related

The checkpoint-related rows above (fork target, `updateUsage`, interrupt
persistence, `checkpointAfterToolCall`) are addressed structurally by the
[checkpoint contract](./checkpoint-contract.md) rather than by per-mode
fixes. That contract also removes `streamResponse()`, `streamRaw()` and
`forkSession` for 1.0 (its "Removed" table). This document describes the code
as it is on `main`; the rows for those surfaces are deleted in the same PR
that deletes the code (migration plan step 4), not before.
