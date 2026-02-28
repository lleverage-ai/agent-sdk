# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `@lleverage-ai/agent-threads` — new unified package merging `@lleverage-ai/agent-stream` (event transport/replay) and `@lleverage-ai/agent-ledger` (durable transcripts/run lifecycle) into a single package with subpath exports (`./stream`, `./ledger`, `./server`, `./client`, `./stores/*`)
- Active/terminal run status helpers (`ACTIVE_RUN_STATUSES`, `TERMINAL_RUN_STATUSES`, `isActiveRunStatus()`, `isTerminalRunStatus()`) and the narrowed `ActiveRunStatus` / `TerminalRunStatus` types for safer lifecycle logic reuse
- Protocol decoding now includes explicit `decodeClientMessage()` and `decodeServerMessage()` validators, enabling directional wire-message validation at transport boundaries

### Changed

- `@lleverage-ai/agent-stream` and `@lleverage-ai/agent-ledger` have been merged into `@lleverage-ai/agent-threads` with subpath exports (`./stream`, `./ledger`, `./server`, `./client`, `./stores/*`)
- Workspace scripts (`build`, `type-check`, `test`, `clean`) now use the simplified two-package build order (`agent-threads` → `agent-sdk`)
- `RecoverResult` typing is now status-narrowed to active-to-terminal transitions (`created|streaming` → `failed|cancelled`)
- `TypedEmitter` now accepts interface-based event maps, allowing `WsClientEvents` to follow the repository `interface` convention without requiring index-signature workarounds

### Fixed

- Restored missing package entrypoints/barrels after monorepo split, plus restored missing `errors/` and `security/` source trees under `packages/agent-sdk/src`
- Fixed CI/release Bun installs failing on hook setup by setting `SKIP_INSTALL_SIMPLE_GIT_HOOKS=1` in install steps
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
- `SQLiteLedgerStore.getTranscript()` now throws for unsupported `branch: { path: string[] }` requests instead of silently ignoring the branch selector
- `WsClient.subscribe()` now handles already-aborted `AbortSignal`s immediately and cleans up abort listeners across unsubscribe/close/failure paths to avoid orphaned iterators and dangling listeners
- `Projector.getState()` now returns a cloned snapshot so external callers cannot mutate internal projector state by reference
- Added and fixed regression coverage for replay failures, websocket error cleanup, broadcast overflow behavior, projector reset mutability, terminal run append rejection, branched regeneration fixtures, and accumulator text-delta edge cases
- Corrected architecture docs with current API/runtime behavior (`run-lifecycle`, `stream-ledger-contract`, `canonical-schema`, `compaction-retention`, and `AGENTS.md` websocket descriptions)

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

[Unreleased]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.13...HEAD
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
