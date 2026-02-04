# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/lleverage-ai/agent-sdk/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/lleverage-ai/agent-sdk/releases/tag/v0.0.1
