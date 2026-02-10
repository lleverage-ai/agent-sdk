# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Plugin hook support: plugins can now define `hooks` in their configuration, automatically merged into the agent's hook registration
- Custom hook system: `HookRegistration.Custom` field and `invokeCustomHook()` for plugin-defined lifecycle events
- Middleware `onCustom()` method for subscribing to custom hook events
- Agent handoff mechanism: `handoff()` and `handback()` functions available in tool execution context for swapping the active agent mid-conversation
- `GenerateResultHandoff` result type and `isHandoffResult()` type guard
- Agent Teams plugin (`createAgentTeamsPlugin()`) for multi-agent team coordination via handoff
  - `InMemoryTeamCoordinator` for task management, messaging, and teammate tracking
  - `HeadlessSessionRunner` for running teammate agents in the background
  - Team tools: `start_team`, `end_team`, `team_spawn`, `team_message`, `team_task_create`, `team_task_claim`, `team_task_complete`, and more
  - Custom hook events: `TeammateSpawned`, `TeammateIdle`, `TeammateStopped`, `TeamTaskCreated`, `TeamTaskClaimed`, `TeamTaskCompleted`, `TeamMessageSent`

### Changed

- Handoff and interrupt signals now use a cooperative signal-catching approach (`wrapToolsWithSignalCatching`) that intercepts `HandoffSignal`/`InterruptSignal` before the AI SDK's internal tool error handling can convert them to tool-error results, combined with a custom `stopWhen` condition to cleanly stop generation

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

[Unreleased]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.3...HEAD
[0.0.3]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/lleverage-ai/agent-sdk/releases/tag/v0.0.1
