/**
 * Store abstraction types for @lleverage-ai/memory.
 *
 * The {@link MemoryStore} interface is the single gateway for all persistent
 * memory operations. Inspired by Jeff's `brain.Store` but fully async and
 * TypeScript-idiomatic.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

/**
 * A logical forward-slash-separated path within the memory store.
 *
 * Never an OS path. Validated to reject `..`, leading slashes, backslashes,
 * and empty segments.
 */
export type MemoryPath = string & { readonly __brand: unique symbol };

// ---------------------------------------------------------------------------
// File info
// ---------------------------------------------------------------------------

/** Metadata about a single entry in the store. */
export interface FileInfo {
  path: MemoryPath;
  size: number;
  modifiedAt: Date;
  isDirectory: boolean;
}

// ---------------------------------------------------------------------------
// List options
// ---------------------------------------------------------------------------

export interface ListOptions {
  /** Recurse into subdirectories. Default: false. */
  recursive?: boolean;
  /** Glob pattern to filter results. */
  glob?: string;
  /** Include generated files (prefixed with `_`). Default: false. */
  includeGenerated?: boolean;
}

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

/** Controls commit metadata when batching mutations. */
export interface BatchOptions {
  /** Semantic tag for the batch, e.g. "extract", "reflect", "consolidate". */
  reason: string;
  /** Human-readable commit/log message. */
  message: string;
  /** Author name for audit trail. */
  author?: string;
}

/**
 * Transactional batch of store mutations.
 *
 * Reads inside a batch see pending writes. Mutations are only flushed on
 * successful completion of the batch callback.
 */
export interface MemoryBatch {
  read(path: MemoryPath): Promise<Uint8Array | null>;
  write(path: MemoryPath, content: Uint8Array): Promise<void>;
  append(path: MemoryPath, content: Uint8Array): Promise<void>;
  delete(path: MemoryPath): Promise<void>;
  rename(src: MemoryPath, dst: MemoryPath): Promise<void>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Types of mutation events emitted by a store. */
export type EventType = "write" | "append" | "delete" | "rename";

/** A mutation event emitted after a store operation completes. */
export interface StoreEvent {
  type: EventType;
  path: MemoryPath;
  /** Present only for rename events - the original path. */
  oldPath?: MemoryPath;
  timestamp: Date;
}

/** Callback for receiving store mutation events. */
export type EventSink = (event: StoreEvent) => void;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * The central storage abstraction.
 *
 * All memory operations flow through this interface. Implementations include
 * filesystem, git-backed, in-memory (testing), and database backends.
 */
export interface MemoryStore {
  /** Read a file. Returns null if the path does not exist. */
  read(path: MemoryPath): Promise<Uint8Array | null>;

  /** Atomic full rewrite. Creates intermediate directories as needed. */
  write(path: MemoryPath, content: Uint8Array): Promise<void>;

  /** Atomic append to an existing file, or create if missing. */
  append(path: MemoryPath, content: Uint8Array): Promise<void>;

  /** Delete a file. Throws if the path does not exist. */
  delete(path: MemoryPath): Promise<void>;

  /** Atomic rename/move. Overwrites destination if it exists. */
  rename(src: MemoryPath, dst: MemoryPath): Promise<void>;

  /** Check whether a path exists. */
  exists(path: MemoryPath): Promise<boolean>;

  /** Get metadata for a path. Returns null if it does not exist. */
  stat(path: MemoryPath): Promise<FileInfo | null>;

  /** List entries under a path, sorted by modification time descending. */
  list(path: MemoryPath, options?: ListOptions): Promise<FileInfo[]>;

  /**
   * Group multiple mutations into a single atomic batch.
   *
   * The callback receives a {@link MemoryBatch} whose reads see pending
   * writes. All mutations are flushed only when the callback resolves
   * successfully. If the callback throws, all pending mutations are
   * discarded.
   */
  batch(options: BatchOptions, fn: (batch: MemoryBatch) => Promise<void>): Promise<void>;

  /**
   * Subscribe to store mutation events.
   *
   * @returns An unsubscribe function.
   */
  subscribe(sink: EventSink): () => void;

  /** Release resources held by this store. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

export class MemoryNotFoundError extends Error {
  constructor(path: string) {
    super(`Memory entry not found: ${path}`);
    this.name = "MemoryNotFoundError";
  }
}

export class MemoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryConflictError";
  }
}

export class InvalidPathError extends Error {
  constructor(path: string, reason: string) {
    super(`Invalid memory path "${path}": ${reason}`);
    this.name = "InvalidPathError";
  }
}
