/**
 * Checkpointer system for session persistence and resumption.
 *
 * This module provides tools for saving and restoring agent sessions,
 * enabling:
 * - Cross-conversation persistence
 * - Session resumption after process restart
 * - Tool approval interrupts
 *
 * ## Available Savers
 *
 * - **MemorySaver** - In-memory storage (ephemeral, for testing/development)
 * - **FileSaver** - JSON file storage (persistent, human-readable)
 * - **KeyValueStoreSaver** - Adapter for any KeyValueStore implementation
 *
 * @example
 * ```typescript
 * import { MemorySaver, FileSaver, KeyValueStoreSaver } from "@lleverage-ai/agent-sdk";
 *
 * // For testing
 * const memorySaver = new MemorySaver();
 *
 * // For persistence
 * const fileSaver = new FileSaver({ dir: "./.checkpoints" });
 *
 * // For custom storage (Redis, SQLite, etc.)
 * const kvSaver = new KeyValueStoreSaver({ store: myCustomStore });
 * ```
 *
 * @packageDocumentation
 */

export type { FileSaverOptions } from "./file-saver.js";
// File Saver
export { createFileSaver, FileSaver } from "./file-saver.js";
export type { KeyValueStoreSaverOptions } from "./kv-saver.js";
// KeyValueStore Saver
export { createKeyValueStoreSaver, KeyValueStoreSaver } from "./kv-saver.js";
export type { MemorySaverOptions } from "./memory-saver.js";
// Memory Saver
export { createMemorySaver, MemorySaver } from "./memory-saver.js";
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
  Interrupt,
} from "./types.js";
// Types
export {
  createApprovalInterrupt,
  createCheckpoint,
  createInterrupt,
  isApprovalInterrupt,
  isCheckpoint,
  isInterrupt,
  updateCheckpoint,
} from "./types.js";
