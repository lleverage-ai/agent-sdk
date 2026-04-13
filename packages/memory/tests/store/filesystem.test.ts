import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFilesystemStore } from "../../src/store/filesystem.js";
import { runStoreContract } from "../../src/testing/contract.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "memory-fs-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

runStoreContract("FilesystemStore", () => createFilesystemStore({ root: testDir }));

describe("FilesystemStore specifics", () => {
  it("persists data to disk across store instances", async () => {
    const store1 = createFilesystemStore({ root: testDir });
    const { createMemoryPath } = await import("../../src/path.js");
    const path = createMemoryPath("test/persist.md");

    await store1.write(path, encoder.encode("hello"));
    await store1.close();

    const store2 = createFilesystemStore({ root: testDir });
    const data = await store2.read(path);
    expect(data).not.toBeNull();
    expect(decoder.decode(data!)).toBe("hello");
    await store2.close();
  });
});
