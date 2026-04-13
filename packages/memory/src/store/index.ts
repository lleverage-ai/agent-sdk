export type {
  MemoryPath,
  FileInfo,
  ListOptions,
  BatchOptions,
  MemoryBatch,
  MemoryStore,
  EventType,
  StoreEvent,
  EventSink,
} from "./types.js";

export {
  MemoryNotFoundError,
  MemoryConflictError,
  InvalidPathError,
} from "./types.js";

export { createFilesystemStore } from "./filesystem.js";
export { createInMemoryStore } from "./in-memory.js";
export { createGitStore } from "./git.js";
export type { GitStoreOptions } from "./git.js";
export { createAutodetectedStore } from "./autodetect.js";
export type { AutodetectOptions } from "./autodetect.js";
