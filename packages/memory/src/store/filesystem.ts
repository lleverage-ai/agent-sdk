import * as fs from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { atomicWrite } from "./atomic.js";
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
import { InvalidPathError, MemoryNotFoundError } from "./types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface FilesystemStoreOptions {
  /** Root directory for memory storage. */
  root: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolvePath(root: string, memoryPath: MemoryPath): string {
  const full = join(root, memoryPath);
  const resolved = resolve(full);
  const rootResolved = resolve(root);
  if (!resolved.startsWith(rootResolved + sep) && resolved !== rootResolved) {
    throw new InvalidPathError(memoryPath, "path escapes store root");
  }
  return full;
}

function isGenerated(memoryPath: string): boolean {
  const name = basename(memoryPath);
  return name.startsWith("_");
}

function toFileInfo(
  root: string,
  fullPath: string,
  s: { size: number; mtime: Date; isDirectory(): boolean },
): FileInfo {
  const rel = relative(root, fullPath).split("\\").join("/");
  return {
    path: rel as MemoryPath,
    size: s.size,
    modifiedAt: s.mtime,
    isDirectory: s.isDirectory(),
  };
}

function emit(subscribers: Set<EventSink>, event: StoreEvent): void {
  for (const sink of subscribers) {
    sink(event);
  }
}

// ---------------------------------------------------------------------------
// Batch journal
// ---------------------------------------------------------------------------

type JournalEntry =
  | { op: "write"; path: MemoryPath; content: Uint8Array }
  | { op: "append"; path: MemoryPath; content: Uint8Array }
  | { op: "delete"; path: MemoryPath }
  | { op: "rename"; path: MemoryPath; dst: MemoryPath };

type NetEffect =
  | { op: "write"; content: Uint8Array }
  | { op: "delete" }
  | { op: "rename"; dst: MemoryPath };

function computeNetEffects(journal: JournalEntry[]): Map<MemoryPath, NetEffect> {
  const effects = new Map<MemoryPath, NetEffect>();

  for (const entry of journal) {
    switch (entry.op) {
      case "write":
        effects.set(entry.path, { op: "write", content: entry.content });
        break;

      case "append": {
        const existing = effects.get(entry.path);
        if (existing && existing.op === "write") {
          const merged = new Uint8Array(existing.content.length + entry.content.length);
          merged.set(existing.content, 0);
          merged.set(entry.content, existing.content.length);
          effects.set(entry.path, { op: "write", content: merged });
        } else {
          effects.set(entry.path, { op: "write", content: entry.content });
        }
        break;
      }

      case "delete": {
        const prev = effects.get(entry.path);
        if (prev && prev.op === "write") {
          effects.delete(entry.path);
        } else {
          effects.set(entry.path, { op: "delete" });
        }
        break;
      }

      case "rename": {
        const srcEffect = effects.get(entry.path);
        if (srcEffect && srcEffect.op === "write") {
          effects.delete(entry.path);
          effects.set(entry.dst, { op: "write", content: srcEffect.content });
        } else {
          effects.set(entry.path, { op: "delete" });
          effects.set(entry.dst, { op: "rename", dst: entry.dst });
        }
        break;
      }
    }
  }

  return effects;
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

/**
 * Creates a filesystem-backed {@link MemoryStore}.
 *
 * Supports atomic writes, batched mutations with journalling, file watching
 * via subscribers, and glob-based listing.
 *
 * @param options - Configuration including the root directory
 * @returns A configured MemoryStore backed by the local filesystem
 */
export function createFilesystemStore(options: FilesystemStoreOptions): MemoryStore {
  const { root } = options;
  const subscribers = new Set<EventSink>();

  const store: MemoryStore = {
    async read(path) {
      const full = resolvePath(root, path);
      try {
        return await fs.readFile(full);
      } catch (err: unknown) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async write(path, content) {
      const full = resolvePath(root, path);
      await atomicWrite(full, content);
      emit(subscribers, { type: "write", path, timestamp: new Date() });
    },

    async append(path, content) {
      const full = resolvePath(root, path);
      let existing: Uint8Array;
      try {
        existing = await fs.readFile(full);
      } catch (err: unknown) {
        if (isNotFound(err)) {
          existing = new Uint8Array(0);
        } else {
          throw err;
        }
      }
      const merged = new Uint8Array(existing.length + content.length);
      merged.set(existing, 0);
      merged.set(content, existing.length);
      await atomicWrite(full, merged);
      emit(subscribers, { type: "append", path, timestamp: new Date() });
    },

    async delete(path) {
      const full = resolvePath(root, path);
      try {
        await fs.unlink(full);
      } catch (err: unknown) {
        if (isNotFound(err)) throw new MemoryNotFoundError(path);
        throw err;
      }
      emit(subscribers, { type: "delete", path, timestamp: new Date() });
    },

    async rename(src, dst) {
      const srcFull = resolvePath(root, src);
      const dstFull = resolvePath(root, dst);

      try {
        await fs.access(srcFull);
      } catch {
        throw new MemoryNotFoundError(src);
      }

      await fs.mkdir(dirname(dstFull), { recursive: true });
      await fs.rename(srcFull, dstFull);
      emit(subscribers, { type: "rename", path: dst, oldPath: src, timestamp: new Date() });
    },

    async exists(path) {
      const full = resolvePath(root, path);
      try {
        await fs.access(full);
        return true;
      } catch {
        return false;
      }
    },

    async stat(path) {
      const full = resolvePath(root, path);
      try {
        const s = await fs.stat(full);
        return toFileInfo(root, full, s);
      } catch (err: unknown) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async list(path, options?: ListOptions) {
      const full = resolvePath(root, path);
      const recursive = options?.recursive ?? false;
      const includeGenerated = options?.includeGenerated ?? false;
      const globPattern = options?.glob;

      let entries: string[];
      try {
        entries = (await fs.readdir(full, { recursive })) as string[];
      } catch (err: unknown) {
        if (isNotFound(err)) return [];
        throw err;
      }

      const globRe = globPattern ? globToRegex(globPattern) : null;

      const filtered = entries.filter((entry) => {
        const normalised = entry.split("\\").join("/");
        if (!includeGenerated && isGenerated(normalised)) return false;
        if (globRe && !globRe.test(normalised)) return false;
        return true;
      });

      const results = (
        await Promise.all(
          filtered.map(async (entry) => {
            const entryFull = join(full, entry);
            try {
              const s = await fs.stat(entryFull);
              return toFileInfo(root, entryFull, s);
            } catch {
              // Entry may have been removed between readdir and stat.
              return null;
            }
          }),
        )
      ).filter((info): info is FileInfo => info !== null);

      results.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
      return results;
    },

    async batch(_options: BatchOptions, fn) {
      const journal: JournalEntry[] = [];

      const batch: MemoryBatch = {
        async read(path) {
          // Replay journal to compute effective content for this path.
          let content = await store.read(path);
          for (const entry of journal) {
            if (entry.op === "write" && entry.path === path) {
              content = entry.content;
            } else if (entry.op === "delete" && entry.path === path) {
              content = null;
            } else if (entry.op === "append" && entry.path === path) {
              if (content) {
                const merged = new Uint8Array(content.length + entry.content.length);
                merged.set(content, 0);
                merged.set(entry.content, content.length);
                content = merged;
              } else {
                content = entry.content;
              }
            } else if (entry.op === "rename" && entry.path === path) {
              content = null;
            } else if (entry.op === "rename" && entry.dst === path) {
              // Check earlier journal entries for pending writes at the source
              // before falling back to disk, so write+rename chains resolve correctly.
              let sourceContent: Uint8Array | null = null;
              for (const earlier of journal) {
                if (earlier === entry) break;
                if (earlier.op === "write" && earlier.path === entry.path) {
                  sourceContent = earlier.content;
                }
              }
              content = sourceContent ?? (await store.read(entry.path));
            }
          }
          return content;
        },

        async write(path, content) {
          journal.push({ op: "write", path, content });
        },

        async append(path, content) {
          journal.push({ op: "append", path, content });
        },

        async delete(path) {
          journal.push({ op: "delete", path });
        },

        async rename(src, dst) {
          journal.push({ op: "rename", path: src, dst });
        },
      };

      await fn(batch);

      // Flush: compute net effects and apply.
      const effects = computeNetEffects(journal);

      // For appends that didn't have a preceding write in the journal, we need
      // to read from disk to get the base content.
      for (const [path, effect] of effects) {
        if (effect.op === "write") {
          const hasWrite = journal.some((e) => e.op === "write" && e.path === path);
          if (!hasWrite) {
            let diskContent: Uint8Array;
            try {
              diskContent = await fs.readFile(resolvePath(root, path));
            } catch {
              diskContent = new Uint8Array(0);
            }
            const appendContent = effect.content;
            const merged = new Uint8Array(diskContent.length + appendContent.length);
            merged.set(diskContent, 0);
            merged.set(appendContent, diskContent.length);
            effects.set(path, { op: "write", content: merged });
          }
        }
      }

      const events: StoreEvent[] = [];
      const now = new Date();

      for (const [path, effect] of effects) {
        switch (effect.op) {
          case "write":
            await atomicWrite(resolvePath(root, path), effect.content);
            events.push({ type: "write", path, timestamp: now });
            break;
          case "delete":
            try {
              await fs.unlink(resolvePath(root, path));
              events.push({ type: "delete", path, timestamp: now });
            } catch (err: unknown) {
              if (!isNotFound(err)) throw err;
            }
            break;
          case "rename":
            await fs.mkdir(dirname(resolvePath(root, effect.dst)), { recursive: true });
            await fs.rename(resolvePath(root, path), resolvePath(root, effect.dst));
            events.push({ type: "rename", path: effect.dst, oldPath: path, timestamp: now });
            break;
        }
      }

      for (const event of events) {
        emit(subscribers, event);
      }
    },

    subscribe(sink) {
      subscribers.add(sink);
      return () => {
        subscribers.delete(sink);
      };
    },

    async close() {
      subscribers.clear();
    },
  };

  return store;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}
