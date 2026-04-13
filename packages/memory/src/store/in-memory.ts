import { globToRegex } from "./glob.js";
import type {
  BatchOptions,
  EventSink,
  FileInfo,
  ListOptions,
  MemoryBatch,
  MemoryPath,
  MemoryStore,
  StoreEvent,
} from "./types.js";
import { MemoryNotFoundError } from "./types.js";

type Entry = { content: Uint8Array; modifiedAt: Date };

function cloneEntry(entry: Entry): Entry {
  return {
    content: new Uint8Array(entry.content),
    modifiedAt: new Date(entry.modifiedAt.getTime()),
  };
}

function cloneMap(source: Map<string, Entry>): Map<string, Entry> {
  const copy = new Map<string, Entry>();
  for (const [key, value] of source) {
    copy.set(key, cloneEntry(value));
  }
  return copy;
}

function concatUint8(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

function isGenerated(path: string): boolean {
  const segments = path.split("/");
  const filename = segments[segments.length - 1];
  return filename?.startsWith("_") ?? false;
}

function buildFileInfo(path: string, entry: Entry, allKeys: Iterable<string>): FileInfo {
  const prefix = path.endsWith("/") ? path : `${path}/`;
  let isDirectory = false;
  for (const key of allKeys) {
    if (key.startsWith(prefix)) {
      isDirectory = true;
      break;
    }
  }
  return {
    path: path as MemoryPath,
    size: entry.content.length,
    modifiedAt: entry.modifiedAt,
    isDirectory,
  };
}

/**
 * Creates an in-memory {@link MemoryStore} for testing.
 *
 * All data is held in a `Map` and lost when the store is garbage collected.
 * Batches are applied atomically via snapshot-and-swap.
 *
 * @returns A configured in-memory MemoryStore
 */
export function createInMemoryStore(): MemoryStore {
  let data = new Map<string, Entry>();
  const subscribers = new Set<EventSink>();

  function emit(event: StoreEvent): void {
    for (const sink of subscribers) {
      sink(event);
    }
  }

  function makeBatchOperations(working: Map<string, Entry>): MemoryBatch {
    return {
      async read(path: MemoryPath): Promise<Uint8Array | null> {
        const entry = working.get(path);
        return entry ? new Uint8Array(entry.content) : null;
      },
      async write(path: MemoryPath, content: Uint8Array): Promise<void> {
        working.set(path, { content: new Uint8Array(content), modifiedAt: new Date() });
      },
      async append(path: MemoryPath, content: Uint8Array): Promise<void> {
        const existing = working.get(path);
        const base = existing ? existing.content : new Uint8Array(0);
        working.set(path, { content: concatUint8(base, content), modifiedAt: new Date() });
      },
      async delete(path: MemoryPath): Promise<void> {
        if (!working.has(path)) {
          throw new MemoryNotFoundError(path);
        }
        working.delete(path);
      },
      async rename(src: MemoryPath, dst: MemoryPath): Promise<void> {
        const entry = working.get(src);
        if (!entry) {
          throw new MemoryNotFoundError(src);
        }
        working.delete(src);
        working.set(dst, { ...entry, modifiedAt: new Date() });
      },
    };
  }

  const store: MemoryStore = {
    async read(path: MemoryPath): Promise<Uint8Array | null> {
      const entry = data.get(path);
      return entry ? new Uint8Array(entry.content) : null;
    },

    async write(path: MemoryPath, content: Uint8Array): Promise<void> {
      data.set(path, { content: new Uint8Array(content), modifiedAt: new Date() });
      emit({ type: "write", path, timestamp: new Date() });
    },

    async append(path: MemoryPath, content: Uint8Array): Promise<void> {
      const existing = data.get(path);
      const base = existing ? existing.content : new Uint8Array(0);
      data.set(path, { content: concatUint8(base, content), modifiedAt: new Date() });
      emit({ type: "append", path, timestamp: new Date() });
    },

    async delete(path: MemoryPath): Promise<void> {
      if (!data.has(path)) {
        throw new MemoryNotFoundError(path);
      }
      data.delete(path);
      emit({ type: "delete", path, timestamp: new Date() });
    },

    async rename(src: MemoryPath, dst: MemoryPath): Promise<void> {
      const entry = data.get(src);
      if (!entry) {
        throw new MemoryNotFoundError(src);
      }
      data.delete(src);
      data.set(dst, { ...entry, modifiedAt: new Date() });
      emit({ type: "rename", path: dst, oldPath: src, timestamp: new Date() });
    },

    async exists(path: MemoryPath): Promise<boolean> {
      if (data.has(path)) return true;
      // Check if path is a directory (any key starts with path/)
      const prefix = `${path}/`;
      for (const key of data.keys()) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    },

    async stat(path: MemoryPath): Promise<FileInfo | null> {
      const entry = data.get(path);
      if (!entry) {
        return null;
      }
      return buildFileInfo(path, entry, data.keys());
    },

    async list(path: MemoryPath, options?: ListOptions): Promise<FileInfo[]> {
      const prefix = path === ("" as MemoryPath) ? "" : path.endsWith("/") ? path : `${path}/`;
      const recursive = options?.recursive ?? false;
      const includeGenerated = options?.includeGenerated ?? false;
      const globPattern = options?.glob ? globToRegex(options.glob) : null;

      const results: FileInfo[] = [];

      for (const [key, entry] of data) {
        if (!key.startsWith(prefix)) {
          continue;
        }

        const relative = key.slice(prefix.length);

        if (!recursive && relative.includes("/")) {
          continue;
        }

        if (!includeGenerated && isGenerated(key)) {
          continue;
        }

        if (globPattern && !globPattern.test(relative)) {
          continue;
        }

        results.push(buildFileInfo(key, entry, data.keys()));
      }

      results.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
      return results;
    },

    async batch(_options: BatchOptions, fn: (batch: MemoryBatch) => Promise<void>): Promise<void> {
      const before = cloneMap(data);
      const working = cloneMap(data);
      const batchOps = makeBatchOperations(working);

      await fn(batchOps);

      data = working;

      const events: StoreEvent[] = [];
      const now = new Date();

      for (const [key] of working) {
        const beforeEntry = before.get(key);
        if (!beforeEntry) {
          events.push({ type: "write", path: key as MemoryPath, timestamp: now });
        } else {
          const afterEntry = working.get(key)!;
          if (
            beforeEntry.content.length !== afterEntry.content.length ||
            !beforeEntry.content.every((v, i) => v === afterEntry.content[i])
          ) {
            events.push({ type: "write", path: key as MemoryPath, timestamp: now });
          }
        }
      }

      for (const [key] of before) {
        if (!working.has(key)) {
          events.push({ type: "delete", path: key as MemoryPath, timestamp: now });
        }
      }

      for (const event of events) {
        emit(event);
      }
    },

    subscribe(sink: EventSink): () => void {
      subscribers.add(sink);
      return () => {
        subscribers.delete(sink);
      };
    },

    async close(): Promise<void> {
      data.clear();
      subscribers.clear();
    },
  };

  return store;
}
