/**
 * @lleverage-ai/agent-sdk - A TypeScript framework for building AI agents.
 *
 * Built on top of Vercel AI SDK, this library provides a comprehensive toolkit
 * for creating intelligent agents that can use tools, respond to hooks, and
 * delegate tasks to specialized subagents.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createAgent } from "@lleverage-ai/agent-sdk";
 * import { anthropic } from "@ai-sdk/anthropic";
 * import { tool } from "ai";
 * import { z } from "zod";
 *
 * // Create an agent with tools
 * const agent = createAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   systemPrompt: "You are a friendly assistant.",
 *   tools: {
 *     greet: tool({
 *       description: "Greet a person by name",
 *       inputSchema: z.object({ name: z.string() }),
 *       execute: async ({ name }) => `Hello, ${name}!`,
 *     }),
 *   },
 * });
 *
 * // Generate a response
 * const result = await agent.generate({
 *   prompt: "Say hello to Alice",
 * });
 *
 * // Or use with Next.js API routes and useChat
 * export async function POST(req: Request) {
 *   const { messages } = await req.json();
 *   return agent.streamResponse({ messages });
 * }
 * ```
 *
 * ## Key Concepts
 *
 * - **Agents** - The main abstraction combining a model with tools and plugins
 * - **Tools** - Use AI SDK's `tool()` function directly for full compatibility
 * - **Plugins** - Bundles of tools, skills, and hooks for reusability
 * - **Skills** - User-invocable slash commands
 * - **Hooks** - Lifecycle event handlers for observing agent behavior
 * - **Subagents** - Specialized agents for task delegation
 *
 * ## AI SDK Compatibility
 *
 * This SDK is built on Vercel AI SDK and maintains full compatibility:
 * - Use `tool()` from 'ai' to define tools
 * - Use `CoreMessage` and `UIMessage` types directly
 * - `streamResponse()` returns a Response compatible with `useChat`
 * - `streamRaw()` returns the raw AI SDK `streamText` result
 *
 * @packageDocumentation
 */

// Core agent
export { createAgent } from "./agent.js";
// Session (event-driven agent interactions)
export { AgentSession, createAgentSession } from "./session.js";
export type { AgentSessionOptions, SessionEvent, SessionOutput } from "./session.js";
// Backend types
export type {
  BackendProtocol,
  EditResult,
  ExecutableBackend,
  ExecuteResponse,
  FileData,
  FileInfo,
  FileUploadResponse,
  GrepMatch,
  WriteResult,
} from "./backend.js";
// Backend
export { hasExecuteCapability, isBackend } from "./backend.js";
export type {
  AgentState,
  CompositeBackendOptions,
  FilesystemBackendOptions,
  KeyValueStore,
  PersistentBackendOptions,
  RouteConfig,
  TodoItem,
  TodoStatus,
} from "./backends/index.js";
export {
  CommandBlockedError,
  CommandTimeoutError,
  CompositeBackend,
  createAgentState,
  createCompositeBackend,
  createFilesystemBackend,
  createPersistentBackend,
  createStateBackend,
  DANGEROUS_COMMAND_PATTERNS,
  FileSizeLimitError,
  FilesystemBackend,
  InMemoryStore,
  PathTraversalError,
  PersistentBackend,
  StateBackend,
  SymlinkError,
} from "./backends/index.js";
// Checkpointer types
export type {
  ApprovalInterrupt,
  ApprovalRequest,
  ApprovalResponse,
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointEvent,
  CheckpointLoadedEvent,
  CheckpointSavedEvent,
  CheckpointSaverOptions,
  FileSaverOptions,
  // New interrupt types
  Interrupt,
  KeyValueStoreSaverOptions,
  MemorySaverOptions,
} from "./checkpointer/index.js";
// Checkpointer System
export {
  createApprovalInterrupt,
  // Types and helpers
  createCheckpoint,
  createFileSaver,
  createInterrupt,
  createKeyValueStoreSaver,
  createMemorySaver,
  // File Saver
  FileSaver,
  isApprovalInterrupt,
  isCheckpoint,
  isInterrupt,
  // KeyValueStore Saver
  KeyValueStoreSaver,
  // Memory Saver
  MemorySaver,
  updateCheckpoint,
} from "./checkpointer/index.js";
// Context
export { createContext } from "./context.js";
// Context Manager types
export type {
  CompactionPolicy,
  CompactionResult,
  CompactionScheduler,
  CompactionSchedulerOptions,
  CompactionStrategy,
  CompactionTask,
  CompactionTaskStatus,
  CompactionTrigger,
  ContextManager,
  ContextManagerOptions,
  CustomTokenCounterOptions,
  PinnedMessageMetadata,
  StructuredSummary,
  SummarizationConfig,
  TokenBudget,
  TokenCounter,
} from "./context-manager.js";

// Error types
export type {
  AgentErrorCode,
  ErrorSeverity,
  FallbackOptions,
  WrapErrorOptions,
} from "./errors/index.js";
// Error Handling System
export {
  AbortError,
  // Base error class
  AgentError,
  AuthenticationError,
  AuthorizationError,
  BackendError,
  CheckpointError,
  // Specific error classes
  ConfigurationError,
  ContextError,
  createCircuitBreaker,
  createErrorHandler,
  formatErrorForLogging,
  GeneratePermissionDeniedError,
  getUserMessage,
  isRetryable,
  MemoryError,
  ModelError,
  NetworkError,
  RateLimitError,
  SubagentError,
  TimeoutError,
  ToolExecutionError,
  ToolPermissionDeniedError,
  tryOperations,
  ValidationError,
  // Graceful degradation
  withFallback,
  withFallbackFn,
  // Utilities
  wrapError,
} from "./errors/index.js";
// Hook Utilities types
export type {
  AuditEvent,
  // Audit types
  AuditEventCategory,
  AuditEventHandler,
  AuditHooksOptions,
  BufferedGuardrailState,
  CacheEntry as CacheEntryHook,
  CacheHooksOptions,
  // Cache types
  CacheStore as CacheStoreHook,
  // Composable guardrails types
  Guardrail,
  GuardrailCheckResult,
  // Guardrails types
  GuardrailsHooksOptions,
  // Logging types
  LoggingHooksOptions as GenerationLoggingHooksOptions,
  // Buffered output guardrails types
  OutputGuardrailConfig,
  RaceGuardrailsOptions,
  // Rate limit types
  RateLimitHooksOptions,
  // Retry types
  RetryHooksOptions,
  // Secrets types
  SecretsFilterHooksOptions,
  ServerRateLimitInfo,
} from "./hooks/index.js";
// Hook Utilities (factories for common patterns)
export {
  BufferedOutputGuardrail,
  COMMON_SECRET_PATTERNS,
  // Audit hooks
  createAuditHooks,
  // Buffered output guardrails
  createBufferedOutputGuardrail,
  // Cache hooks
  createCacheHooks,
  createComprehensiveLoggingHooks,
  // Guardrails hooks
  createGuardrailsHooks,
  createInMemoryAuditStore,
  // Logging hooks
  createLoggingHooks as createGenerationLoggingHooks,
  createManagedCacheHooks,
  createManagedGuardrailsHooks,
  createManagedRateLimitHooks,
  createManagedRetryHooks,
  createManagedSecretsFilterHooks,
  // Rate limit hooks
  createRateLimitHooks,
  createRegexGuardrail,
  // Retry hooks
  createRetryHooks,
  // Secrets filter hooks
  createSecretsFilterHooks,
  createToolLoggingHooks,
  exportAuditEventsJSONLines,
  extractTextFromMessages,
  findLastUserMessageId,
  InMemoryCacheStore as InMemoryCacheStoreHook,
  // Composable guardrails (race pattern)
  raceGuardrails,
  runWithGuardrails,
  TokenBucketRateLimiter,
  withTimeout,
  wrapStreamWithOutputGuardrail,
} from "./hooks/index.js";
// Hooks
export {
  aggregatePermissionDecisions,
  createToolHook,
  extractRespondWith,
  extractRetryDecision,
  extractUpdatedInput,
  extractUpdatedResult,
  HookTimeoutError,
  invokeCustomHook,
  invokeHooksWithTimeout,
  invokeMatchingHooks,
  matchesToolName,
} from "./hooks.js";
// MCP types
export type {
  MCPManagerOptions,
  MCPToolLoadResult,
  MCPToolMetadata,
  MCPToolSource,
} from "./mcp/index.js";

// MCP (Model Context Protocol)
export {
  expandEnvVars,
  isSchemaEmpty,
  MCPInputValidationError,
  MCPInputValidator,
  MCPManager,
  VirtualMCPServer,
} from "./mcp/index.js";
// Prompt Builder types
export type { PromptComponent, PromptContext } from "./prompt-builder/index.js";
// Prompt Builder System
export { PromptBuilder } from "./prompt-builder/index.js";
export {
  capabilitiesComponent,
  contextComponent,
  createDefaultPromptBuilder,
  identityComponent,
  permissionModeComponent,
  pluginsComponent,
  skillsComponent,
  toolsComponent,
} from "./prompt-builder/components.js";
// Memory types
export type {
  AdditionalMemoryFile,
  BuildMemorySectionOptions,
  BuildPathMemoryContextOptions,
  FileMemoryPermissionStoreOptions,
  FilesystemMemoryStoreOptions,
  LoadAdditionalMemoryOptions,
  LoadAgentMemoryOptions,
  LoadAllMemoryOptions,
  LoadAllMemoryResult,
  MemoryApproval,
  MemoryAuditEvent,
  MemoryDocument,
  MemoryMetadata,
  MemoryPermissionStore,
  MemoryStore,
  ParsedMarkdown,
  PathMemoryContext,
} from "./memory/index.js";
// Memory System
export {
  buildMemorySection,
  buildPathMemoryContext,
  computeContentHash,
  computeFileHash,
  createFilesystemMemoryStore,
  createInMemoryMemoryStore,
  createInMemoryPermissionStore,
  createMemoryPermissionStore,
  // Permission store
  FileMemoryPermissionStore,
  // Filesystem store
  FilesystemMemoryStore,
  filterAdditionalFilesByPath,
  filterAutoLoadAdditionalFiles,
  filterAutoLoadMemories,
  filterMemoriesByAllTags,
  filterMemoriesByPath,
  filterMemoriesByTags,
  findGitRoot,
  getProjectMemoryPath,
  getUserAgentDir,
  getUserMemoryPath,
  InMemoryMemoryStore,
  InMemoryPermissionStore,
  loadAdditionalMemoryFiles,
  // Loading functions
  loadAgentMemory,
  loadAllMemory,
  matchesAnyPathPattern,
  // Path-based rules
  matchesPathPattern,
  // Store and parsing
  parseMarkdownWithFrontmatter,
  parseSimpleYaml,
  serializeMarkdownWithFrontmatter,
} from "./memory/index.js";
// Middleware types
export type {
  AgentMiddleware,
  LoggingMiddlewareOptions,
  MiddlewareContext,
  MiddlewareContextResult,
} from "./middleware/index.js";
// Middleware System
export {
  // Application utilities
  applyMiddleware,
  // Built-in middleware
  createLoggingMiddleware,
  // Context creation (for custom middleware)
  createMiddlewareContext,
  mergeHooks,
  setupMiddleware,
  teardownMiddleware,
} from "./middleware/index.js";
// Observability types
export type {
  AgentMetrics,
  Counter,
  EventExporterOptions,
  EventSeverity,
  Gauge,
  Histogram,
  HistogramBucket,
  HistogramData,
  LogEntry,
  LogFormatter,
  Logger,
  LoggerOptions,
  // Logger types
  LogLevel,
  LogTimer,
  LogTransport,
  MetricLabels,
  MetricPoint,
  MetricsExporter,
  MetricsRegistry,
  MetricsRegistryOptions,
  // Metrics types
  MetricType,
  // Event types
  ObservabilityEvent,
  ObservabilityEventStore,
  ObservabilityEventStoreOptions,
  ObservabilityPreset,
  ObservabilityPresetOptions,
  Span,
  SpanAttributes,
  SpanContext,
  SpanData,
  SpanEvent,
  SpanExporter,
  SpanKind,
  SpanLink,
  SpanStatus,
  // Tracing types
  SpanStatusCode,
  StartSpanOptions,
  StructuredEvent,
  Tracer,
  TracerOptions,
} from "./observability/index.js";
// Observability presets
// Observability System
export {
  createAgentMetrics,
  createCallbackMetricsExporter,
  createCallbackSpanExporter,
  createCallbackTransport,
  createConsoleMetricsExporter,
  createConsoleSpanExporter,
  createConsoleTransport,
  createFilteredTransport,
  createJsonFormatter,
  createLogger,
  createMemoryMetricsExporter,
  createMemorySpanExporter,
  createMemoryTransport,
  createMetricsRegistry,
  createObservabilityEventHooks,
  createObservabilityEventStore,
  createObservabilityPreset,
  createOTLPSpanExporter,
  createPrettyFormatter,
  // Tracing
  createTracer,
  // Metrics
  DEFAULT_LATENCY_BUCKETS,
  DEFAULT_TOKEN_BUCKETS,
  defaultLogger,
  defaultMetricsRegistry,
  defaultTracer,
  exportEventsJSONLines,
  exportEventsPrometheus,
  // Logger
  LOG_LEVEL_VALUES,
  SemanticAttributes,
  setDefaultLogger,
  setDefaultMetricsRegistry,
  setDefaultTracer,
  // Events
  toStructuredEvent,
} from "./observability/index.js";
// Plugins
export { definePlugin } from "./plugins.js";
// Preset types
export type {
  ProductionAgentOptions,
  ProductionAgentResult,
  SecureProductionAgentOptions,
} from "./presets/index.js";
// Presets (convenience bundles for quick setup)
export {
  createProductionAgent,
  createSecureProductionAgent,
  DEFAULT_BLOCKED_INPUT_PATTERNS,
  DEFAULT_BLOCKED_OUTPUT_PATTERNS,
} from "./presets/index.js";
// Security types
export type { SecurityPolicy, SecurityPolicyPreset } from "./security/index.js";
// Security (security policy presets)
export { applySecurityPolicy } from "./security/index.js";
// Advanced subagent types
export type {
  EnhancedSubagentDefinition,
  ParallelExecutionResult,
  ParallelTask,
  SubagentContext,
  SubagentContextOptions,
  SubagentErrorEvent,
  SubagentEvent,
  SubagentEventEmitter,
  SubagentExecutionOptions,
  SubagentExecutionResult,
  SubagentFinishEvent,
  SubagentStartEvent,
  SubagentStepEvent,
} from "./subagents/index.js";
// Advanced Subagents
export {
  createSubagentContext,
  createSubagentEventEmitter,
  executeSubagent,
  executeSubagentsParallel,
  mergeSubagentContext,
} from "./subagents/index.js";
// Subagents
export { createSubagent } from "./subagents.js";
// Task Store types
export type {
  BackgroundTask,
  BackgroundTaskStatus,
  BaseTaskStore,
  KeyValueStore as KVStore,
  TaskStoreOptions,
} from "./task-store/index.js";

// Task Store (background task persistence)
export {
  createBackgroundTask,
  FileTaskStore,
  isBackgroundTask,
  KVTaskStore,
  MemoryTaskStore,
  shouldExpireTask,
  updateBackgroundTask,
} from "./task-store/index.js";
// Task Manager types
export type {
  KillAllResult,
  KillResult,
  RestoreOptions,
  TaskFilter,
  TaskManagerEvents,
  TaskResources,
} from "./task-manager.js";
// Task Manager (background task lifecycle)
export { TaskManager } from "./task-manager.js";
// Tool types
export type {
  BashResult,
  BashToolOptions,
  FilesystemTools,
  FilesystemToolsOptions,
  // Task management tool types
  KillTaskToolOptions,
  ListTasksToolOptions,
  // Skill tool types
  OnTodosChanged,
  // Search tools types (MCP integration)
  SearchToolsOptions,
  SkillDefinition,
  SkillLoadResult,
  SkillRegistryOptions,
  SkillToolOptions,
  // Task tool types
  TaskOutputToolOptions,
  TaskStatus,
  TaskToolOptions as TaskToolOptions_Tool,
  TodoChangeType,
  TodoInput,
  TodosChangedData,
  TodoWriteToolOptions,
  ToolLoadResult,
  // Tool registry types (deferred loading)
  ToolMetadata,
  // Tool utilities types
  ToolReference,
  ToolRegistryOptions,
  ToolSearchOptions,
  UseToolsToolOptions,
} from "./tools/index.js";
// Core Tools
export {
  cleanupStaleTasks,
  clearCompletedTasks,
  // Bash tool
  createBashTool,
  createEditTool,
  createFilesystemTools,
  createFilesystemToolsOnly,
  createGlobTool,
  createGrepTool,
  // Task management tools
  createKillTaskTool,
  createListTasksTool,
  // Filesystem tools
  createReadTool,
  // Search tools (MCP integration)
  createSearchToolsTool,
  createSkillRegistry,
  createSkillTool,
  // Task tools (subagent delegation)
  createTaskOutputTool,
  createTaskTool,
  // Todo tool
  createTodoWriteTool,
  createToolRegistry,
  createUseToolsTool,
  createWriteTool,
  getBackgroundTask,
  listBackgroundTasks,
  // Tool utilities (DX helpers)
  mcpTools,
  mcpToolsFor,
  recoverFailedTasks,
  recoverRunningTasks,
  // Skill tool (progressive disclosure)
  SkillRegistry,
  // Tool registry (deferred tool loading)
  ToolRegistry,
  toolsFrom,
  toolsFromPlugin,
} from "./tools/index.js";
// Skills (tools use AI SDK's tool() directly)
export { defineSkill } from "./tools.js";
// Skill loader (file-based skills)
export {
  loadSkillsFromDirectories,
  loadSkillFromDirectory,
  getSkillScripts,
  getSkillReferences,
  getSkillAssets,
  getSkillResourcePath,
  type SkillLoadError,
  type LoadSkillsOptions,
} from "./skills/loader.js";
export type {
  // Agent-specific types
  Agent,
  // Context types
  AgentContext,
  AgentDataTypes,
  AgentOptions,
  AgentPlugin,
  AgentUIMessage,
  BackendFactory,
  CoreToolName,
  CustomHookInput,
  ExtendedToolExecutionOptions,
  FinishReason,
  // Generation types
  GenerateOptions,
  GenerateResult,
  GenerateResultComplete,
  GenerateResultHandoff,
  GenerateResultInterrupted,
  GenerateStep,
  HookCallback,
  HookCallbackContext,
  // Hook types
  HookEvent,
  HookInput,
  HookMatcher,
  HookOutput,
  HookRegistration,
  HookSpecificOutput,
  HttpMCPServerConfig,
  InterruptFunction,
  InterruptRequestedInput,
  InterruptResolvedInput,
  LanguageModel,
  LanguageModelUsage,
  MCPConnectionFailedInput,
  MCPConnectionRestoredInput,
  // MCP types
  MCPServerConfig,
  // AI SDK re-exports
  ModelMessage,
  PartialGenerateResult,
  PermissionDecision,
  // Permission types
  PermissionMode,
  PluginLoadingMode,
  PluginOptions,
  PostCompactInput,
  PostGenerateFailureInput,
  PostGenerateInput,
  PostToolUseFailureInput,
  PostToolUseInput,
  PreCompactInput,
  // Hook input types (for typed hook implementations)
  PreGenerateInput,
  PreToolUseInput,
  // Skill types (SkillOptions for defineSkill)
  SkillOptions,
  SseMCPServerConfig,
  StdioMCPServerConfig,
  // Streaming types
  StreamingContext,
  StreamingMetadata,
  StreamingToolsFactory,
  StreamPart,
  SubagentCreateContext,
  SubagentDefinition,
  // Subagent types
  SubagentOptions,
  SubagentStartInput,
  SubagentStopInput,
  TaskToolOptions,
  Tool,
  ToolCallResult,
  ToolExecutionOptions,
  ToolLoadErrorInput,
  ToolRegisteredInput,
  ToolResultPart,
  ToolSet,
  UIMessage,
} from "./types.js";
// Types - Re-export AI SDK types for convenience
export {
  // Result type guards
  isCompleteResult,
  isHandoffResult,
  isInterruptedResult,
} from "./types.js";

// Agent Teams Plugin
export { createAgentTeamsPlugin, InMemoryTeamCoordinator, TEAM_HOOKS, HeadlessSessionRunner } from "./plugins/agent-teams/index.js";
export type {
  AgentTeamsPluginOptions,
  TeamCoordinator,
  TeamTask,
  TeamTaskStatus,
  TeamMessage,
  TeammateInfo,
  TeammateDefinition,
  TeammateStatus,
} from "./plugins/agent-teams/types.js";
