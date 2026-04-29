# `pi-agent-core` study — implications for `@lleverage-ai/agent-sdk`

**Status:** research note · prepared 2026-04-28 · scope: `@lleverage-ai/agent-sdk@0.1.0-alpha.3` vs `@mariozechner/pi-agent-core@0.70.6` (pi-mono).

This document studies pi-agent-core as a reference implementation and proposes targeted changes to our SDK. It does **not** propose replacing the SDK or its dependencies. The accompanying PoC on `research/lifecycle-events` lands the smallest, most defensible item from the list (lifecycle events).

---

## 1. Executive summary

pi-agent-core is a **2 000-LoC, single-purpose agent runtime** designed to be wrapped by a coding-agent CLI and a LitElement web UI. Our agent-sdk is a **~30-module enterprise framework** with checkpointing, MCP, plugin proxy, observability, security, and a public hook bus. They are not the same product and we should not try to make them the same product. They are both at a pre-1.0, alpha-cadence stage; pi-agent-core ships every 1–3 days and is a single-maintainer project.

That said, pi-agent-core is **clearly better than us at three things**:

1. **Event lifecycle.** It emits `agent_start/end`, `turn_start/end`, `message_start/update/end`, `tool_execution_start/update/end` as a uniform, additive discriminated union. Our `StreamPart` is an AI SDK pass-through with no turn or message boundaries — workflow-service hand-rolls a `messageId` and a `step-started/finished` mapping in `stream-event-mapper.ts` to compensate.
2. **Live state observability.** Its `AgentState` exposes `isStreaming`, `streamingMessage`, `pendingToolCalls`, `errorMessage` as readonly accessors. UI components can `requestUpdate()` against them directly. Our `Agent` is opaque between `generate()` calls.
3. **Mid-run user input (steering / follow-up).** It has a documented public API — `agent.steer(message)`, `agent.followUp(message)`, with explicit drain points and "one-at-a-time" / "all" modes. Our `AgentSession.sendMessage()` exists but is private to the session abstraction; its queue is not surfaced through `Agent` and not part of `Checkpoint`.

It is **clearly worse than us** at: persistence (no built-in checkpointer), hook breadth (no `PreCheckpointSave`, no `PostCompact`, no MCP lifecycle), provider routing (no fallback model + retry pipeline), tool-loading proxy (no `search_tools`/`call_tool`), security policies (no `applySecurityPolicy`), context compaction (only `transformContext` callback, no scheduler), and stability (breaking minor releases roughly weekly).

It is **the same as us, just structured differently** at: tool execution (both wrap `execute(args, options)` with hooks; ours has more), provider abstraction (both pass an opaque model object through; pi-agent-core has `streamFn` injection, we don't).

The right move: **borrow the event/state/queueing patterns; do not borrow the runtime**. The PoC on this branch lands the smallest piece (lifecycle events).

---

## 2. Dimension-by-dimension comparison

### 2.1 Agent state model

| | `@lleverage-ai/agent-sdk` | `pi-agent-core` |
|---|---|---|
| Persistable snapshot | `Checkpoint { threadId, step, messages, state, pendingInterrupt?, createdAt, updatedAt, metadata? }` (`src/checkpointer/types.ts:143`) | None. Consumers serialise themselves; coding-agent uses a JSONL-with-versioned-entries format |
| In-memory state | `AgentState { todos, files }` (`src/backends/state.ts:96`) — todo + virtual filesystem only | `AgentState { systemPrompt, model, thinkingLevel, tools, messages, isStreaming, streamingMessage, pendingToolCalls, errorMessage }` (`packages/agent/src/types.ts:264`) — full live view |
| Storage backends | `MemorySaver`, `FileSaver`, `KeyValueStoreSaver`, plus `BaseCheckpointSaver` interface | Out of scope |
| Resume | `agent.resume(threadId, interruptId, response)` reconstructs from storage | `Agent.continue()` uses in-memory state only |
| Mutability | `Checkpoint` is plain JSON; `Agent` instance is immutable across `generate()` calls (closures only) | `agent.state.tools = [...]` works at runtime; getters/setters; mutation by design |

**Where each model wins:**

- pi-agent-core wins on **live observability**: a UI component can read `agent.state.isStreaming` and `agent.state.streamingMessage` to render a "currently typing…" indicator and the partial assistant message without subscribing to events. Our SDK forces consumers to track this themselves (workflow-service's `executeAgentStreamAttempt` does exactly that).
- agent-sdk wins on **persistence**: workflow-service's GCS checkpoint saver is a 124-line implementation of `BaseCheckpointSaver` (`apps/workflow-service/src/modules/agent/platform/checkpointer/gcs-checkpoint-saver.ts`). pi-agent-core punts persistence entirely; coding-agent re-implements it from scratch in a 700-LoC `SessionManager`. For a multi-tenant platform, the SDK-owned checkpointer is a feature, not a flaw.
- agent-sdk wins on **portability**: `Checkpoint` is JSON-serialisable and round-trips through GCS. pi-agent-core's state contains a `Model<TApi>` instance, which is not portable.

**Conclusion:** keep our `Checkpoint` shape. Add a small **live state surface** on `Agent` so UIs can observe in-flight runs without hand-rolling.

### 2.2 Event / stream model

| | `@lleverage-ai/agent-sdk` | `pi-agent-core` |
|---|---|---|
| Event union | `StreamPart` — 11 variants, mostly AI SDK pass-through (`src/types.ts:2256`) | `AgentEvent` — 10 variants with explicit lifecycle (`packages/agent/src/types.ts:350`) |
| Lifecycle | None — turn boundaries inferred from `step-start`/`step-finish` chunks **which our `stream()` silently drops** (`src/agent.ts:2944-2997`) | `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end` |
| Tool events | `tool-call`, `tool-result` | `tool_execution_start`, `tool_execution_update` (partial results), `tool_execution_end` |
| Stable IDs | None — `tool-call.toolCallId` and `tool-result.toolCallId` only; no message id | Per-message `id` and `assistantMessageEvent` correlate everything |
| Delivery | `AsyncGenerator<StreamPart>` from `agent.stream()`; AI-SDK UI-message protocol from `streamResponse`; `UIMessageStreamWriter` from `streamDataResponse` | `EventStream<AgentEvent, AgentMessage[]>` from `agentLoop()`; subscribe callback from `Agent.subscribe()` |

**The gap that bites us today:** workflow-service hand-rolls `assistantMessageId`, threads it through 17 emitter calls in `run-executor.ts`, then re-emits AI-SDK chunk types (`step-start`, `step-finish`, `tool-input-available`, `tool-output-available`, …) as `step-started`/`step-finished`/`tool-call`/`tool-result` in `stream-event-mapper.ts` (~250 LoC). The SDK already knows the canonical shape but doesn't expose it.

pi-agent-core's `turn_start/turn_end` is the simplest fix and aligns 1:1 with AI SDK's `start-step`/`finish-step` chunks (which the SDK currently drops). **The PoC on this branch implements exactly that.** It's purely additive and unlocks workflow-service simplification.

### 2.3 Interruption / queued input

| | `@lleverage-ai/agent-sdk` | `pi-agent-core` |
|---|---|---|
| Tool-driven interrupt | `await options.interrupt(state, { type })` throws `InterruptSignal`; outer wrapper catches; `Checkpoint.pendingInterrupt` records it (`src/agent.ts:118, 429`) | None — pi-agent-core has no checkpointer-backed interrupts |
| Approval interrupts | `canUseTool(name, input) → "allow" \| "deny" \| "ask"` produces `ApprovalInterrupt` | None |
| Mid-turn user input | None at `Agent` level; `AgentSession.sendMessage()` queues between turns (private) | `agent.steer(msg)` and `agent.followUp(msg)` with documented drain points; "one-at-a-time" / "all" modes |
| Cancellation | `AbortController` on `GenerateOptions.signal`; plumbed into AI SDK and tools | `agent.abort()` aborts an `AbortController`; `agent.signal` exposed |
| Resume | `agent.resume(threadId, interruptId, response)` from checkpoint | `agent.continue()` from in-memory state |

**Where each wins:**

- agent-sdk wins on **interrupt fidelity** — a tool can request structured input, the agent suspends to a checkpoint, and the resume path can come hours later from a different process. workflow-service exploits this for OAuth dance, ask-user, workflow-node pauses, and integration-action callbacks.
- pi-agent-core wins on **mid-run steering** — a user can inject a follow-up message while the model is still thinking, and the loop drains it at the next turn boundary. Our `AgentSession` does this but it's not exposed on `Agent` itself, and the queue is not part of `Checkpoint`.

**Workflow-service compensates** by building a per-run interrupt gate (`interrupt-gate.ts`), a Redis+GCS double-write of interrupt data (`agent.service.ts:262-282`), and a 13-branch `prepareResume` switch (`agent.service.ts`) that re-executes the original tool, patches checkpoints, etc. Some of this complexity is intrinsic to multi-tenant interrupt semantics — but the steering case is genuinely missing.

**Conclusion:** keep our interrupt machinery. Add a public `agent.steer(message)` that drains between turns. Make the queue part of `Checkpoint` so a steering message issued during a checkpointed pause survives a resume.

### 2.4 Tool execution

| | `@lleverage-ai/agent-sdk` | `pi-agent-core` |
|---|---|---|
| Tool definition | AI SDK `tool({ description, inputSchema, execute })` — re-export | `AgentTool { label, prepareArguments?, execute(toolCallId, args, signal, onUpdate?) }` extending pi-ai's `Tool` |
| Validation | AI SDK does it via Zod | typebox `validateToolArguments` |
| Lifecycle hooks | `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `ToolRegistered`, `ToolLoadError` plus tool-name regex matchers | `beforeToolCall`, `afterToolCall` |
| Per-tool execution mode | None | `executionMode: "sequential" \| "parallel"` per tool; one sequential tool in a batch downgrades the whole batch |
| Partial results | `StreamingContext.writer.write(...)` with `data-*` parts | `onUpdate(partial)` callback driving `tool_execution_update` events |
| Cancellation | `AbortSignal` via `ToolExecutionOptions.abortSignal` | `AbortSignal` arg |
| Termination | None — a tool can `throw InterruptSignal` to stop the loop | `AgentToolResult.terminate: true` short-circuits when **all** results in a batch terminate |

**Where each wins:**

- agent-sdk wins on **hook breadth** and **regex matchers** — `PreToolUse[matcher: "^bash$"]` is a real, tested pattern (`src/hooks.ts:62`).
- pi-agent-core wins on **execution mode + onUpdate**. Workflow-service approximates `onUpdate` via `StreamingContext.writer.write({ type: "data-workflow-form" })` (`runtime/node-to-tool.ts:232-243`), but this is plumbed only through `streamDataResponse()`, not through `agent.stream()`. A typed `onUpdate` would be more uniform.

**Conclusion:** keep our hook system. Consider adding a per-tool `executionMode` option (medium impact, additive). Defer `onUpdate` until we've seen more demand — the `StreamingContext.writer` pattern is fine for now.

### 2.5 Transport / UI separation

| | `@lleverage-ai/agent-sdk` | `pi-agent-core` |
|---|---|---|
| Core stream | `agent.stream() → AsyncGenerator<StreamPart>` | `agentLoop() → EventStream<AgentEvent>` |
| Web Response | `agent.streamResponse() → Response` (UI-message protocol); `agent.streamDataResponse() → Response` (UI-message + custom data parts); `agent.streamRaw()` | None — consumers wrap themselves |
| Sibling transport packages | `@lleverage-ai/agent-threads` (WebSocket runtime) | `streamProxy()` (single function in same package) |
| UI-message protocol | First-class via AI SDK's `toUIMessageStreamResponse()` | None |

pi-agent-core has cleaner separation but it's because it does less. Our `streamResponse`/`streamDataResponse` are real productivity wins for Next.js consumers and are not making workflow-service's life harder (workflow-service uses `agent.stream()`, not the Web Response variants). The cost of moving them to a sibling package is high; the benefit is mostly aesthetic.

**Conclusion:** no action. Document the layering more clearly (which method to use when), but don't fragment the package.

### 2.6 Provider abstraction

| | `@lleverage-ai/agent-sdk` | `pi-agent-core` |
|---|---|---|
| Model interface | Vercel AI SDK `LanguageModel` passed through | pi-ai `Model<TApi>` passed through |
| Wrapper | None — `streamText`/`generateText` from `ai` called directly in `agent.ts` | `streamFn: StreamFn` injection point on `Agent`/`AgentLoopConfig`; default is `streamSimple` |
| Provider count | Whatever Vercel AI SDK supports (~25 first-party + community) | 25+ via pi-ai's `KnownProvider` union with per-API `compat` overrides |
| Special features | `fallbackModel`, `generationRetryPolicy` (overload/auth/transport/context_overflow classifications) | First-class thinking blocks (`ThinkingContent` with `signature`), cost accounting in every `Usage`, cache retention preference, OAuth provider system, OpenRouter routing knobs |

The user's brief was explicit: do not replace Vercel AI SDK. I agree. Vercel AI SDK v6 has thinking blocks, prompt caching, tool approval, and is the de-facto industry standard. The migration cost would be enormous (every provider, every test, every hook input shape) and the win is marginal.

The one thing pi-agent-core has that we lack is **`streamFn` injection** — a single hook that lets you replace the model call. Use cases:
- Test recordings without `vi.mock("ai", ...)` per file
- Custom telemetry on the model call without wrapping every provider
- Proxy through a managed gateway (already partially solved via `vercel-ai-gateway` provider)

**Conclusion:** investigate exposing a `streamFn?: typeof streamText` option on `createAgent` as a thin escape hatch. This is a small additive change that helps recordings and proxy use cases without touching the runtime.

---

## 3. Ranked improvements

Ranked by `(impact / migration cost)` for our SDK and our consumers (workflow-service, partners-app, agent-cli). All of these are additive; none are breaking.

### 1. Lifecycle events: `turn-start` / `turn-end` (LANDED IN POC) — high impact, low cost

**Problem:** workflow-service generates `assistantMessageId` itself and threads it through the stream. It also re-derives `step-started`/`step-finished` from chunks the SDK's `agent.stream()` silently drops.

**Change:** add `turn-start { messageId? }` and `turn-end { messageId?, finishReason?, usage? }` to `StreamPart`. Emit them on AI SDK's `start-step` / `finish-step`. Bracket the cached-result path the same way.

**Impact:**
- Workflow-service can use the SDK's `messageId` instead of inventing one (~17 callsites in `run-executor.ts`).
- Workflow-service can drop `step-start` / `step-finish` mapping (~10 lines in `stream-event-mapper.ts`).
- Per-turn telemetry (one usage per turn) becomes available without awaiting the final result.

**Migration:** zero — additive types, exhaustive switches see new variants but no existing variant changed shape.

**Status:** implemented on `research/lifecycle-events`. Three new tests, full suite passes, type-check clean.

### 2. Stable agent message IDs in mid-stream events — high impact, low cost

**Problem:** the `text-delta`, `reasoning-delta`, and `tool-call` events have no message id, so consumers can't correlate them to the assistant message they belong to until `turn-end` fires.

**Change:** annotate `text-delta`, `reasoning-delta`, `tool-call`, `tool-result` with an optional `messageId?: string` populated from the same `LanguageModelResponseMetadata` we surface on `turn-end`. (AI SDK doesn't carry the id on `start-step`, but it does carry it at the start of the assistant message via the `start` chunk for full UI-message-protocol streams; we'd populate `messageId` from the most recently seen `finish-step.response.id` after the first turn boundary, and leave it `undefined` for the first turn.)

**Impact:** workflow-service drops its private `assistantMessageId` plumbing.

**Migration:** zero — optional field on existing variants.

**Trade-off:** the first-turn deltas have no id. Workflow-service can fall back to its own generation in that one window, or we can derive a synthetic id from `runId`.

### 3. Public `agent.steer(message)` / `agent.followUp(message)` with checkpointed queue — high impact, medium cost

**Problem:** `AgentSession.sendMessage()` exists but the queue is private and not in `Checkpoint`. workflow-service has no way to inject a mid-run user message.

**Change:** add `steerQueue: ModelMessage[]` and `followUpQueue: ModelMessage[]` to `Checkpoint`. Add `agent.steer(msg)` / `agent.followUp(msg)` methods that push onto these queues and persist via the checkpointer. Drain `steerQueue` at the top of each step in `agent.stream()`; drain `followUpQueue` at loop exit. Mode: default `"one-at-a-time"`, configurable per call.

**Impact:** unlocks live conversation steering for workflow runs. Replaces the private session queue.

**Migration:** additive on `Checkpoint` (consumers ignore unknown keys). One-line on workflow-service to wire `POST /threads/:id/steer` to `agent.steer`.

**Risk:** subtle race conditions between drain and AI SDK abort. pi-agent-core's reference implementation handles this by having drain points outside the AI SDK call. We'd want a similar pattern.

### 4. Live state surface: `agent.getState(threadId)` — medium impact, low cost

**Problem:** UIs and admin endpoints want "what is the agent currently doing for thread X" without subscribing to events. Today the answer requires loading the latest checkpoint and inspecting `pendingInterrupt`.

**Change:** add `agent.getState(threadId): { isStreaming: boolean; pendingToolCalls: Set<string>; lastMessageId?: string; pendingInterrupt?: Interrupt }`. Driven by the existing `threadCheckpoints` map and a small in-memory run registry.

**Impact:** workflow-service can drop its `Map<threadId, RunState>` (`runtime.ts:60-100`) parallel to `agent.taskManager`.

**Migration:** additive.

### 5. Re-export missing backend types — low impact, trivial cost

**Problem:** `gvisor-sandbox-backend.ts:21-34` inlines `ExecuteBackgroundOptions`, `ExecuteBackgroundResult`, `SandboxCallOptions`, `WriteOptions`, `SandboxLogger` because the SDK only exports the read-side types.

**Change:** add the missing exports to `src/index.ts`.

**Impact:** workflow-service deletes ~20 LoC of duplicated types. Improves type-driver bug detection.

**Migration:** zero — only adding exports.

### 6. Per-tool `executionMode: "sequential" | "parallel"` — medium impact, medium cost

**Problem:** ask-user, OAuth init, and skill-mutation tools have side effects that benefit from being sequenced. Today each tool wraps its own mutex or hopes the model serialises.

**Change:** add `executionMode?: "sequential" | "parallel"` to tool definitions (or to a `tool.experimental_metadata` field). When the SDK calls a batch of tool-calls, if any has `executionMode: "sequential"`, run the whole batch sequentially (pi-agent-core's "downgrade" semantics).

**Impact:** workflow-service drops a couple of ad-hoc mutexes. More predictable side-effect ordering.

**Migration:** additive. Default behaviour (parallel) unchanged.

**Trade-off:** AI SDK doesn't natively support per-tool sequencing. We'd implement it in our tool wrapper layer. Some performance loss for batches that contain even one sequential tool.

### 7. `streamFn?: typeof streamText` injection point — medium impact, medium cost

**Problem:** test recordings need `vi.mock("ai", ...)` per file. There's no clean way to swap in a managed-gateway proxy or a recording stream without forking.

**Change:** add `streamFn?: typeof streamText` and `generateFn?: typeof generateText` options to `createAgent`. Default to the AI SDK functions. Use the override everywhere `streamText`/`generateText` is called (5 sites in `agent.ts`).

**Impact:** simpler test setup. Enables a pluggable model proxy for org-level cost accounting and audit.

**Migration:** additive.

**Trade-off:** any per-call wrapper has to honour the AI SDK signature exactly — drift across AI SDK versions becomes a maintenance hazard.

### 8. `interruptedAt?` flag on `ModelMessage` (or on `Checkpoint`) — medium impact, medium cost

**Problem:** `interrupted-assistant-checkpointer.ts` adds and removes the literal string `"\n\n[This response was interrupted before completion.]"` to assistant messages on every load/save. It only exists because the SDK has no other way to mark an assistant message as cut short.

**Change:** add `messageStatus?: "complete" | "interrupted"` (or `interruptedAt?: string`) to a per-message metadata sidecar in `Checkpoint` (avoid touching `ModelMessage` since that's an AI SDK type).

**Impact:** workflow-service deletes the wrapper checkpointer.

**Migration:** additive on `Checkpoint`. Wrapper-removal is local to workflow-service.

### 9. SDK-issued interrupt IDs tied to tool calls — low impact, low cost

**Problem:** workflow-service uses an `int_<toolCallId>` convention to correlate interrupts to tool calls. This is undocumented and fragile.

**Change:** when `interrupt()` produces an `Interrupt`, set `Interrupt.toolCallId` and (optionally) make `Interrupt.id` derive from the tool call. Document the convention.

**Impact:** workflow-service deletes `extractToolCallIdFromInterruptId`. Removes the magic prefix.

**Migration:** additive type field; the magic prefix can stay until consumers migrate.

### 10. Single-interrupt-per-turn policy — low impact, low cost

**Problem:** `interrupt-gate.ts:50-89` exists because the SDK allows multiple tools in a turn to call `interrupt()` and only the first one surfaces predictably. workflow-service throws `ParallelInterruptError` to enforce its own invariant.

**Change:** add `interruptPolicy?: "single-per-turn" | "first-wins"` (default `"first-wins"` — current behaviour). When `"single-per-turn"`, the SDK throws on the second concurrent interrupt.

**Impact:** workflow-service drops the gate.

**Migration:** opt-in flag.

---

## 4. Do not adopt

Findings where pi-agent-core's pattern is **not** appropriate for us.

### A. Do not replace Vercel AI SDK with pi-ai

pi-ai has nice features (thinking blocks with signatures, cost accounting, OAuth providers, OpenRouter routing). Most of these are now in Vercel AI SDK v6 (thinking, caching, tool approval). The migration cost — every provider, every hook input shape, every test mock — would be measured in person-months. The win is marginal. Stay on Vercel AI SDK.

### B. Do not adopt the class-with-mutable-state pattern

pi-agent-core's `agent.state.tools = [...]`, `agent.beforeToolCall = fn` is convenient for a single-process CLI/UI but disastrous for our multi-tenant service. Mutation by assignment is invisible to telemetry, breaks observability, and in workflow-service would create cross-thread contamination. Keep `createAgent(options)` as the immutable factory.

### C. Do not abandon the SDK-owned checkpointer

pi-agent-core's "no checkpointer" stance forces every consumer to roll their own persistence (coding-agent has 700 LoC of `SessionManager`; partners-app, agent-cli, workflow-service would each duplicate). Our `BaseCheckpointSaver` interface is the right abstraction for a platform; keep it.

### D. Do not adopt `CustomAgentMessages` declaration merging

It's clever but global side effects through TypeScript declaration merging are fragile in monorepos with multiple consumers (workflow-service, partners-app, app, agent-cli all import the SDK and would race on the merge). Tree-shaking suffers. Our `data-*` UI parts pattern in `streamDataResponse` is fine.

### E. Do not adopt pi-agent-core's release cadence

Mario ships ~14 versions a month, often with breaking changes. Lleverage agent-sdk has external consumers (workflow-service, agent-cli, partners-app, customers using `@lleverage-ai/agent-threads`); we need stable APIs. Continue with planned semver discipline. Keep alpha changes inside `0.1.0-alpha.x`; bundle breaking changes into a single `0.2.0` release rather than dripping them.

### F. Do not move `streamResponse`/`streamDataResponse` to a sibling package

The cleaner separation pi-agent-core has is partly because its UI is a separate package. For us, `streamResponse` (Next.js useChat) is a primary feature; fragmenting the package adds dependency complexity for partners. Keep them in the main package and document the layering.

### G. Do not adopt per-tool `prepareArguments` shim

pi-agent-core uses it to coerce LLM args before validation. We already get coercion from Zod. Adding a second hook layer would duplicate work and create ambiguity about where validation happens.

### H. Do not adopt the in-package `streamProxy` HTTP proxy

It's coupled to pi-agent-core's particular `ProxySerializableStreamOptions` shape. We have `@lleverage-ai/agent-threads` for transport. Keep that separation.

---

## 5. Compatibility checklist

Anything proposed above must preserve workflow-service's existing surface. Concretely:

- ✓ `agent.stream({ messages, threadId, … })` keeps returning `AsyncIterable<StreamPart>`. New event types are additive.
- ✓ `Checkpoint.messages` keeps the AI SDK `ModelMessage[]` shape and round-trips through GCS.
- ✓ `BaseCheckpointSaver { save, load, list, delete, exists }` interface unchanged.
- ✓ `ExtendedToolExecutionOptions { interrupt, toolCallId, taskManager? }` unchanged.
- ✓ `definePlugin({ name, description, deferred?, tools, skills?, … })` unchanged.
- ✓ `pluginLoading: "proxy"` semantics unchanged.
- ✓ `createContextManager(...)` accepts all current options.
- ✓ `createDefaultPromptBuilder(components)` API unchanged.
- ✓ `agent.taskManager` and `agent.getInterrupt(threadId)` still present.
- ✓ Hook event names and shapes unchanged. New events would be additional registrations, not replacements.

The PoC on this branch satisfies all of the above.

---

## 6. PoC summary (this branch)

**Branch:** `research/lifecycle-events`

**Files changed:**
- `packages/agent-sdk/src/types.ts` — add `turn-start` and `turn-end` to `StreamPart` union (additive).
- `packages/agent-sdk/src/agent.ts` — emit `turn-start` on AI SDK `start-step`; emit `turn-end` on `finish-step` with `messageId` from `response.id`, plus per-turn `finishReason` and `usage`. Bracket the cached-result short-circuit the same way.
- `packages/agent-sdk/tests/streaming-lifecycle-events.test.ts` — three new tests covering single-turn, multi-turn (with tool round-trip), and missing-response-id paths.
- `CHANGELOG.md` — entry under `[Unreleased]`.

**Test results:** 2159/2167 pass (8 pre-existing skips), type-check clean.

**Follow-up the PoC enables in workflow-service:** see ranked items 1, 2 — they become a small mechanical patch (drop `assistantMessageId` plumbing in `run-executor.ts`; drop the `step-start`/`step-finish` cases in `stream-event-mapper.ts`).
