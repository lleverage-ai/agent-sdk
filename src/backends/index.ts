/**
 * Backend implementations for the agent SDK.
 *
 * This module provides various storage backends that implement the
 * {@link BackendProtocol} interface.
 *
 * @packageDocumentation
 */

export {
  CompositeBackend,
  type CompositeBackendOptions,
  createCompositeBackend,
  type RouteConfig,
} from "./composite.js";

export {
  createFilesystemBackend,
  FileSizeLimitError,
  FilesystemBackend,
  type FilesystemBackendOptions,
  PathTraversalError,
  SymlinkError,
} from "./filesystem.js";

export {
  createPersistentBackend,
  InMemoryStore,
  type KeyValueStore,
  PersistentBackend,
  type PersistentBackendOptions,
} from "./persistent.js";
export {
  BaseSandbox,
  CommandBlockedError,
  CommandTimeoutError,
  createLocalSandbox,
  LocalSandbox,
  type LocalSandboxOptions,
} from "./sandbox.js";
export {
  type AgentState,
  createAgentState,
  createStateBackend,
  StateBackend,
  type TodoItem,
  type TodoStatus,
} from "./state.js";
