import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryPath } from "../path.js";
import type { MemoryStore, StoreEvent } from "../store/types.js";
import { MemoryNotFoundError } from "../store/types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(text: string): Uint8Array {
  return encoder.encode(text);
}

function decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/**
 * Portable contract test suite for {@link MemoryStore} implementations.
 *
 * Inspired by Jeff's `braintest` pattern. Call this from any test file and
 * pass a factory that creates a fresh store instance for each test.
 *
 * @param name - Display name for the test suite
 * @param factory - Factory function that creates a fresh store for each test
 *
 * @category Testing
 */
export function runStoreContract(
  name: string,
  factory: () => Promise<MemoryStore> | MemoryStore,
): void {
  describe(name, () => {
    let store: MemoryStore;

    beforeEach(async () => {
      store = await factory();
    });

    // -----------------------------------------------------------------
    // Basic operations
    // -----------------------------------------------------------------

    describe("basic operations", () => {
      it("read returns null for non-existent paths", async () => {
        const result = await store.read(createMemoryPath("does/not/exist.md"));
        expect(result).toBeNull();
      });

      it("write then read round-trips content", async () => {
        const path = createMemoryPath("notes/hello.md");
        await store.write(path, encode("Hello, world!"));

        const result = await store.read(path);
        expect(result).not.toBeNull();
        expect(decode(result!)).toBe("Hello, world!");
      });

      it("write creates intermediate directories implicitly", async () => {
        const path = createMemoryPath("deeply/nested/dir/file.md");
        await store.write(path, encode("nested content"));

        const result = await store.read(path);
        expect(result).not.toBeNull();
        expect(decode(result!)).toBe("nested content");
      });

      it("write overwrites existing content", async () => {
        const path = createMemoryPath("overwrite.md");
        await store.write(path, encode("first"));
        await store.write(path, encode("second"));

        const result = await store.read(path);
        expect(result).not.toBeNull();
        expect(decode(result!)).toBe("second");
      });

      it("append creates file if missing", async () => {
        const path = createMemoryPath("appended.md");
        await store.append(path, encode("line one"));

        const result = await store.read(path);
        expect(result).not.toBeNull();
        expect(decode(result!)).toBe("line one");
      });

      it("append adds to existing content", async () => {
        const path = createMemoryPath("appended.md");
        await store.write(path, encode("first"));
        await store.append(path, encode(" second"));

        const result = await store.read(path);
        expect(result).not.toBeNull();
        expect(decode(result!)).toBe("first second");
      });

      it("delete removes a file", async () => {
        const path = createMemoryPath("to-delete.md");
        await store.write(path, encode("ephemeral"));
        await store.delete(path);

        const result = await store.read(path);
        expect(result).toBeNull();
      });

      it("delete throws MemoryNotFoundError for missing paths", async () => {
        const path = createMemoryPath("ghost.md");
        await expect(store.delete(path)).rejects.toThrow(MemoryNotFoundError);
      });

      it("rename moves content", async () => {
        const src = createMemoryPath("old-name.md");
        const dst = createMemoryPath("new-name.md");
        await store.write(src, encode("moving"));
        await store.rename(src, dst);

        expect(await store.read(src)).toBeNull();
        const result = await store.read(dst);
        expect(result).not.toBeNull();
        expect(decode(result!)).toBe("moving");
      });

      it("rename throws MemoryNotFoundError for missing source", async () => {
        const src = createMemoryPath("no-source.md");
        const dst = createMemoryPath("destination.md");
        await expect(store.rename(src, dst)).rejects.toThrow(MemoryNotFoundError);
      });

      it("rename overwrites destination", async () => {
        const src = createMemoryPath("source.md");
        const dst = createMemoryPath("target.md");
        await store.write(src, encode("new content"));
        await store.write(dst, encode("old content"));
        await store.rename(src, dst);

        expect(await store.read(src)).toBeNull();
        const result = await store.read(dst);
        expect(result).not.toBeNull();
        expect(decode(result!)).toBe("new content");
      });

      it("exists returns true for existing, false for missing", async () => {
        const path = createMemoryPath("exists-check.md");
        expect(await store.exists(path)).toBe(false);

        await store.write(path, encode("present"));
        expect(await store.exists(path)).toBe(true);
      });

      it("stat returns FileInfo for existing paths", async () => {
        const path = createMemoryPath("stat-target.md");
        const content = encode("stat me");
        await store.write(path, content);

        const info = await store.stat(path);
        expect(info).not.toBeNull();
        expect(info!.path).toBe(path);
        expect(info!.size).toBe(content.length);
        expect(info!.modifiedAt).toBeInstanceOf(Date);
      });

      it("stat returns null for missing paths", async () => {
        const info = await store.stat(createMemoryPath("no-such-file.md"));
        expect(info).toBeNull();
      });
    });

    // -----------------------------------------------------------------
    // Listing
    // -----------------------------------------------------------------

    describe("listing", () => {
      beforeEach(async () => {
        await store.write(createMemoryPath("docs/a.md"), encode("a"));
        await store.write(createMemoryPath("docs/b.md"), encode("b"));
        await store.write(createMemoryPath("docs/sub/c.md"), encode("c"));
        await store.write(createMemoryPath("docs/_generated.md"), encode("gen"));
      });

      it("list returns entries under a path", async () => {
        const entries = await store.list(createMemoryPath("docs"));
        const paths = entries.map((e) => e.path);
        expect(paths).toContain("docs/a.md");
        expect(paths).toContain("docs/b.md");
        expect(paths).not.toContain("docs/sub/c.md");
      });

      it("list with recursive: true includes nested entries", async () => {
        const entries = await store.list(createMemoryPath("docs"), { recursive: true });
        const paths = entries.map((e) => e.path);
        expect(paths).toContain("docs/a.md");
        expect(paths).toContain("docs/b.md");
        expect(paths).toContain("docs/sub/c.md");
      });

      it("list filters by glob pattern", async () => {
        const entries = await store.list(createMemoryPath("docs"), {
          recursive: true,
          glob: "*.md",
        });
        const paths = entries.map((e) => e.path);
        expect(paths).toContain("docs/a.md");
        expect(paths).toContain("docs/b.md");
      });

      it("list hides generated files (prefixed with _) by default", async () => {
        const entries = await store.list(createMemoryPath("docs"));
        const paths = entries.map((e) => e.path);
        expect(paths).not.toContain("docs/_generated.md");
      });

      it("list shows generated files when includeGenerated: true", async () => {
        const entries = await store.list(createMemoryPath("docs"), { includeGenerated: true });
        const paths = entries.map((e) => e.path);
        expect(paths).toContain("docs/_generated.md");
      });

      it("list returns results sorted by modification time descending", async () => {
        const entries = await store.list(createMemoryPath("docs"), {
          recursive: true,
          includeGenerated: true,
        });
        for (let i = 1; i < entries.length; i++) {
          expect(entries[i - 1]!.modifiedAt.getTime()).toBeGreaterThanOrEqual(
            entries[i]!.modifiedAt.getTime(),
          );
        }
      });
    });

    // -----------------------------------------------------------------
    // Batch
    // -----------------------------------------------------------------

    describe("batch", () => {
      const batchOpts = { reason: "test", message: "test batch" };

      it("commits all writes atomically", async () => {
        const pathA = createMemoryPath("batch/a.md");
        const pathB = createMemoryPath("batch/b.md");

        await store.batch(batchOpts, async (batch) => {
          await batch.write(pathA, encode("alpha"));
          await batch.write(pathB, encode("bravo"));
        });

        expect(decode((await store.read(pathA))!)).toBe("alpha");
        expect(decode((await store.read(pathB))!)).toBe("bravo");
      });

      it("reads see pending writes", async () => {
        const path = createMemoryPath("batch/readable.md");

        await store.batch(batchOpts, async (batch) => {
          await batch.write(path, encode("pending"));
          const result = await batch.read(path);
          expect(result).not.toBeNull();
          expect(decode(result!)).toBe("pending");
        });
      });

      it("discards on callback error", async () => {
        const path = createMemoryPath("batch/discard.md");

        await expect(
          store.batch(batchOpts, async (batch) => {
            await batch.write(path, encode("should not persist"));
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");

        const result = await store.read(path);
        expect(result).toBeNull();
      });

      it("write + delete on same path cancels both", async () => {
        const path = createMemoryPath("batch/cancel.md");

        await store.batch(batchOpts, async (batch) => {
          await batch.write(path, encode("written"));
          await batch.delete(path);
        });

        const result = await store.read(path);
        expect(result).toBeNull();
      });

      it("write + write on same path keeps latter", async () => {
        const path = createMemoryPath("batch/overwrite.md");

        await store.batch(batchOpts, async (batch) => {
          await batch.write(path, encode("first"));
          await batch.write(path, encode("second"));
        });

        expect(decode((await store.read(path))!)).toBe("second");
      });
    });

    // -----------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------

    describe("events", () => {
      it("subscribe receives write events", async () => {
        const events: StoreEvent[] = [];
        store.subscribe((e) => events.push(e));

        const path = createMemoryPath("events/write.md");
        await store.write(path, encode("hello"));

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe("write");
        expect(events[0]!.path).toBe(path);
      });

      it("subscribe receives delete events", async () => {
        const path = createMemoryPath("events/delete.md");
        await store.write(path, encode("bye"));

        const events: StoreEvent[] = [];
        store.subscribe((e) => events.push(e));

        await store.delete(path);

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe("delete");
        expect(events[0]!.path).toBe(path);
      });

      it("subscribe receives rename events", async () => {
        const src = createMemoryPath("events/old.md");
        const dst = createMemoryPath("events/new.md");
        await store.write(src, encode("moving"));

        const events: StoreEvent[] = [];
        store.subscribe((e) => events.push(e));

        await store.rename(src, dst);

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe("rename");
        expect(events[0]!.path).toBe(dst);
        expect(events[0]!.oldPath).toBe(src);
      });

      it("unsubscribe stops receiving events", async () => {
        const events: StoreEvent[] = [];
        const unsub = store.subscribe((e) => events.push(e));

        await store.write(createMemoryPath("events/first.md"), encode("one"));
        unsub();
        await store.write(createMemoryPath("events/second.md"), encode("two"));

        expect(events).toHaveLength(1);
      });

      it("batch events fire after commit, not during", async () => {
        const events: StoreEvent[] = [];
        store.subscribe((e) => events.push(e));

        const path = createMemoryPath("events/batch.md");
        await store.batch({ reason: "test", message: "test" }, async (batch) => {
          await batch.write(path, encode("batched"));
          expect(events).toHaveLength(0);
        });

        expect(events.length).toBeGreaterThan(0);
        expect(events.some((e) => e.path === path)).toBe(true);
      });
    });
  });
}
