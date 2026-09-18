# Owned in-process delegations (M04)

This slice upstreams the ownership portion of lleverage's patched
`0.1.0-alpha.9`, not a new execution or recovery model. The reference is
lleverage `8b5c5c41647b6df1b7ac9f7d28c970e33fd75e68`, patch SHA-256
`c4dc7e20a4e81ea187eaadd82e54d9b9ee53c9861ff92ea64a1a8b9ee5860657`.
SDK base: `4c454c50282d83832eb8b81c96e18cb5b55d0593` (#161).

## Configuration and boundaries

```typescript
const agent = createAgent({
  model,
  subagents: approvedRoster,
  includeGeneralPurposeSubagent: false,
  ownedTaskPolicy: {
    cancellationGraceMs: 5_000,
    // No delegationTimeoutMs or drainTimeoutMs: no lifetime timers.
    replayBudget: { maxEntries: 100, maxBytes: 1_000_000 },
  },
  ownedTaskCallbacks: {
    // Synchronous admission, before factory/ready/hooks. May throw to refuse.
    admit: (task) => hostAdmission.reserve(task), // returns a release function
    onUnresolved: (report) => hostRecovery.report(report),
  },
});

agent.taskManager.beginTaskScope({ runId, attemptId, signal });
try {
  await agent.generate({ prompt, signal });
} finally {
  try {
    await agent.taskManager.settleOwnedTasks("Host attempt ended");
  } finally {
    // Drops payloads, NOT unresolved promises or their held permits.
    agent.taskManager.releaseOwnedTaskResults();
  }
}
```

The host supplies the roster, identifiers, admission implementation, cancellation
signal and response to failed cleanup. In a retrying host, **do not release
results between attempts in the same run**: settle, then begin the next attempt
with the same `runId` to retain completed-call replay protection. Release results
only at the final run boundary or when transferring unresolved owners to the
host's recovery handling. This example is a single-attempt run, not a recipe for
replacing the platform executor.

`ownedTaskPolicy` is opt-in. Explicit durations must be positive finite numbers;
only `cancellationGraceMs` is required. Omitting lifetime/drain durations creates
**no timer**, not a larger default timeout. The example's grace is host policy,
not an SDK default. `includeGeneralPurposeSubagent` defaults to `true`; `false`
keeps the supplied roster without adding the built-in general-purpose delegate.

Ownership covers `task` calls using this configured agent's `TaskManager`, both
foreground and background. Standalone `createTaskTool()` callers must supply the
configured manager. It does not automatically govern independent agents,
agent-teams factories, detached host work or descendants using another manager.
Existing bash process termination remains separate.

## Cancellation is not settlement

- Register ownership and reserve admission before factory, `ready`, start/stop
  hooks, generation or raw streaming. Factories receive
  `SubagentCreateContext.signal`; pass it into host initialisation work.
- Cancellation immediately marks a child killed and fences later generation,
  hooks, result publication and streamed completion. A child's optional wall
  timeout includes queue/factory/hook time and cancels **that child only**.
- Start/stop hook promises are all observed with `Promise.allSettled`; unlike the
  legacy hook timeout race, ownership does not abandon a slow sibling hook.
  Owned child `PostGenerate` callbacks also remain joined until they actually
  settle. Cancellation reaches their hook context and rejects late rewrites;
  an abort race must not release a permit while completion-hook I/O continues.
  Internal async-local delegation context preserves this rule through host
  wrappers that compose signals, without changing their public execution APIs.
- Wait up to one cancellation grace per record. Repeated kills do not renew it.
  Kill-all cancels siblings before waiting, rather than spending one grace per
  child. Newly cancelled siblings still get their own original grace.
- Work ignoring cancellation is quarantined. `subagent_cleanup_unresolved`
  carries task/run/attempt identities and a reason. Permits release only when
  real execution settles, even after normal task registrations/results are
  removed. A late result never changes a killed task to completed.
- Quarantine blocks new owned delegation admissions across managers sharing the
  loaded SDK module. It is process-local, **not** a distributed fence. Once late
  work settles, other managers can admit again, but the failed manager/scope
  stays failed. Host worker retirement or readiness policy can remain stricter.
- `onUnresolved` reports once per failed scope, without prompts/results. Its
  synchronous exceptions and async rejections are contained, and it is not
  awaited. A failing notification never erases ownership. Admission reservation
  is synchronous; release is invoked at settlement, not at cancellation.

SDK generation failure paths settle children before failure/retry hooks,
fallback requests or emergency compaction. `dispose()` rejects if cleanup is
unresolved, while releasing ordinary retained payloads and disconnecting MCP in
`finally`. Do not treat a failed `killAllTasks()` or a consumed killed card as
proof of successful disposal.

## Delivery and replay

`consumeTask(id)` makes one synchronous claim shared by `task_output` and
automatic follow-ups. Foreground results return inline, never through the
background queue. Completed tool-call IDs retain their result/handle across
settled attempts within a run; they do not spawn duplicate work.

Replay limits reject subsequent admissions with
`subagent_replay_budget_exhausted`, rather than evicting successful-call fencing.
`maxEntries` counts retained calls. `maxBytes` is a threshold checked at the next
admission, using UTF-8 foreground result/error bytes; it is **not a hard cap on
one result or already-admitted concurrent work**. Background replay retains a
small handle, while its result is consumed once from the manager. Budgets are
optional, positive integers. A new run or explicit final release clears retained
replay data. Internal `TaskManager.owned` state is not a durable recovery API.

## Small corrections beyond the reference patch

The port also closes these tested boundary gaps:

1. Cancellation in a synchronous `taskCreated` listener now sees a fully
   initialised owner and stops execution before the factory. A registration
   listener throwing does not leak the admission permit. Both new regressions
   fail against the pinned patched package.
2. UI background follow-ups check cancellation before final checkpoint saves,
   just like initial generation. This regression failed against the initial
   literal port. A write already in flight cannot be rolled back; cancellation
   during that write prevents subsequent `PostGenerate` hooks.
3. Async unresolved-report/release callback rejections are observed without
   delaying execution or allowing them to erase ownership.
4. Cancellation during `PostGenerate` reaches the callback and prevents applying
   `updatedResult`. Ordinary hooks retain their timeout race; owned completion
   hooks instead stay joined to the real work, subject to the owner's optional
   lifetime and cancellation grace. Grace-only ownership adds no hidden hook
   lifetime. Context is isolated from concurrent ordinary callers.

Late final-save and `PostGenerate` fences apply to ordinary cancelled generation
as well as owned children. Successful ordinary execution is unchanged. Generic
hook timers/listeners are now removed on success/failure as well as timeout.
Per-step checkpoint timing and existing response-mode differences are retained.

## Validation and remaining migration

SDK tests include the consumer's 56 ownership characterisation cases, callback
and replay-budget tests, and cancellation before final saves/after awaited saves
across all five generation modes and the shared UI follow-up path. The copied
semaphore is **test-only host queue policy**, not a new SDK concurrency feature.

Validate the built candidate against unchanged consumer suites:

- `platform/subagents/{owned-tasks,admission-guard,platform-roster}.test.ts`
- `threads/__tests__/subagent-ownership.test.ts`
- `test/run-executor.unit.test.ts`
- workflow execution gate, policy and execution-authority suites
- session characterisation goldens, stream mapper and event publisher suites

Use consumer AI SDK `7.0.8` as well as SDK development `7.0.101`. Restore the
original patched package after each isolated swap. No snapshot regeneration,
consumer patch removal, all-workspace upgrade or release is part of this PR.

Patch hunks accounted for here: `owned-tasks.js`; ownership changes to
`task-manager.js/.d.ts`, `tools/task.js`, `hooks.js`, `types.d.ts`; the agent's
configuration, roster, drain, retry, final-save and disposal changes. Existing
SDK extraction means these agent changes live partly in `generation-runner.ts`
and `tool-pipeline.ts`. Other hunks in those same files remain separate slices.

The host keeps run admission, tenant limits, scope/attempt transitions, executor
retry/drain ordering, service health/recovery, persistence and publication.
These are unit/in-memory and package-swap checks, not DB crash recovery,
distributed admission, deployed rollout or full 1.0 migration proof.
