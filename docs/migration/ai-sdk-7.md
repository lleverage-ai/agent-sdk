# Migrating to AI SDK 7

`@lleverage-ai/agent-sdk` targets **Vercel AI SDK 7** (`ai@^7`). This document is
the compatibility audit and migration guide for the upgrade from AI SDK 6, and it
also covers the consolidation of the former `@lleverage-ai/agent-threads` package
into the SDK.

## At a glance

| Area | Change | Impact on SDK consumers |
| --- | --- | --- |
| Peer dependency | `ai@^6` → `ai@^7` | Install `ai@^7`, `@ai-sdk/anthropic@^4`, `@ai-sdk/gateway@^4` |
| Runtime | Node 18 → **Node 22+** | Bump your runtime |
| Telemetry type | `TelemetrySettings` → `TelemetryOptions` | `metadata`/`tracer` fields removed from the option type |
| Tool execution context | `experimental_context` passthrough removed | Handled internally; no API change |
| System messages | Rejected in `messages` by default | Handled internally; no behavior change |
| `agent-threads` package | Folded into `@lleverage-ai/agent-sdk` | Repoint imports to `@lleverage-ai/agent-sdk/threads` |

## Dependency strategy

The SDK is **v7-only**. Supporting `ai@6` and `ai@7` behind one compatibility
layer was rejected: the breaking changes (generic `ToolExecutionOptions`, removed
`experimental_context`, telemetry type move) cannot be satisfied by a single set of
call sites. Install the matching providers:

```jsonc
{
  "peerDependencies": { "ai": "^7.0.0", "zod": "^4.0.0" },
  "devDependencies": {
    "@ai-sdk/anthropic": "^4.0.3",
    "@ai-sdk/gateway": "^4.0.6"
  }
}
```

## Compatibility audit: what actually changed

The public `tool()`, `streamText()`, `generateText()`, `stepCountIs`,
`createUIMessageStream*`, `UIMessage`, `ModelMessage`, and `Output` symbols the SDK
uses are **unchanged in name and shape** between v6 and v7. The migration guide's
broader rename list (e.g. `onFinish` → `onEnd`, `stepCountIs` → `isStepCount`,
`needsApproval` removed) did **not** apply — v7 keeps the old names as accepted
aliases. The compiler-verified breaking changes that affected this SDK were:

1. **`ToolExecutionOptions` became generic** — `ToolExecutionOptions<CONTEXT>` now
   requires a type argument. The SDK's inline tools are untyped, so it uses
   `ToolExecutionOptions<unknown>`. The v6 `experimental_context` field on tool
   options was renamed to `context: CONTEXT`.

2. **Call-level `experimental_context` was removed** from `streamText`/`generateText`
   options. In v6 the SDK passed an opaque per-call context object there and inline
   tools read it from `options.experimental_context`. v7's replacements
   (`runtimeContext`, `toolsContext`) do not provide the same "forward an arbitrary
   object to every untyped tool's options" behavior, so the SDK now injects the
   context itself via `wrapToolsWithExecutionContext` (an internal per-call tool
   wrapper). Inline tools still read `options.experimental_context` unchanged.

3. **`TelemetrySettings` is no longer exported**; the telemetry option type is now
   `TelemetryOptions`. See [Telemetry](#telemetry-and-redaction) below.

4. **System-role messages in `messages` are rejected by default.** v7 wants system
   prompts via the top-level `instructions`/`system` options. Because the SDK
   accepts arbitrary canonical message histories (which can contain system
   messages), every model invocation now sets `allowSystemInMessages: true` to
   preserve v6 behavior.

5. **`tool.description` may now be a function** (`string | (() => string)`). Where
   the SDK reads a description for metadata it normalizes non-string descriptions to
   `""`.

6. **Declaration portability** — v7's `Tool` return type references provider-utils
   internals that are not portably nameable from a bun/pnpm `node_modules` layout.
   The core tool factories now carry explicit `Tool` return-type annotations.

### Streaming and message changes

No public streaming API changed for SDK consumers. Internally the SDK still uses
`response.fullStream`, `onStepFinish`, `createUIMessageStream`, and
`createUIMessageStreamResponse`, all of which remain valid in v7. The only
message-level adjustment is `allowSystemInMessages: true` (above).

### Approvals

Tool approval semantics are unchanged. `tool.needsApproval` is still honored in
v7, so the SDK's `canUseTool` → `needsApproval` bridge continues to drive the AI
SDK's native approval flow. The SDK deliberately does **not** adopt v7's new
`toolApproval` configuration: SDK approvals remain a protocol/UX concern, and
server-side authorization stays in tools/platform policy.

### Telemetry and redaction

`GenerateOptions.experimental_telemetry` is retyped from `TelemetrySettings` to
`TelemetryOptions`, and a forward-looking `telemetry` option is added (the v7 name).
When both are set, `telemetry` wins. The SDK passes the resolved value straight
through to `generateText`/`streamText` — it does not enable, transform, or
interpret it.

Redaction guarantees survive: `TelemetryOptions` still exposes `recordInputs` and
`recordOutputs`, both defaulting to `true`. Set them to `false` to keep prompts and
completions out of spans, exactly as before.

What changed: the v6 `metadata` and `tracer` fields are **not** part of
`TelemetryOptions`. AI SDK 7 also moves the OpenTelemetry integration into the
separate `@ai-sdk/otel` package, registered globally via `registerTelemetry(...)`,
rather than being built in. Provide custom span attributes through a registered
telemetry integration instead of `metadata`.

## `agent-threads` consolidation

The standalone `@lleverage-ai/agent-threads` package has been folded into
`@lleverage-ai/agent-sdk`. The stream + ledger transport, replay, and durable
transcript primitives now ship from the SDK under `./threads` subpath exports. The
exported symbols are identical; only the package name in the import specifier
changes.

| Old import (`@lleverage-ai/agent-threads…`) | New import (`@lleverage-ai/agent-sdk…`) |
| --- | --- |
| `@lleverage-ai/agent-threads` | `@lleverage-ai/agent-sdk/threads` |
| `@lleverage-ai/agent-threads/stream` | `@lleverage-ai/agent-sdk/threads/stream` |
| `@lleverage-ai/agent-threads/ledger` | `@lleverage-ai/agent-sdk/threads/ledger` |
| `@lleverage-ai/agent-threads/server` | `@lleverage-ai/agent-sdk/threads/server` |
| `@lleverage-ai/agent-threads/client` | `@lleverage-ai/agent-sdk/threads/client` |
| `@lleverage-ai/agent-threads/stores/event-memory` | `@lleverage-ai/agent-sdk/threads/stores/event-memory` |
| `@lleverage-ai/agent-threads/stores/event-sqlite` | `@lleverage-ai/agent-sdk/threads/stores/event-sqlite` |
| `@lleverage-ai/agent-threads/stores/ledger-memory` | `@lleverage-ai/agent-sdk/threads/stores/ledger-memory` |
| `@lleverage-ai/agent-threads/stores/ledger-sqlite` | `@lleverage-ai/agent-sdk/threads/stores/ledger-sqlite` |

The canonical transcript types (`CanonicalMessage`, `CanonicalPart`,
`CompactionSummaryPart`, `BranchSelections`, …) are owned by the SDK's root export
(`@lleverage-ai/agent-sdk`) and are also re-exported from
`@lleverage-ai/agent-sdk/threads/ledger`, so either import path resolves to the
same type.

> Migrating a large codebase? The change is a mechanical find/replace of the
> package name. No symbol was renamed.
