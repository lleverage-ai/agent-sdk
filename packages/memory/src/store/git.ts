import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { createFilesystemStore } from "./filesystem.js";
import type {
  BatchOptions,
  EventSink,
  ListOptions,
  MemoryBatch,
  MemoryPath,
  MemoryStore,
} from "./types.js";
import { MemoryConflictError } from "./types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface GitStoreOptions {
  /** Root directory (must be a git repo or will be initialised). */
  root: string;
  /** Whether to auto-push after each batch commit. Default: true. */
  autoPush?: boolean;
  /** Author name for commits. */
  author?: string;
  /** Author email for commits. */
  email?: string;
}

// ---------------------------------------------------------------------------
// Git helper
// ---------------------------------------------------------------------------

type GitResult = { stdout: string; stderr: string; exitCode: number };

const GIT_TIMEOUT_MS = 30_000;

async function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && "code" in err && typeof err.code === "number") {
          resolve({ stdout, stderr, exitCode: err.code });
          return;
        }
        if (err) {
          reject(err);
          return;
        }
        resolve({ stdout, stderr, exitCode: 0 });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

export async function hasGitDir(root: string): Promise<boolean> {
  try {
    await access(join(root, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function hasRemote(root: string): Promise<boolean> {
  const result = await git(root, ["remote", "-v"]);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

async function currentBranch(root: string): Promise<string> {
  const result = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.exitCode === 0 && result.stdout.trim().length > 0) {
    return result.stdout.trim();
  }
  return "main";
}

function isNonFastForward(result: GitResult): boolean {
  const combined = result.stdout + result.stderr;
  return (
    combined.includes("non-fast-forward") ||
    combined.includes("stale info") ||
    combined.includes("[rejected]") ||
    combined.includes("fetch first")
  );
}

// ---------------------------------------------------------------------------
// Freshen (pull)
// ---------------------------------------------------------------------------

async function freshen(root: string, branch: string): Promise<boolean> {
  const fetchResult = await git(root, ["fetch", "origin"]);
  if (fetchResult.exitCode !== 0) return false;

  const statusResult = await git(root, ["status", "--porcelain"]);
  const isDirty = statusResult.exitCode === 0 && statusResult.stdout.trim().length > 0;
  let stashed = false;

  if (isDirty) {
    const stashResult = await git(root, [
      "stash",
      "push",
      "--include-untracked",
      "-m",
      "memory-freshen-autostash",
    ]);
    stashed = stashResult.exitCode === 0;
  }

  const rebaseResult = await git(root, ["rebase", `origin/${branch}`]);
  if (rebaseResult.exitCode !== 0) {
    await git(root, ["rebase", "--abort"]);
    if (stashed) {
      await git(root, ["stash", "pop"]);
    }
    return false;
  }

  if (stashed) {
    await git(root, ["stash", "pop"]);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Push with retry
// ---------------------------------------------------------------------------

async function pushWithRetry(root: string, branch: string): Promise<void> {
  const first = await git(root, ["push", "origin", "HEAD"]);
  if (first.exitCode === 0) return;

  if (!isNonFastForward(first)) return;

  await freshen(root, branch);

  const retry = await git(root, ["push", "origin", "HEAD"]);
  if (retry.exitCode !== 0 && isNonFastForward(retry)) {
    throw new MemoryConflictError("Push failed after rebase retry: non-fast-forward");
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a git-backed {@link MemoryStore}.
 *
 * Wraps a filesystem store with automatic git commit and push on each
 * batch mutation. Handles fetch, rebase, and push-with-retry for
 * concurrent access.
 *
 * @param options - Configuration including root directory, author, and push behaviour
 * @returns A configured MemoryStore that commits changes to git
 */
export async function createGitStore(options: GitStoreOptions): Promise<MemoryStore> {
  const { root, autoPush = true, author = "memory", email = "memory@localhost" } = options;

  // 1. Initialise git repo if needed
  if (!(await hasGitDir(root))) {
    await git(root, ["init"]);
  }

  // 2. Fetch + rebase if remote exists
  const remote = await hasRemote(root);
  let branch = await currentBranch(root);

  if (remote) {
    await freshen(root, branch);

    // Push any local commits that are ahead
    const logResult = await git(root, ["rev-list", "--count", `origin/${branch}..HEAD`]);
    if (logResult.exitCode === 0 && parseInt(logResult.stdout.trim(), 10) > 0) {
      await pushWithRetry(root, branch);
    }
  }

  // 3. Create the underlying filesystem store
  const fs = createFilesystemStore({ root });

  // 4. Build the git-backed wrapper
  const commitAndPush = async (opts: BatchOptions): Promise<void> => {
    // Re-read branch in case it changed
    branch = await currentBranch(root);

    // Stage all changes
    await git(root, ["add", "-A"]);

    // Build commit message — strip newlines from reason/message to prevent multi-line subjects
    const safeReason = opts.reason.replace(/[\r\n]/g, " ").trim() || "batch";
    const safeMessage = opts.message.replace(/[\r\n]/g, " ").trim() || "update";
    const subject = `[${safeReason}] ${safeMessage}`;
    const safeAuthor =
      (opts.author ?? author ?? "memory").replace(/[<>\r\n]/g, "").trim() || "memory";
    const safeEmail = email.replace(/[<>\r\n]/g, "").trim() || "memory@localhost";
    const commitArgs = ["commit", "-m", subject, `--author=${safeAuthor} <${safeEmail}>`];

    const commitResult = await git(root, commitArgs);

    // "nothing to commit" - skip silently
    if (
      commitResult.exitCode !== 0 &&
      (commitResult.stdout.includes("nothing to commit") ||
        commitResult.stderr.includes("nothing to commit"))
    ) {
      return;
    }

    if (commitResult.exitCode !== 0) {
      throw new Error(`git commit failed: ${commitResult.stderr || commitResult.stdout}`);
    }

    // Push if configured and remote exists
    if (autoPush && remote) {
      await pushWithRetry(root, branch);
    }
  };

  const store: MemoryStore = {
    // Read-only operations delegate directly
    read: (path) => fs.read(path),
    exists: (path) => fs.exists(path),
    stat: (path) => fs.stat(path),
    list: (path, opts?: ListOptions) => fs.list(path, opts),
    subscribe: (sink: EventSink) => fs.subscribe(sink),
    close: () => fs.close(),

    // Standalone mutations: wrap in an implicit single-operation batch
    async write(path: MemoryPath, content: Uint8Array) {
      await store.batch({ reason: "write", message: `write ${path}` }, async (b) => {
        await b.write(path, content);
      });
    },

    async append(path: MemoryPath, content: Uint8Array) {
      await store.batch({ reason: "append", message: `append ${path}` }, async (b) => {
        await b.append(path, content);
      });
    },

    async delete(path: MemoryPath) {
      await store.batch({ reason: "delete", message: `delete ${path}` }, async (b) => {
        await b.delete(path);
      });
    },

    async rename(src: MemoryPath, dst: MemoryPath) {
      await store.batch({ reason: "rename", message: `rename ${src} -> ${dst}` }, async (b) => {
        await b.rename(src, dst);
      });
    },

    // Batch: delegate to filesystem, then commit + push
    async batch(opts: BatchOptions, fn: (batch: MemoryBatch) => Promise<void>) {
      await fs.batch(opts, fn);
      await commitAndPush(opts);
    },
  };

  return store;
}
