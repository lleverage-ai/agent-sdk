import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryPath } from "../../src/path.js";
import { createGitStore } from "../../src/store/git.js";

const execFileAsync = promisify(execFile);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let testDir: string;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function initGitRepo(dir: string): Promise<void> {
  await git(dir, ["init"]);
  await git(dir, ["config", "user.name", "Test"]);
  await git(dir, ["config", "user.email", "test@test.com"]);
}

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "memory-git-test-"));
  await initGitRepo(testDir);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("GitStore", () => {
  it("creates a commit after a batch write", async () => {
    const store = await createGitStore({
      root: testDir,
      autoPush: false,
      author: "test-author",
      email: "test@test.com",
    });

    const path = createMemoryPath("test/commit-check.md");
    await store.write(path, encoder.encode("commit test"));

    const log = await git(testDir, ["log", "--oneline", "-1"]);
    expect(log).toContain("[write]");
    await store.close();
  });

  it("does not error on nothing-to-commit", async () => {
    const store = await createGitStore({
      root: testDir,
      autoPush: false,
    });

    // Write then delete the same file in separate batches — second batch has nothing to commit
    const path = createMemoryPath("test/empty.md");
    await store.write(path, encoder.encode("temp"));
    await store.delete(path);

    // No error should be thrown
    await store.close();
  });

  it("uses configured author in commits", async () => {
    const store = await createGitStore({
      root: testDir,
      autoPush: false,
      author: "Memory Bot",
      email: "bot@example.com",
    });

    const path = createMemoryPath("test/author-check.md");
    await store.write(path, encoder.encode("author test"));

    const log = await git(testDir, ["log", "-1", "--format=%an <%ae>"]);
    expect(log).toBe("Memory Bot <bot@example.com>");
    await store.close();
  });

  it("sanitises author name with angle brackets", async () => {
    const store = await createGitStore({
      root: testDir,
      autoPush: false,
      author: "Bad <Actor>",
      email: "bad@example.com",
    });

    const path = createMemoryPath("test/sanitise.md");
    await store.write(path, encoder.encode("sanitise test"));

    const authorName = await git(testDir, ["log", "-1", "--format=%an"]);
    expect(authorName).not.toContain("<");
    expect(authorName).not.toContain(">");
    await store.close();
  });

  it("does not push when autoPush is false", async () => {
    const store = await createGitStore({
      root: testDir,
      autoPush: false,
    });

    const path = createMemoryPath("test/no-push.md");
    await store.write(path, encoder.encode("no push"));

    // Verify commit exists locally
    const log = await git(testDir, ["log", "--oneline", "-1"]);
    expect(log.length).toBeGreaterThan(0);
    await store.close();
  });

  it("sanitises newlines in commit message reason and message", async () => {
    const store = await createGitStore({
      root: testDir,
      autoPush: false,
    });

    const path = createMemoryPath("test/newline-msg.md");
    await store.batch({ reason: "line1\nline2", message: "msg1\rmsg2" }, async (batch) => {
      await batch.write(path, encoder.encode("newline test"));
    });

    const subject = await git(testDir, ["log", "-1", "--format=%s"]);
    expect(subject).not.toContain("\n");
    expect(subject).not.toContain("\r");
    expect(subject).toContain("line1 line2");
    expect(subject).toContain("msg1 msg2");
    await store.close();
  });

  it("persists data across store instances", async () => {
    const store1 = await createGitStore({
      root: testDir,
      autoPush: false,
    });

    const path = createMemoryPath("test/persist.md");
    await store1.write(path, encoder.encode("persistent data"));
    await store1.close();

    const store2 = await createGitStore({
      root: testDir,
      autoPush: false,
    });

    const data = await store2.read(path);
    expect(data).not.toBeNull();
    expect(decoder.decode(data!)).toBe("persistent data");
    await store2.close();
  });
});
