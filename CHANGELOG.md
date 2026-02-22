# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.11...HEAD
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
