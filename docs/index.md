**@lleverage-ai/agent-sdk**

***

# @lleverage-ai/agent-sdk

@lleverage-ai/agent-sdk - A TypeScript framework for building AI agents.

Built on top of Vercel AI SDK, this library provides a comprehensive toolkit
for creating intelligent agents that can use tools, respond to hooks, and
delegate tasks to specialized subagents.

## Quick Start

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";
import { tool } from "ai";
import { z } from "zod";

// Create an agent with tools
const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  systemPrompt: "You are a friendly assistant.",
  tools: {
    greet: tool({
      description: "Greet a person by name",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => `Hello, ${name}!`,
    }),
  },
});

// Generate a response
const result = await agent.generate({
  prompt: "Say hello to Alice",
});

// Or use with Next.js API routes and useChat
export async function POST(req: Request) {
  const { messages } = await req.json();
  return agent.streamResponse({ messages });
}
```

## Key Concepts

- **Agents** - The main abstraction combining a model with tools and plugins
- **Tools** - Use AI SDK's `tool()` function directly for full compatibility
- **Plugins** - Bundles of tools, skills, and hooks for reusability
- **Skills** - User-invocable slash commands
- **Hooks** - Lifecycle event handlers for observing agent behavior
- **Subagents** - Specialized agents for task delegation

## AI SDK Compatibility

This SDK is built on Vercel AI SDK and maintains full compatibility:
- Use `tool()` from 'ai' to define tools
- Use `CoreMessage` and `UIMessage` types directly
- `streamResponse()` returns a Response compatible with `useChat`
- `streamRaw()` returns the raw AI SDK `streamText` result

## Classes

### Tools

| Class | Description |
| :------ | :------ |
| [SkillRegistry](classes/SkillRegistry.md) | Registry for managing loadable skills. |
| [ToolRegistry](classes/ToolRegistry.md) | Registry for managing tools with deferred loading. |

### Hooks

| Class | Description |
| :------ | :------ |
| [HookTimeoutError](classes/HookTimeoutError.md) | Error thrown when a hook times out. |
| [InMemoryCacheStoreHook](classes/InMemoryCacheStoreHook.md) | Default in-memory cache store implementation with LRU eviction. |
| [TokenBucketRateLimiter](classes/TokenBucketRateLimiter.md) | Token bucket rate limiter implementation. |

### Backend

| Class | Description |
| :------ | :------ |
| [BaseSandbox](classes/BaseSandbox.md) | Abstract base class for sandbox implementations. |
| [CommandBlockedError](classes/CommandBlockedError.md) | Error thrown when a command is blocked by security filters. |
| [CommandTimeoutError](classes/CommandTimeoutError.md) | Error thrown when a command execution times out. |
| [CompositeBackend](classes/CompositeBackend.md) | A backend that routes operations to different backends based on path prefixes. |
| [FileSizeLimitError](classes/FileSizeLimitError.md) | Error thrown when a file exceeds the size limit. |
| [FilesystemBackend](classes/FilesystemBackend.md) | Filesystem backend implementation for real disk operations. |
| [InMemoryStore](classes/InMemoryStore.md) | In-memory implementation of KeyValueStore for development and testing. |
| [LocalSandbox](classes/LocalSandbox.md) | Local sandbox for shell command execution. |
| [PathTraversalError](classes/PathTraversalError.md) | Error thrown when a path traversal attack is detected. |
| [PersistentBackend](classes/PersistentBackend.md) | Backend implementation using a pluggable key-value store. |
| [StateBackend](classes/StateBackend.md) | In-memory backend implementation using AgentState. |
| [SymlinkError](classes/SymlinkError.md) | Error thrown when a symlink is encountered and not allowed. |

### Checkpointer

| Class | Description |
| :------ | :------ |
| [FileSaver](classes/FileSaver.md) | File-based checkpoint saver using JSON files. |
| [KeyValueStoreSaver](classes/KeyValueStoreSaver.md) | Checkpoint saver that wraps a KeyValueStore. |
| [MemorySaver](classes/MemorySaver.md) | In-memory checkpoint saver. |

### Errors

| Class | Description |
| :------ | :------ |
| [AbortError](classes/AbortError.md) | Error thrown when an operation is aborted. |
| [AgentError](classes/AgentError.md) | Base error class for all agent SDK errors. |
| [AuthenticationError](classes/AuthenticationError.md) | Error thrown when authentication fails. |
| [AuthorizationError](classes/AuthorizationError.md) | Error thrown when authorization fails. |
| [BackendError](classes/BackendError.md) | Error thrown when backend operations fail. |
| [CheckpointError](classes/CheckpointError.md) | Error thrown when checkpoint operations fail. |
| [ConfigurationError](classes/ConfigurationError.md) | Error thrown when agent configuration is invalid. |
| [ContextError](classes/ContextError.md) | Error thrown when context management fails. |
| [GeneratePermissionDeniedError](classes/GeneratePermissionDeniedError.md) | Error thrown when a generation request is denied by a PreGenerate hook. |
| [MemoryError](classes/MemoryError.md) | Error thrown when memory operations fail. |
| [ModelError](classes/ModelError.md) | Error thrown when the AI model fails or returns an error. |
| [NetworkError](classes/NetworkError.md) | Error thrown when a network request fails. |
| [RateLimitError](classes/RateLimitError.md) | Error thrown when rate limits are exceeded. |
| [SubagentError](classes/SubagentError.md) | Error thrown when subagent operations fail. |
| [TimeoutError](classes/TimeoutError.md) | Error thrown when an operation times out. |
| [ToolExecutionError](classes/ToolExecutionError.md) | Error thrown when a tool execution fails. |
| [ToolPermissionDeniedError](classes/ToolPermissionDeniedError.md) | Error thrown when a tool execution is denied by a PreToolUse hook. |
| [ValidationError](classes/ValidationError.md) | Error thrown when input validation fails. |

### MCP

| Class | Description |
| :------ | :------ |
| [MCPInputValidationError](classes/MCPInputValidationError.md) | Validation error thrown when MCP tool input validation fails. |
| [MCPInputValidator](classes/MCPInputValidator.md) | Validator for MCP tool inputs using AJV. |
| [MCPManager](classes/MCPManager.md) | Manages MCP tool registration, discovery, and execution. |
| [VirtualMCPServer](classes/VirtualMCPServer.md) | Virtual MCP server that wraps inline plugin tools. |

### Memory

| Class | Description |
| :------ | :------ |
| [FileMemoryPermissionStore](classes/FileMemoryPermissionStore.md) | File-based implementation of MemoryPermissionStore. |
| [FilesystemMemoryStore](classes/FilesystemMemoryStore.md) | Filesystem-based implementation of MemoryStore. |
| [InMemoryMemoryStore](classes/InMemoryMemoryStore.md) | In-memory implementation of MemoryStore for testing. |
| [InMemoryPermissionStore](classes/InMemoryPermissionStore.md) | In-memory implementation of MemoryPermissionStore for testing. |

### Other

| Class | Description |
| :------ | :------ |
| [BufferedOutputGuardrail](classes/BufferedOutputGuardrail.md) | Controller for buffered output guardrails. |

### TaskStore

| Class | Description |
| :------ | :------ |
| [FileTaskStore](classes/FileTaskStore.md) | File-based implementation of the task store. |
| [KVTaskStore](classes/KVTaskStore.md) | Key-value store implementation of the task store. |
| [MemoryTaskStore](classes/MemoryTaskStore.md) | In-memory implementation of the task store. |

## Interfaces

### Agent

| Interface | Description |
| :------ | :------ |
| [Agent](interfaces/Agent.md) | An agent instance capable of generating responses and executing tools. |
| [AgentOptions](interfaces/AgentOptions.md) | Configuration options for creating an agent. |
| [GenerateOptions](interfaces/GenerateOptions.md) | Options for generating a response. |
| [GenerateResultComplete](interfaces/GenerateResultComplete.md) | Result from a completed generation request. |
| [GenerateResultInterrupted](interfaces/GenerateResultInterrupted.md) | Result from an interrupted generation request. |
| [GenerateStep](interfaces/GenerateStep.md) | A single step in the generation process. |
| [PartialGenerateResult](interfaces/PartialGenerateResult.md) | Partial result data available when generation is interrupted. |
| [ToolCallResult](interfaces/ToolCallResult.md) | A tool call made by the model. |
| [ToolResultPart](interfaces/ToolResultPart.md) | Result from a tool execution. |

### Tools

| Interface | Description |
| :------ | :------ |
| [BashResult](interfaces/BashResult.md) | Result of command execution. |
| [BashToolOptions](interfaces/BashToolOptions.md) | Options for creating a bash tool. |
| [CoreTools](interfaces/CoreTools.md) | Result from createCoreTools containing all created tools and registries. |
| [CoreToolsOptions](interfaces/CoreToolsOptions.md) | Options for creating core tools. |
| [FilesystemTools](interfaces/FilesystemTools.md) | Result from createFilesystemTools containing all filesystem tools. |
| [FilesystemToolsOptions](interfaces/FilesystemToolsOptions.md) | Options for creating filesystem tools. |
| [LoadableSkillDefinition](interfaces/LoadableSkillDefinition.md) | Definition of a loadable skill for progressive disclosure. |
| [SearchToolsOptions](interfaces/SearchToolsOptions.md) | Options for creating the search_tools tool. |
| [SkillDefinition](interfaces/SkillDefinition.md) | Definition of a skill providing contextual instructions for agents. |
| [SkillLoadResult](interfaces/SkillLoadResult.md) | Result from attempting to load a skill. |
| [SkillOptions](interfaces/SkillOptions.md) | Options for the [defineSkill](functions/defineSkill.md) helper function. |
| [SkillRegistryOptions](interfaces/SkillRegistryOptions.md) | Options for creating a skill registry. |
| [SkillToolOptions](interfaces/SkillToolOptions.md) | Options for creating the skill loading tool. |
| [TodoInput](interfaces/TodoInput.md) | Input for a todo item. |
| [TodosChangedData](interfaces/TodosChangedData.md) | Data for todo change events. |
| [TodoWriteToolOptions](interfaces/TodoWriteToolOptions.md) | Options for creating the todo_write tool. |
| [ToolLoadResult](interfaces/ToolLoadResult.md) | Result from loading tools. |
| [ToolMetadata](interfaces/ToolMetadata.md) | Lightweight metadata for a registered tool. |
| [ToolRegistryOptions](interfaces/ToolRegistryOptions.md) | Options for creating a tool registry. |
| [ToolSearchOptions](interfaces/ToolSearchOptions.md) | Options for searching tools. |
| [UseToolsToolOptions](interfaces/UseToolsToolOptions.md) | Options for creating the use_tools meta-tool. |

### Plugins

| Interface | Description |
| :------ | :------ |
| [AgentPlugin](interfaces/AgentPlugin.md) | A plugin that extends agent functionality. |
| [PluginOptions](interfaces/PluginOptions.md) | Options for the [definePlugin](functions/definePlugin.md) helper function. |

### Hooks

| Interface | Description |
| :------ | :------ |
| [AuditEvent](interfaces/AuditEvent.md) | Structured audit event. |
| [AuditHooksOptions](interfaces/AuditHooksOptions.md) | Options for creating audit hooks. |
| [CacheEntryHook](interfaces/CacheEntryHook.md) | Cache entry with timestamp for TTL enforcement. |
| [CacheHooksOptions](interfaces/CacheHooksOptions.md) | Options for creating cache hooks. |
| [CacheStoreHook](interfaces/CacheStoreHook.md) | Cache storage interface. |
| [GenerationLoggingHooksOptions](interfaces/GenerationLoggingHooksOptions.md) | Options for creating logging hooks. |
| [GuardrailsHooksOptions](interfaces/GuardrailsHooksOptions.md) | Options for creating guardrails hooks. |
| [HookCallbackContext](interfaces/HookCallbackContext.md) | Context passed to hook callbacks. |
| [HookMatcher](interfaces/HookMatcher.md) | Matcher for filtering which tools trigger hooks. |
| [HookOutput](interfaces/HookOutput.md) | Output from a hook callback. |
| [HookRegistration](interfaces/HookRegistration.md) | Configuration for registering hooks with matchers. |
| [HookSpecificOutput](interfaces/HookSpecificOutput.md) | Hook-specific output that controls operation behavior. |
| [InterruptRequestedInput](interfaces/InterruptRequestedInput.md) | Input for InterruptRequested hooks. |
| [InterruptResolvedInput](interfaces/InterruptResolvedInput.md) | Input for InterruptResolved hooks. |
| [MCPConnectionFailedInput](interfaces/MCPConnectionFailedInput.md) | Input for MCPConnectionFailed hooks. |
| [MCPConnectionRestoredInput](interfaces/MCPConnectionRestoredInput.md) | Input for MCPConnectionRestored hooks. |
| [PostCompactInput](interfaces/PostCompactInput.md) | Input for PostCompact hooks. |
| [PostGenerateFailureInput](interfaces/PostGenerateFailureInput.md) | Input for PostGenerateFailure hooks. |
| [PostGenerateInput](interfaces/PostGenerateInput.md) | Input for PostGenerate hooks. |
| [PostToolUseFailureInput](interfaces/PostToolUseFailureInput.md) | Input for PostToolUseFailure hooks. |
| [PostToolUseInput](interfaces/PostToolUseInput.md) | Input for PostToolUse hooks. |
| [PreCompactInput](interfaces/PreCompactInput.md) | Input for PreCompact hooks. |
| [PreGenerateInput](interfaces/PreGenerateInput.md) | Input for PreGenerate hooks. |
| [PreToolUseInput](interfaces/PreToolUseInput.md) | Input for PreToolUse hooks. |
| [RateLimitHooksOptions](interfaces/RateLimitHooksOptions.md) | Options for creating rate limit hooks. |
| [RetryHooksOptions](interfaces/RetryHooksOptions.md) | Options for creating retry hooks. |
| [SecretsFilterHooksOptions](interfaces/SecretsFilterHooksOptions.md) | Options for creating secrets filter hooks. |
| [ServerRateLimitInfo](interfaces/ServerRateLimitInfo.md) | Server-provided rate limit information from response headers. |
| [SubagentStartInput](interfaces/SubagentStartInput.md) | Input for SubagentStart hooks. |
| [SubagentStopInput](interfaces/SubagentStopInput.md) | Input for SubagentStop hooks. |
| [ToolLoadErrorInput](interfaces/ToolLoadErrorInput.md) | Input for ToolLoadError hooks. |
| [ToolRegisteredInput](interfaces/ToolRegisteredInput.md) | Input for ToolRegistered hooks. |

### Subagents

| Interface | Description |
| :------ | :------ |
| [EnhancedSubagentDefinition](interfaces/EnhancedSubagentDefinition.md) | Enhanced subagent definition with additional capabilities. |
| [ParallelExecutionResult](interfaces/ParallelExecutionResult.md) | Result from parallel subagent execution. |
| [ParallelTask](interfaces/ParallelTask.md) | Options for a single parallel execution task. |
| [SubagentContext](interfaces/SubagentContext.md) | Isolated context for a subagent execution. |
| [SubagentContextOptions](interfaces/SubagentContextOptions.md) | Options for creating an isolated subagent context. |
| [SubagentCreateContext](interfaces/SubagentCreateContext.md) | Context passed to subagent factory functions. |
| [SubagentDefinition](interfaces/SubagentDefinition.md) | Definition of a subagent type for task delegation. |
| [SubagentErrorEvent](interfaces/SubagentErrorEvent.md) | Event emitted when an error occurs. |
| [SubagentEvent](interfaces/SubagentEvent.md) | Base event for subagent lifecycle. |
| [SubagentEventEmitter](interfaces/SubagentEventEmitter.md) | Event emitter interface for subagent events. |
| [SubagentExecutionOptions](interfaces/SubagentExecutionOptions.md) | Options for executing a subagent. |
| [SubagentExecutionResult](interfaces/SubagentExecutionResult.md) | Result from executing a subagent. |
| [SubagentFinishEvent](interfaces/SubagentFinishEvent.md) | Event emitted when a subagent finishes. |
| [SubagentOptions](interfaces/SubagentOptions.md) | Configuration for creating a subagent. |
| [SubagentStartEvent](interfaces/SubagentStartEvent.md) | Event emitted when a subagent starts. |
| [SubagentStepEvent](interfaces/SubagentStepEvent.md) | Event emitted for each subagent step. |
| [TaskToolOptions](interfaces/TaskToolOptions.md) | Configuration for creating a task delegation tool. |
| [TaskToolOptions\_Tool](interfaces/TaskToolOptions_Tool.md) | Options for creating the task tool. |

### Context

| Interface | Description |
| :------ | :------ |
| [AgentContext](interfaces/AgentContext.md) | Context for managing state during agent execution. |
| [CompactionPolicy](interfaces/CompactionPolicy.md) | Policy for determining when to trigger context compaction. |
| [CompactionResult](interfaces/CompactionResult.md) | Result from a context compaction operation. |
| [CompactionScheduler](interfaces/CompactionScheduler.md) | Scheduler for managing background compaction tasks. |
| [CompactionSchedulerOptions](interfaces/CompactionSchedulerOptions.md) | Options for creating a compaction scheduler. |
| [CompactionTask](interfaces/CompactionTask.md) | A background compaction task. |
| [ContextManager](interfaces/ContextManager.md) | Manages conversation context with token tracking and auto-compaction. |
| [ContextManagerOptions](interfaces/ContextManagerOptions.md) | Options for creating a context manager. |
| [CustomTokenCounterOptions](interfaces/CustomTokenCounterOptions.md) | Options for creating a custom token counter. |
| [PinnedMessageMetadata](interfaces/PinnedMessageMetadata.md) | Metadata for pinned messages that should always be kept. |
| [StructuredSummary](interfaces/StructuredSummary.md) | Structured summary format with distinct sections. Provides better context organization and parsing. |
| [SummarizationConfig](interfaces/SummarizationConfig.md) | Configuration for automatic context summarization. |
| [TokenBudget](interfaces/TokenBudget.md) | Token budget tracking for context management. |
| [TokenCounter](interfaces/TokenCounter.md) | Interface for counting tokens in text and messages. |

### Types

| Interface | Description |
| :------ | :------ |
| [AgentDataTypes](interfaces/AgentDataTypes.md) | Custom data types for agent-specific streaming events. These extend AI SDK's UIDataTypes to add subagent, progress, and other events. |
| [ExtendedToolExecutionOptions](interfaces/ExtendedToolExecutionOptions.md) | Extended tool execution options that include interrupt capability. |
| [StreamingContext](interfaces/StreamingContext.md) | Context for streaming data from tools to the client. |
| [StreamingMetadata](interfaces/StreamingMetadata.md) | Metadata identifying the source of streamed data. |

### Backend

| Interface | Description |
| :------ | :------ |
| [AgentState](interfaces/AgentState.md) | Complete agent state including todos and virtual filesystem. |
| [BackendProtocol](interfaces/BackendProtocol.md) | Core backend protocol interface for file operations. |
| [CompositeBackendOptions](interfaces/CompositeBackendOptions.md) | Options for creating a CompositeBackend. |
| [EditResult](interfaces/EditResult.md) | Result from an edit operation. |
| [ExecuteResponse](interfaces/ExecuteResponse.md) | Response from command execution. |
| [FileData](interfaces/FileData.md) | File content storage format. |
| [FileInfo](interfaces/FileInfo.md) | Metadata for a file or directory entry. |
| [FilesystemBackendOptions](interfaces/FilesystemBackendOptions.md) | Configuration options for FilesystemBackend. |
| [FileUploadResponse](interfaces/FileUploadResponse.md) | Response from file upload operation. |
| [GrepMatch](interfaces/GrepMatch.md) | A match from a grep search operation. |
| [KeyValueStore](interfaces/KeyValueStore.md) | Pluggable key-value store interface. |
| [LocalSandboxOptions](interfaces/LocalSandboxOptions.md) | Configuration options for LocalSandbox. |
| [PersistentBackendOptions](interfaces/PersistentBackendOptions.md) | Configuration options for PersistentBackend. |
| [SandboxBackendProtocol](interfaces/SandboxBackendProtocol.md) | Extended backend protocol with command execution capabilities. |
| [TodoItem](interfaces/TodoItem.md) | A single todo item for task tracking. |
| [WriteResult](interfaces/WriteResult.md) | Result from a write operation. |

### Checkpointer

| Interface | Description |
| :------ | :------ |
| [ApprovalInterrupt](interfaces/ApprovalInterrupt.md) | Approval interrupt - a specialized interrupt for tool approval requests. |
| [ApprovalRequest](interfaces/ApprovalRequest.md) | Request data for an approval interrupt. |
| [ApprovalResponse](interfaces/ApprovalResponse.md) | Response data for an approval interrupt. |
| [BaseCheckpointSaver](interfaces/BaseCheckpointSaver.md) | Abstract storage interface for checkpoints. |
| [Checkpoint](interfaces/Checkpoint.md) | Complete snapshot of an agent session. |
| [CheckpointLoadedEvent](interfaces/CheckpointLoadedEvent.md) | Event emitted when a checkpoint is loaded. |
| [CheckpointSavedEvent](interfaces/CheckpointSavedEvent.md) | Event emitted when a checkpoint is saved. |
| [CheckpointSaverOptions](interfaces/CheckpointSaverOptions.md) | Options for creating a checkpoint saver. |
| [FileSaverOptions](interfaces/FileSaverOptions.md) | Options for creating a FileSaver. |
| [Interrupt](interfaces/Interrupt.md) | Base interrupt type - the shared mechanism for pausing agent execution. |
| [KeyValueStoreSaverOptions](interfaces/KeyValueStoreSaverOptions.md) | Options for creating a KeyValueStoreSaver. |
| [MemorySaverOptions](interfaces/MemorySaverOptions.md) | Options for creating a MemorySaver. |

### Errors

| Interface | Description |
| :------ | :------ |
| [FallbackOptions](interfaces/FallbackOptions.md) | Options for graceful degradation. |
| [WrapErrorOptions](interfaces/WrapErrorOptions.md) | Options for wrapping errors. |

### MCP

| Interface | Description |
| :------ | :------ |
| [HttpMCPServerConfig](interfaces/HttpMCPServerConfig.md) | Configuration for HTTP-based MCP servers. |
| [MCPManagerOptions](interfaces/MCPManagerOptions.md) | Options for MCPManager initialization. |
| [MCPToolLoadResult](interfaces/MCPToolLoadResult.md) | Result from loading MCP tools. |
| [MCPToolMetadata](interfaces/MCPToolMetadata.md) | Metadata for an MCP tool. |
| [SseMCPServerConfig](interfaces/SseMCPServerConfig.md) | Configuration for SSE-based MCP servers (streaming). |
| [StdioMCPServerConfig](interfaces/StdioMCPServerConfig.md) | Configuration for stdio-based MCP servers. These run as local processes communicating via stdin/stdout. |

### Memory

| Interface | Description |
| :------ | :------ |
| [AdditionalMemoryFile](interfaces/AdditionalMemoryFile.md) | Result from loading additional memory files. |
| [BuildMemorySectionOptions](interfaces/BuildMemorySectionOptions.md) | Options for building the memory section. |
| [BuildPathMemoryContextOptions](interfaces/BuildPathMemoryContextOptions.md) | Options for building path-specific memory context. |
| [FileMemoryPermissionStoreOptions](interfaces/FileMemoryPermissionStoreOptions.md) | Options for FileMemoryPermissionStore. |
| [FilesystemMemoryStoreOptions](interfaces/FilesystemMemoryStoreOptions.md) | Configuration options for FilesystemMemoryStore. |
| [LoadAdditionalMemoryOptions](interfaces/LoadAdditionalMemoryOptions.md) | Options for loading additional memory files. |
| [LoadAgentMemoryOptions](interfaces/LoadAgentMemoryOptions.md) | Options for loading agent memory. |
| [LoadAllMemoryOptions](interfaces/LoadAllMemoryOptions.md) | Options for loading all agent memory. |
| [LoadAllMemoryResult](interfaces/LoadAllMemoryResult.md) | Result from loading all agent memory. |
| [MemoryApproval](interfaces/MemoryApproval.md) | Approval record for a memory file. |
| [MemoryAuditEvent](interfaces/MemoryAuditEvent.md) | Audit event emitted when memory is loaded. |
| [MemoryDocument](interfaces/MemoryDocument.md) | A memory document with metadata and content. |
| [MemoryMetadata](interfaces/MemoryMetadata.md) | YAML frontmatter metadata for a memory document. |
| [MemoryPermissionStore](interfaces/MemoryPermissionStore.md) | Store interface for memory permissions. |
| [MemoryStore](interfaces/MemoryStore.md) | Interface for storing and retrieving memory documents. |
| [ParsedMarkdown](interfaces/ParsedMarkdown.md) | Result from parsing a markdown file with frontmatter. |
| [PathMemoryContext](interfaces/PathMemoryContext.md) | Result from building path-specific memory context. |

### Middleware

| Interface | Description |
| :------ | :------ |
| [AgentMiddleware](interfaces/AgentMiddleware.md) | Agent middleware interface. |
| [LoggingMiddlewareOptions](interfaces/LoggingMiddlewareOptions.md) | Options for configuring logging middleware. |
| [MiddlewareContext](interfaces/MiddlewareContext.md) | Context provided to middleware for registering hooks. |

### Observability

| Interface | Description |
| :------ | :------ |
| [AgentMetrics](interfaces/AgentMetrics.md) | Pre-defined metrics for agent SDK. |
| [Counter](interfaces/Counter.md) | A counter metric that can only increase. |
| [EventExporterOptions](interfaces/EventExporterOptions.md) | Options for event exporters. |
| [Gauge](interfaces/Gauge.md) | A gauge metric that can go up and down. |
| [Histogram](interfaces/Histogram.md) | A histogram metric for measuring distributions. |
| [HistogramBucket](interfaces/HistogramBucket.md) | Histogram bucket definition. |
| [HistogramData](interfaces/HistogramData.md) | Histogram metric data. |
| [LogEntry](interfaces/LogEntry.md) | A structured log entry. |
| [LogFormatter](interfaces/LogFormatter.md) | A formatter converts log entries to strings. |
| [Logger](interfaces/Logger.md) | A structured logger interface. |
| [LoggerOptions](interfaces/LoggerOptions.md) | Options for creating a logger. |
| [LogTimer](interfaces/LogTimer.md) | A timer for measuring operation duration. |
| [LogTransport](interfaces/LogTransport.md) | A transport writes log entries to a destination. |
| [MetricPoint](interfaces/MetricPoint.md) | A single metric data point. |
| [MetricsExporter](interfaces/MetricsExporter.md) | A metrics exporter sends metrics to an external system. |
| [MetricsRegistry](interfaces/MetricsRegistry.md) | A registry for managing metrics. |
| [MetricsRegistryOptions](interfaces/MetricsRegistryOptions.md) | Options for creating a metrics registry. |
| [ObservabilityEventStore](interfaces/ObservabilityEventStore.md) | In-memory store for collecting observability events. |
| [ObservabilityEventStoreOptions](interfaces/ObservabilityEventStoreOptions.md) | Options for creating an observability event store. |
| [ObservabilityPreset](interfaces/ObservabilityPreset.md) | Result of creating an observability preset. |
| [ObservabilityPresetOptions](interfaces/ObservabilityPresetOptions.md) | Options for creating an observability preset. |
| [Span](interfaces/Span.md) | An active span that can be modified. |
| [SpanContext](interfaces/SpanContext.md) | Span context for propagation. |
| [SpanData](interfaces/SpanData.md) | A completed span data structure. |
| [SpanEvent](interfaces/SpanEvent.md) | Span event (point-in-time occurrence). |
| [SpanExporter](interfaces/SpanExporter.md) | A span exporter sends spans to a backend. |
| [SpanLink](interfaces/SpanLink.md) | Span link (reference to another span). |
| [SpanStatus](interfaces/SpanStatus.md) | Span status. |
| [StartSpanOptions](interfaces/StartSpanOptions.md) | Options for starting a span. |
| [StructuredEvent](interfaces/StructuredEvent.md) | Structured event for export with standardized fields. |
| [Tracer](interfaces/Tracer.md) | A tracer creates and manages spans. |
| [TracerOptions](interfaces/TracerOptions.md) | Options for creating a tracer. |

### Other

| Interface | Description |
| :------ | :------ |
| [GuardrailCheckResult](interfaces/GuardrailCheckResult.md) | Result from a guardrail check. |
| [OutputGuardrailConfig](interfaces/OutputGuardrailConfig.md) | Configuration for buffered output guardrails. |
| [QuestionOption](interfaces/QuestionOption.md) | An option for a multiple-choice question. |
| [RaceGuardrailsOptions](interfaces/RaceGuardrailsOptions.md) | Options for raceGuardrails. |
| [ToolExecutionOptions](interfaces/ToolExecutionOptions.md) | Additional options that are sent into each tool call. |
| [UIMessage](interfaces/UIMessage.md) | AI SDK UI Messages. They are used in the client and to communicate between the frontend and the API routes. |

### Presets

| Interface | Description |
| :------ | :------ |
| [ProductionAgentOptions](interfaces/ProductionAgentOptions.md) | Options for creating a production agent. |
| [ProductionAgentResult](interfaces/ProductionAgentResult.md) | Result of creating a production agent. |
| [SecureProductionAgentOptions](interfaces/SecureProductionAgentOptions.md) | Options for creating a secure production agent. |

### Security

| Interface | Description |
| :------ | :------ |
| [SecurityPolicy](interfaces/SecurityPolicy.md) | Security policy configuration that bundles sandbox, permission, and hook settings. |

### TaskStore

| Interface | Description |
| :------ | :------ |
| [BackgroundTask](interfaces/BackgroundTask.md) | Complete snapshot of a background task's state. |
| [BaseTaskStore](interfaces/BaseTaskStore.md) | Abstract storage interface for background tasks. |
| [KVStore](interfaces/KVStore.md) | Abstract key-value store interface. |
| [TaskStoreOptions](interfaces/TaskStoreOptions.md) | Options for creating a task store. |

## Type Aliases

### Agent

| Type Alias | Description |
| :------ | :------ |
| [GenerateResult](type-aliases/GenerateResult.md) | Result from a generation request. |
| [StreamPart](type-aliases/StreamPart.md) | A part from streaming generation. Aligns with AI SDK stream parts plus agent-specific events. |

### Tools

| Type Alias | Description |
| :------ | :------ |
| [OnTodosChanged](type-aliases/OnTodosChanged.md) | Callback type for todo change events. |
| [TodoChangeType](type-aliases/TodoChangeType.md) | Type of change that occurred to the todo list. |
| [ToolReference](type-aliases/ToolReference.md) | A reference to a tool that can be resolved to a tool name. |

### Plugins

| Type Alias | Description |
| :------ | :------ |
| [PluginLoadingMode](type-aliases/PluginLoadingMode.md) | Plugin loading mode. |

### Hooks

| Type Alias | Description |
| :------ | :------ |
| [AuditEventCategory](type-aliases/AuditEventCategory.md) | Audit event categories. |
| [AuditEventHandler](type-aliases/AuditEventHandler.md) | Audit event handler function. |
| [HookCallback](type-aliases/HookCallback.md) | Hook callback function signature. |
| [HookEvent](type-aliases/HookEvent.md) | Types of events that can trigger hooks. |
| [HookInput](type-aliases/HookInput.md) | Union type of all hook input types. |
| [PermissionDecision](type-aliases/PermissionDecision.md) | Permission decision for a tool or generation operation. |

### Subagents

| Type Alias | Description |
| :------ | :------ |
| [TaskStatus](type-aliases/TaskStatus.md) | Status of a background task. |

### Context

| Type Alias | Description |
| :------ | :------ |
| [CompactionStrategy](type-aliases/CompactionStrategy.md) | Compaction strategy type. |
| [CompactionTaskStatus](type-aliases/CompactionTaskStatus.md) | Status of a background compaction task. |
| [CompactionTrigger](type-aliases/CompactionTrigger.md) | Compaction trigger reason. |

### Types

| Type Alias | Description |
| :------ | :------ |
| [AgentUIMessage](type-aliases/AgentUIMessage.md) | Agent-specific UIMessage type with custom data types. |
| [CoreToolName](type-aliases/CoreToolName.md) | Core tool names that can be disabled. |
| [FinishReason](type-aliases/FinishReason.md) | Reason why the model finished generating. |
| [StreamingToolsFactory](type-aliases/StreamingToolsFactory.md) | Factory function for creating streaming-aware tools. |

### Backend

| Type Alias | Description |
| :------ | :------ |
| [BackendFactory](type-aliases/BackendFactory.md) | Factory function for creating backends lazily. |
| [RouteConfig](type-aliases/RouteConfig.md) | Configuration for routing paths to backends. |
| [TodoStatus](type-aliases/TodoStatus.md) | Status of a todo item. |

### Checkpointer

| Type Alias | Description |
| :------ | :------ |
| [CheckpointEvent](type-aliases/CheckpointEvent.md) | Union type of all checkpoint events. |

### Errors

| Type Alias | Description |
| :------ | :------ |
| [AgentErrorCode](type-aliases/AgentErrorCode.md) | Error codes for categorizing errors. |
| [ErrorSeverity](type-aliases/ErrorSeverity.md) | Severity levels for errors. |

### MCP

| Type Alias | Description |
| :------ | :------ |
| [MCPServerConfig](type-aliases/MCPServerConfig.md) | Union type for all MCP server configurations. |
| [MCPToolSource](type-aliases/MCPToolSource.md) | Source type for MCP tools. |

### Observability

| Type Alias | Description |
| :------ | :------ |
| [EventSeverity](type-aliases/EventSeverity.md) | Event severity levels for alerting. |
| [LogLevel](type-aliases/LogLevel.md) | Log levels in order of severity. |
| [MetricLabels](type-aliases/MetricLabels.md) | Labels/tags for metrics. |
| [MetricType](type-aliases/MetricType.md) | Metric types supported by the system. |
| [ObservabilityEvent](type-aliases/ObservabilityEvent.md) | Union type of all observability events. |
| [SpanAttributes](type-aliases/SpanAttributes.md) | Span attributes (key-value metadata). |
| [SpanKind](type-aliases/SpanKind.md) | Span kind (direction of the span). |
| [SpanStatusCode](type-aliases/SpanStatusCode.md) | Span status codes. |

### Other

| Type Alias | Description |
| :------ | :------ |
| [AskUserCallback](type-aliases/AskUserCallback.md) | Callback function to prompt the user for input. |
| [BufferedGuardrailState](type-aliases/BufferedGuardrailState.md) | State of the buffered output guardrail. |
| [Guardrail](type-aliases/Guardrail.md) | A guardrail is a function that checks content and returns a result. |
| [InterruptFunction](type-aliases/InterruptFunction.md) | Request an interrupt and wait for a response. |
| [LanguageModel](type-aliases/LanguageModel.md) | Language model that is used by the AI SDK. |
| [LanguageModelUsage](type-aliases/LanguageModelUsage.md) | Represents the number of tokens used in a prompt and completion. |
| [ModelMessage](type-aliases/ModelMessage.md) | A message that can be used in the `messages` field of a prompt. It can be a user message, an assistant message, or a tool message. |
| [Tool](type-aliases/Tool.md) | A tool contains the description and the schema of the input that the tool expects. This enables the language model to generate the input. |
| [ToolSet](type-aliases/ToolSet.md) | - |

### Permissions

| Type Alias | Description |
| :------ | :------ |
| [PermissionMode](type-aliases/PermissionMode.md) | Permission mode controlling default tool approval behavior. |

### Security

| Type Alias | Description |
| :------ | :------ |
| [SecurityPolicyPreset](type-aliases/SecurityPolicyPreset.md) | Preset names for common security levels. |

### TaskStore

| Type Alias | Description |
| :------ | :------ |
| [BackgroundTaskStatus](type-aliases/BackgroundTaskStatus.md) | Status of a background task. |

## Variables

### Hooks

#### COMMON\_SECRET\_PATTERNS

> `const` **COMMON\_SECRET\_PATTERNS**: \{ `API_KEY`: `RegExp`; `AWS_ACCESS_KEY`: `RegExp`; `AWS_SECRET_KEY`: `RegExp`; `BEARER_TOKEN`: `RegExp`; `GENERIC_SECRET`: `RegExp`; `GITHUB_OAUTH`: `RegExp`; `GITHUB_TOKEN`: `RegExp`; `JWT`: `RegExp`; `PASSWORD`: `RegExp`; `PRIVATE_KEY`: `RegExp`; `SLACK_TOKEN`: `RegExp`; `STRIPE_KEY`: `RegExp`; \}

Defined in: [packages/agent-sdk/src/hooks/secrets.ts:21](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/secrets.ts#L21)

Common secret patterns for automatic detection.

##### Type Declaration

###### API\_KEY

> **API\_KEY**: `RegExp`

Generic API keys (common formats)

###### AWS\_ACCESS\_KEY

> **AWS\_ACCESS\_KEY**: `RegExp`

AWS access keys (AKIA...)

###### AWS\_SECRET\_KEY

> **AWS\_SECRET\_KEY**: `RegExp`

AWS secret keys (40 chars base64)

###### BEARER\_TOKEN

> **BEARER\_TOKEN**: `RegExp`

Bearer tokens

###### GENERIC\_SECRET

> **GENERIC\_SECRET**: `RegExp`

Generic secrets in common formats

###### GITHUB\_OAUTH

> **GITHUB\_OAUTH**: `RegExp`

GitHub OAuth tokens

###### GITHUB\_TOKEN

> **GITHUB\_TOKEN**: `RegExp`

GitHub personal access tokens

###### JWT

> **JWT**: `RegExp`

JWT tokens

###### PASSWORD

> **PASSWORD**: `RegExp`

Generic passwords in common formats

###### PRIVATE\_KEY

> **PRIVATE\_KEY**: `RegExp`

Private keys (PEM format headers)

###### SLACK\_TOKEN

> **SLACK\_TOKEN**: `RegExp`

Slack tokens

###### STRIPE\_KEY

> **STRIPE\_KEY**: `RegExp`

Stripe API keys

### Observability

#### defaultLogger

> **defaultLogger**: [`Logger`](interfaces/Logger.md)

Defined in: [packages/agent-sdk/src/observability/logger.ts:675](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/logger.ts#L675)

The default global logger instance.

Can be used directly or replaced with a custom logger.

##### Example

```typescript
import { defaultLogger } from "@lleverage-ai/agent-sdk";

defaultLogger.info("Application started");
```

***

#### defaultMetricsRegistry

> **defaultMetricsRegistry**: [`MetricsRegistry`](interfaces/MetricsRegistry.md)

Defined in: [packages/agent-sdk/src/observability/metrics.ts:818](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L818)

The default global metrics registry.

***

#### defaultTracer

> **defaultTracer**: [`Tracer`](interfaces/Tracer.md)

Defined in: [packages/agent-sdk/src/observability/tracing.ts:812](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L812)

The default global tracer instance.

***

#### SemanticAttributes

> `const` **SemanticAttributes**: \{ `AGENT_ID`: `"agent.id"`; `AGENT_NAME`: `"agent.name"`; `AGENT_STEP`: `"agent.step"`; `AGENT_TOOLS`: `"agent.tools"`; `EXCEPTION_MESSAGE`: `"exception.message"`; `EXCEPTION_STACKTRACE`: `"exception.stacktrace"`; `EXCEPTION_TYPE`: `"exception.type"`; `GEN_AI_REQUEST_MAX_TOKENS`: `"gen_ai.request.max_tokens"`; `GEN_AI_REQUEST_MODEL`: `"gen_ai.request.model"`; `GEN_AI_REQUEST_TEMPERATURE`: `"gen_ai.request.temperature"`; `GEN_AI_RESPONSE_FINISH_REASONS`: `"gen_ai.response.finish_reasons"`; `GEN_AI_RESPONSE_MODEL`: `"gen_ai.response.model"`; `GEN_AI_SYSTEM`: `"gen_ai.system"`; `GEN_AI_USAGE_INPUT_TOKENS`: `"gen_ai.usage.input_tokens"`; `GEN_AI_USAGE_OUTPUT_TOKENS`: `"gen_ai.usage.output_tokens"`; `GEN_AI_USAGE_TOTAL_TOKENS`: `"gen_ai.usage.total_tokens"`; `SERVICE_NAME`: `"service.name"`; `SERVICE_VERSION`: `"service.version"`; `SUBAGENT_ID`: `"subagent.id"`; `SUBAGENT_PROMPT`: `"subagent.prompt"`; `SUBAGENT_TYPE`: `"subagent.type"`; `TOOL_INPUT`: `"tool.input"`; `TOOL_NAME`: `"tool.name"`; `TOOL_OUTPUT`: `"tool.output"`; \}

Defined in: [packages/agent-sdk/src/observability/tracing.ts:836](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/tracing.ts#L836)

Semantic attribute keys for AI/LLM operations.

Based on emerging OpenTelemetry semantic conventions for GenAI.

##### Type Declaration

###### AGENT\_ID

> `readonly` **AGENT\_ID**: `"agent.id"` = `"agent.id"`

###### AGENT\_NAME

> `readonly` **AGENT\_NAME**: `"agent.name"` = `"agent.name"`

###### AGENT\_STEP

> `readonly` **AGENT\_STEP**: `"agent.step"` = `"agent.step"`

###### AGENT\_TOOLS

> `readonly` **AGENT\_TOOLS**: `"agent.tools"` = `"agent.tools"`

###### EXCEPTION\_MESSAGE

> `readonly` **EXCEPTION\_MESSAGE**: `"exception.message"` = `"exception.message"`

###### EXCEPTION\_STACKTRACE

> `readonly` **EXCEPTION\_STACKTRACE**: `"exception.stacktrace"` = `"exception.stacktrace"`

###### EXCEPTION\_TYPE

> `readonly` **EXCEPTION\_TYPE**: `"exception.type"` = `"exception.type"`

###### GEN\_AI\_REQUEST\_MAX\_TOKENS

> `readonly` **GEN\_AI\_REQUEST\_MAX\_TOKENS**: `"gen_ai.request.max_tokens"` = `"gen_ai.request.max_tokens"`

###### GEN\_AI\_REQUEST\_MODEL

> `readonly` **GEN\_AI\_REQUEST\_MODEL**: `"gen_ai.request.model"` = `"gen_ai.request.model"`

###### GEN\_AI\_REQUEST\_TEMPERATURE

> `readonly` **GEN\_AI\_REQUEST\_TEMPERATURE**: `"gen_ai.request.temperature"` = `"gen_ai.request.temperature"`

###### GEN\_AI\_RESPONSE\_FINISH\_REASONS

> `readonly` **GEN\_AI\_RESPONSE\_FINISH\_REASONS**: `"gen_ai.response.finish_reasons"` = `"gen_ai.response.finish_reasons"`

###### GEN\_AI\_RESPONSE\_MODEL

> `readonly` **GEN\_AI\_RESPONSE\_MODEL**: `"gen_ai.response.model"` = `"gen_ai.response.model"`

###### GEN\_AI\_SYSTEM

> `readonly` **GEN\_AI\_SYSTEM**: `"gen_ai.system"` = `"gen_ai.system"`

###### GEN\_AI\_USAGE\_INPUT\_TOKENS

> `readonly` **GEN\_AI\_USAGE\_INPUT\_TOKENS**: `"gen_ai.usage.input_tokens"` = `"gen_ai.usage.input_tokens"`

###### GEN\_AI\_USAGE\_OUTPUT\_TOKENS

> `readonly` **GEN\_AI\_USAGE\_OUTPUT\_TOKENS**: `"gen_ai.usage.output_tokens"` = `"gen_ai.usage.output_tokens"`

###### GEN\_AI\_USAGE\_TOTAL\_TOKENS

> `readonly` **GEN\_AI\_USAGE\_TOTAL\_TOKENS**: `"gen_ai.usage.total_tokens"` = `"gen_ai.usage.total_tokens"`

###### SERVICE\_NAME

> `readonly` **SERVICE\_NAME**: `"service.name"` = `"service.name"`

###### SERVICE\_VERSION

> `readonly` **SERVICE\_VERSION**: `"service.version"` = `"service.version"`

###### SUBAGENT\_ID

> `readonly` **SUBAGENT\_ID**: `"subagent.id"` = `"subagent.id"`

###### SUBAGENT\_PROMPT

> `readonly` **SUBAGENT\_PROMPT**: `"subagent.prompt"` = `"subagent.prompt"`

###### SUBAGENT\_TYPE

> `readonly` **SUBAGENT\_TYPE**: `"subagent.type"` = `"subagent.type"`

###### TOOL\_INPUT

> `readonly` **TOOL\_INPUT**: `"tool.input"` = `"tool.input"`

###### TOOL\_NAME

> `readonly` **TOOL\_NAME**: `"tool.name"` = `"tool.name"`

###### TOOL\_OUTPUT

> `readonly` **TOOL\_OUTPUT**: `"tool.output"` = `"tool.output"`

### Other

#### DEFAULT\_LATENCY\_BUCKETS

> `const` **DEFAULT\_LATENCY\_BUCKETS**: `number`[]

Defined in: [packages/agent-sdk/src/observability/metrics.ts:193](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L193)

Default histogram buckets (latency in ms).

***

#### DEFAULT\_TOKEN\_BUCKETS

> `const` **DEFAULT\_TOKEN\_BUCKETS**: `number`[]

Defined in: [packages/agent-sdk/src/observability/metrics.ts:200](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/observability/metrics.ts#L200)

Default histogram buckets for token counts.

### Presets

#### DEFAULT\_BLOCKED\_INPUT\_PATTERNS

> `const` **DEFAULT\_BLOCKED\_INPUT\_PATTERNS**: `RegExp`[]

Defined in: [packages/agent-sdk/src/presets/production.ts:296](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L296)

Default blocked input patterns for secure production mode.

These patterns help prevent common prompt injection and jailbreak attempts.

***

#### DEFAULT\_BLOCKED\_OUTPUT\_PATTERNS

> `const` **DEFAULT\_BLOCKED\_OUTPUT\_PATTERNS**: `RegExp`[]

Defined in: [packages/agent-sdk/src/presets/production.ts:315](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/presets/production.ts#L315)

Default blocked output patterns for secure production mode.

These patterns help prevent accidental credential/PII leakage.

## Functions

### Agent

| Function | Description |
| :------ | :------ |
| [createAgent](functions/createAgent.md) | Creates a new agent instance with the specified configuration. |
| [isCompleteResult](functions/isCompleteResult.md) | Type guard to check if a generation result is complete. |
| [isInterruptedResult](functions/isInterruptedResult.md) | Type guard to check if a generation result is interrupted. |

### Tools

| Function | Description |
| :------ | :------ |
| [createAskUserQuestionTool](functions/createAskUserQuestionTool.md) | Creates a tool for asking the user clarifying questions. |
| [createBashTool](functions/createBashTool.md) | Creates a tool for executing shell commands in a sandbox. |
| [createCoreTools](functions/createCoreTools.md) | Creates all core tools from configuration. |
| [createEditTool](functions/createEditTool.md) | Creates a tool for editing files via string replacement. |
| [createFilesystemTools](functions/createFilesystemTools.md) | Creates all filesystem tools from a backend. |
| [createFilesystemToolsOnly](functions/createFilesystemToolsOnly.md) | Creates filesystem tools only. |
| [createGlobTool](functions/createGlobTool.md) | Creates a tool for finding files matching glob patterns. |
| [createGrepTool](functions/createGrepTool.md) | Creates a tool for searching file contents with regex. |
| [createReadTool](functions/createReadTool.md) | Creates a tool for reading file contents. |
| [createSearchToolsTool](functions/createSearchToolsTool.md) | Creates the search_tools meta-tool for discovering MCP tools. |
| [createSkillRegistry](functions/createSkillRegistry.md) | Creates a new skill registry with the given skills. |
| [createSkillTool](functions/createSkillTool.md) | Creates a tool that allows agents to load skills on-demand. |
| [createTodoWriteTool](functions/createTodoWriteTool.md) | Creates the todo_write tool for managing task lists. |
| [createToolRegistry](functions/createToolRegistry.md) | Creates a new tool registry. |
| [createUseToolsTool](functions/createUseToolsTool.md) | Creates the use_tools meta-tool for discovering and loading tools. |
| [createWriteTool](functions/createWriteTool.md) | Creates a tool for writing/creating files. |
| [defineLoadableSkill](functions/defineLoadableSkill.md) | Creates a skill definition. |
| [defineSkill](functions/defineSkill.md) | Creates a skill definition for providing contextual instructions to agents. |
| [mcpTools](functions/mcpTools.md) | Creates a helper for generating MCP tool names for a specific plugin. |
| [mcpToolsFor](functions/mcpToolsFor.md) | Creates a helper for a specific MCP plugin with known tools. |
| [toolsFrom](functions/toolsFrom.md) | Extracts tool names from various sources. |
| [toolsFromPlugin](functions/toolsFromPlugin.md) | Extracts tool names from a plugin. |

### Plugins

| Function | Description |
| :------ | :------ |
| [definePlugin](functions/definePlugin.md) | Creates a plugin that extends agent functionality. |

### Hooks

| Function | Description |
| :------ | :------ |
| [aggregatePermissionDecisions](functions/aggregatePermissionDecisions.md) | Aggregates permission decisions from multiple hook outputs. |
| [createAuditHooks](functions/createAuditHooks.md) | Creates audit hooks for all lifecycle events. |
| [createCacheHooks](functions/createCacheHooks.md) | Creates cache hooks for PreGenerate and PostGenerate events. |
| [createComprehensiveLoggingHooks](functions/createComprehensiveLoggingHooks.md) | Creates comprehensive logging hooks for all lifecycle events. |
| [createGenerationLoggingHooks](functions/createGenerationLoggingHooks.md) | Creates logging hooks for generation lifecycle events. |
| [createGuardrailsHooks](functions/createGuardrailsHooks.md) | Creates guardrails hooks for input and output content filtering. |
| [createInMemoryAuditStore](functions/createInMemoryAuditStore.md) | Creates an in-memory audit event store. |
| [createManagedCacheHooks](functions/createManagedCacheHooks.md) | Creates managed cache hooks with programmatic cache control. |
| [createManagedGuardrailsHooks](functions/createManagedGuardrailsHooks.md) | Creates guardrails hooks with statistics tracking. |
| [createManagedRateLimitHooks](functions/createManagedRateLimitHooks.md) | Creates managed rate limit hooks with programmatic control. |
| [createManagedRetryHooks](functions/createManagedRetryHooks.md) | Creates a retry hook with custom statistics tracking. |
| [createManagedSecretsFilterHooks](functions/createManagedSecretsFilterHooks.md) | Creates managed secrets filter hooks with detection statistics. |
| [createRateLimitHooks](functions/createRateLimitHooks.md) | Creates rate limiting hooks for PreGenerate and PostGenerate events. |
| [createRetryHooks](functions/createRetryHooks.md) | Creates a retry hook for PostGenerateFailure events. |
| [createSecretsFilterHooks](functions/createSecretsFilterHooks.md) | Creates secrets filtering hooks for input and output. |
| [createToolLoggingHooks](functions/createToolLoggingHooks.md) | Creates logging hooks for tool execution events. |
| [exportAuditEventsJSONLines](functions/exportAuditEventsJSONLines.md) | Export audit events to JSON Lines format. |
| [extractRespondWith](functions/extractRespondWith.md) | Extracts a cached/mock result from hook outputs for short-circuit execution. |
| [extractRetryDecision](functions/extractRetryDecision.md) | Extracts retry decision from PostGenerateFailure or PostToolUseFailure hook outputs. |

### Subagents

| Function | Description |
| :------ | :------ |
| [cleanupStaleTasks](functions/cleanupStaleTasks.md) | Clean up stale tasks from the task store. |
| [clearCompletedTasks](functions/clearCompletedTasks.md) | Clear completed/failed background tasks. |
| [createSubagent](functions/createSubagent.md) | Creates a subagent that inherits configuration from a parent agent. |
| [createSubagentContext](functions/createSubagentContext.md) | Creates an isolated context for subagent execution. |
| [createSubagentEventEmitter](functions/createSubagentEventEmitter.md) | Creates an event emitter for subagent lifecycle events. |
| [createTaskTool](functions/createTaskTool.md) | Creates the task tool for delegating work to specialized subagents. |
| [executeSubagent](functions/executeSubagent.md) | Executes a subagent with isolated context. |
| [executeSubagentsParallel](functions/executeSubagentsParallel.md) | Executes multiple subagents in parallel. |
| [getBackgroundTask](functions/getBackgroundTask.md) | Get a background task by ID. |
| [listBackgroundTasks](functions/listBackgroundTasks.md) | List all background tasks. |
| [mergeSubagentContext](functions/mergeSubagentContext.md) | Merges subagent context changes back to parent. |
| [recoverFailedTasks](functions/recoverFailedTasks.md) | Recover failed tasks for retry. |
| [recoverRunningTasks](functions/recoverRunningTasks.md) | Recover running tasks on agent restart. |

### Context

| Function | Description |
| :------ | :------ |
| [createContext](functions/createContext.md) | Creates a new context for managing state during agent execution. |

### Backend

| Function | Description |
| :------ | :------ |
| [createAgentState](functions/createAgentState.md) | Create a new empty AgentState. |
| [createCompositeBackend](functions/createCompositeBackend.md) | Create a CompositeBackend from options. |
| [createFilesystemBackend](functions/createFilesystemBackend.md) | Create a FilesystemBackend with the specified options. |
| [createLocalSandbox](functions/createLocalSandbox.md) | Create a LocalSandbox with the specified options. |
| [createPersistentBackend](functions/createPersistentBackend.md) | Create a new PersistentBackend. |
| [createStateBackend](functions/createStateBackend.md) | Create a StateBackend factory function. |
| [isBackend](functions/isBackend.md) | Check if a value implements the BackendProtocol interface. |
| [isSandboxBackend](functions/isSandboxBackend.md) | Check if a value implements the SandboxBackendProtocol interface. |

### Checkpointer

| Function | Description |
| :------ | :------ |
| [createApprovalInterrupt](functions/createApprovalInterrupt.md) | Create an approval interrupt for a tool call. |
| [createCheckpoint](functions/createCheckpoint.md) | Create a new checkpoint with the given data. |
| [createFileSaver](functions/createFileSaver.md) | Create a new FileSaver instance. |
| [createInterrupt](functions/createInterrupt.md) | Create a new interrupt with the given data. |
| [createKeyValueStoreSaver](functions/createKeyValueStoreSaver.md) | Create a new KeyValueStoreSaver instance. |
| [createMemorySaver](functions/createMemorySaver.md) | Create a new MemorySaver instance. |
| [isApprovalInterrupt](functions/isApprovalInterrupt.md) | Type guard to check if an interrupt is an ApprovalInterrupt. |
| [isCheckpoint](functions/isCheckpoint.md) | Type guard to check if an object is a valid Checkpoint. |
| [isInterrupt](functions/isInterrupt.md) | Type guard to check if an object is a valid Interrupt. |
| [updateCheckpoint](functions/updateCheckpoint.md) | Update an existing checkpoint with new data. |

### Errors

| Function | Description |
| :------ | :------ |
| [createCircuitBreaker](functions/createCircuitBreaker.md) | Create a circuit breaker for error protection. |
| [createErrorHandler](functions/createErrorHandler.md) | Create an error handler that catches and transforms errors. |
| [formatErrorForLogging](functions/formatErrorForLogging.md) | Format an error for logging. |
| [getUserMessage](functions/getUserMessage.md) | Get a user-friendly error message from any error. |
| [isRetryable](functions/isRetryable.md) | Check if an error is retryable. |
| [tryOperations](functions/tryOperations.md) | Execute multiple operations until one succeeds. |
| [withFallback](functions/withFallback.md) | Execute an operation with a fallback value on error. |
| [withFallbackFn](functions/withFallbackFn.md) | Execute an operation with a fallback function on error. |
| [wrapError](functions/wrapError.md) | Wrap any error as an AgentError. |

### MCP

| Function | Description |
| :------ | :------ |
| [expandEnvVars](functions/expandEnvVars.md) | Expands environment variables in a string using ${VAR} syntax. |

### Memory

| Function | Description |
| :------ | :------ |
| [buildMemorySection](functions/buildMemorySection.md) | Build a formatted memory section for injection into prompts. |
| [buildPathMemoryContext](functions/buildPathMemoryContext.md) | Build memory context filtered by current file path. |
| [computeContentHash](functions/computeContentHash.md) | Compute SHA-256 hash of a string. |
| [computeFileHash](functions/computeFileHash.md) | Compute content hash from a file path. |
| [createFilesystemMemoryStore](functions/createFilesystemMemoryStore.md) | Create a new FilesystemMemoryStore. |
| [createInMemoryMemoryStore](functions/createInMemoryMemoryStore.md) | Create a new InMemoryMemoryStore. |
| [createInMemoryPermissionStore](functions/createInMemoryPermissionStore.md) | Create a new InMemoryPermissionStore. |
| [createMemoryPermissionStore](functions/createMemoryPermissionStore.md) | Create a new FileMemoryPermissionStore. |
| [filterAdditionalFilesByPath](functions/filterAdditionalFilesByPath.md) | Filter additional memory files by path relevance. |
| [filterAutoLoadAdditionalFiles](functions/filterAutoLoadAdditionalFiles.md) | Filter additional files by auto-load setting. |
| [filterAutoLoadMemories](functions/filterAutoLoadMemories.md) | Filter memory documents by auto-load setting. |
| [filterMemoriesByAllTags](functions/filterMemoriesByAllTags.md) | Filter memory documents by all required tags. |
| [filterMemoriesByPath](functions/filterMemoriesByPath.md) | Filter memory documents by path relevance. |
| [filterMemoriesByTags](functions/filterMemoriesByTags.md) | Filter memory documents by tags. |
| [findGitRoot](functions/findGitRoot.md) | Find the git root directory from a given path. |
| [getProjectMemoryPath](functions/getProjectMemoryPath.md) | Get the project memory path based on git root. |
| [getUserAgentDir](functions/getUserAgentDir.md) | Get the user agent directory for an agent. |
| [getUserMemoryPath](functions/getUserMemoryPath.md) | Get the user memory path for an agent. |
| [loadAdditionalMemoryFiles](functions/loadAdditionalMemoryFiles.md) | Load all additional memory files from a directory. |
| [loadAgentMemory](functions/loadAgentMemory.md) | Load a single agent memory file. |
| [loadAllMemory](functions/loadAllMemory.md) | Load all agent memory (user, project, and additional files). |
| [matchesAnyPathPattern](functions/matchesAnyPathPattern.md) | Check if a file path matches any of the given patterns. |
| [matchesPathPattern](functions/matchesPathPattern.md) | Check if a file path matches a glob pattern. |
| [parseMarkdownWithFrontmatter](functions/parseMarkdownWithFrontmatter.md) | Parse YAML frontmatter from a markdown string. |
| [serializeMarkdownWithFrontmatter](functions/serializeMarkdownWithFrontmatter.md) | Serialize metadata and content back to markdown with frontmatter. |

### Middleware

| Function | Description |
| :------ | :------ |
| [applyMiddleware](functions/applyMiddleware.md) | Applies an array of middleware and returns the combined HookRegistration. |
| [createLoggingMiddleware](functions/createLoggingMiddleware.md) | Creates logging middleware that logs agent lifecycle events. |
| [mergeHooks](functions/mergeHooks.md) | Merges multiple HookRegistration objects into one. |
| [setupMiddleware](functions/setupMiddleware.md) | Calls setup on all middleware that have a setup method. |
| [teardownMiddleware](functions/teardownMiddleware.md) | Calls teardown on all middleware that have a teardown method. |

### Observability

| Function | Description |
| :------ | :------ |
| [createAgentMetrics](functions/createAgentMetrics.md) | Creates pre-defined agent metrics. |
| [createCallbackMetricsExporter](functions/createCallbackMetricsExporter.md) | Creates a callback exporter that invokes a function for each export. |
| [createCallbackSpanExporter](functions/createCallbackSpanExporter.md) | Creates a callback exporter that invokes a function for each batch. |
| [createCallbackTransport](functions/createCallbackTransport.md) | Creates a callback transport that invokes a function for each entry. |
| [createConsoleMetricsExporter](functions/createConsoleMetricsExporter.md) | Creates a console exporter for debugging. |
| [createConsoleSpanExporter](functions/createConsoleSpanExporter.md) | Creates a console exporter for debugging. |
| [createConsoleTransport](functions/createConsoleTransport.md) | Creates a console transport. |
| [createFilteredTransport](functions/createFilteredTransport.md) | Creates a filtered transport that only passes entries matching criteria. |
| [createJsonFormatter](functions/createJsonFormatter.md) | Creates a JSON formatter for structured logging. |
| [createLogger](functions/createLogger.md) | Creates a structured logger. |
| [createMemoryMetricsExporter](functions/createMemoryMetricsExporter.md) | Creates a memory exporter that stores metrics. |
| [createMemorySpanExporter](functions/createMemorySpanExporter.md) | Creates a memory exporter that stores spans. |
| [createMemoryTransport](functions/createMemoryTransport.md) | Creates a memory transport that stores log entries. |
| [createMetricsRegistry](functions/createMetricsRegistry.md) | Creates a metrics registry. |
| [createObservabilityEventHooks](functions/createObservabilityEventHooks.md) | Create hooks for collecting observability events. |
| [createObservabilityEventStore](functions/createObservabilityEventStore.md) | Create an in-memory observability event store. |
| [createObservabilityPreset](functions/createObservabilityPreset.md) | Creates a complete observability setup with logger, metrics, tracer, and hooks. |
| [createOTLPSpanExporter](functions/createOTLPSpanExporter.md) | Creates an OTLP-compatible exporter (OpenTelemetry Protocol). |
| [createPrettyFormatter](functions/createPrettyFormatter.md) | Creates a human-readable formatter with colors. |
| [createTracer](functions/createTracer.md) | Creates a tracer for distributed tracing. |
| [exportEventsJSONLines](functions/exportEventsJSONLines.md) | Export events as JSON Lines format for log aggregation tools. |
| [exportEventsPrometheus](functions/exportEventsPrometheus.md) | Export events in a format suitable for Prometheus/OpenMetrics. |
| [setDefaultLogger](functions/setDefaultLogger.md) | Sets the default global logger. |
| [setDefaultMetricsRegistry](functions/setDefaultMetricsRegistry.md) | Sets the default global metrics registry. |
| [setDefaultTracer](functions/setDefaultTracer.md) | Sets the default global tracer. |
| [toStructuredEvent](functions/toStructuredEvent.md) | Convert an observability event to a structured event. |

### Other

| Function | Description |
| :------ | :------ |
| [createBufferedOutputGuardrail](functions/createBufferedOutputGuardrail.md) | Creates a buffered output guardrail. |
| [createRegexGuardrail](functions/createRegexGuardrail.md) | Create a regex-based guardrail. |
| [extractTextFromMessages](functions/extractTextFromMessages.md) | Extract text content from UI messages. |
| [findLastUserMessageId](functions/findLastUserMessageId.md) | Find the last user message ID from a list of messages. |
| [raceGuardrails](functions/raceGuardrails.md) | Race multiple guardrails - first failure blocks, all run in parallel. |
| [runWithGuardrails](functions/runWithGuardrails.md) | Run guardrails in parallel with generation, aborting on first failure. |
| [withTimeout](functions/withTimeout.md) | Create a guardrail with a timeout. |
| [wrapStreamWithOutputGuardrail](functions/wrapStreamWithOutputGuardrail.md) | Wraps a ReadableStream with buffered output guardrails. |

### Presets

| Function | Description |
| :------ | :------ |
| [createProductionAgent](functions/createProductionAgent.md) | Creates a production-ready agent with security, observability, and recommended hooks. |
| [createSecureProductionAgent](functions/createSecureProductionAgent.md) | Creates a secure production-ready agent with all security features enabled by default. |

### Security

| Function | Description |
| :------ | :------ |
| [applySecurityPolicy](functions/applySecurityPolicy.md) | Apply a security policy preset to agent options. |

### TaskStore

| Function | Description |
| :------ | :------ |
| [createBackgroundTask](functions/createBackgroundTask.md) | Create a new background task with the given data. |
| [isBackgroundTask](functions/isBackgroundTask.md) | Type guard to check if an object is a valid BackgroundTask. |
| [shouldExpireTask](functions/shouldExpireTask.md) | Check if a task should be expired based on age and status. |
| [updateBackgroundTask](functions/updateBackgroundTask.md) | Update an existing task with new data. |
