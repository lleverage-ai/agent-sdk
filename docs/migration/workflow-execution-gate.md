# Workflow execution gate: consumer migration evidence

This is M05 of the [Lleverage → Agent SDK 1.0 migration](https://plans.myslop.app/p/60b1793183),
not a complete replacement for the consumer's patched package. Policy remains in
Lleverage; the SDK owns the tool-boundary ordering, cancellation and decision
validation. See the [security guide](../security.md#host-owned-workflow-authorisation)
for the public contract and supported boundaries.

## Reference revisions

- SDK base: `f3fc19ea5b5808c5c9718d040cdf2a49b9976672`.
- Consumer test checkout: `aed305073c31dc7c7c27694c943b0db533124b9e`.
- Consumer patch SHA-256:
  `c4dc7e20a4e81ea187eaadd82e54d9b9ee53c9861ff92ea64a1a8b9ee5860657`.
- Consumer AI SDK: `7.0.8`; SDK development dependency: `7.0.101`.
- Re-audited consumer main `2458cafe89726c0ddda71d4213265620406221a5`:
  the package patch, workflow policy, gate/policy/authority tests, platform agent
  wiring and session-characterisation fixtures/snapshots are unchanged from the
  test checkout. This does not claim that the entire consumer tree is unchanged.

## Port and explicit safety differences

The version-1 option, lookup deadline, request/receipt shape, failure classes and
original 11 consumer gate cases are preserved. This slice also closes gaps in
paths that the consumer's original gate tests did not cover:

- Recheck the resolved proxy target after a hook replaces `call_tool` input.
- Authorise the AI SDK's earlier `needsApproval` callback before it can invoke
  `canUseTool` or custom approval code. Recheck authority at execution and
  cancellation after awaited permission callbacks. Three regressions failed
  before the fix: both approval-callback variants ran before denial, and a body
  ran after cancellation inside its execution permission callback.
- Reject input lifecycle callbacks before model invocation: they can perform I/O
  while input is incomplete, before execution can be authorised. No callers of
  these callbacks were found in the inspected consumer agent-service, agent-core
  or agent-plugins sources.
- Reject gated `resume()` / `resumeDataResponse()` before loading or resolution
  hooks, since those legacy paths invoke raw tools outside the generation
  pipeline. The platform uses host `prepareResume` plus explicit stream
  continuation, not these SDK methods. Ungated legacy resume is unchanged.

These restrictions apply only to the new opt-in gate. Direct trusted host calls,
plugin setup, publication, durable resume policy and service recovery are not
moved into the gate.

## Validation method

The fresh, fully patched agent-service baseline passed **6,344 tests**, with
**3 skipped**, plus its typecheck and 19 dependency build tasks.

For candidate validation, build the SDK and temporarily substitute its `dist`
inside the isolated consumer's installed SDK package, leaving the consumer's
package metadata, AI SDK 7.0.8, manifests, lockfile and source tests unchanged.
Run these existing suites serially:

- `src/modules/agent/workflow-execution-gate.test.ts` (11)
- `src/modules/agent/workflow-agent-policy.test.ts` (32)
- `src/modules/agent/workflow-agent-execution-authority.test.ts` (30)
- `test/sdk-session-characterisation.unit.test.ts` (5, six goldens)
- `test/stream-event-mapper.unit.test.ts` (18)
- `test/session-event-publisher.unit.test.ts` (27)

Also run this PR's two `workflow-execution-gate*.test.ts` files against the
consumer package import, changing only their SDK import path. This checks the
new boundary cases on AI SDK 7.0.8 as well as the SDK's own 7.0.101 installation.
Restore the original package in a `finally` block, verify its original hash,
remove the temporary test copies, and confirm the consumer worktree is clean.
Do not update the existing snapshots.

The narrow substitution is not a full candidate upgrade or typecheck of all
six consumer workspaces. Ownership, usage anchors, summary formatting and the
other migration-map items still require their own ports and validation. These
unit/in-memory suites also do not establish database crash recovery, deployed
flag behaviour, publication visibility or production latency.
