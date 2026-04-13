import { access } from "node:fs/promises";
import { join } from "node:path";
import { createFilesystemStore } from "./filesystem.js";
import { createGitStore } from "./git.js";
import type { MemoryStore } from "./types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type AutodetectOptions = {
  root: string;
  author?: string;
  email?: string;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createAutodetectedStore(options: AutodetectOptions): Promise<MemoryStore> {
  const { root, author, email } = options;

  const isGitRepo = await hasGitDir(root);

  if (isGitRepo) {
    return createGitStore({ root, autoPush: true, author, email });
  }

  return createFilesystemStore({ root });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hasGitDir(root: string): Promise<boolean> {
  try {
    await access(join(root, ".git"));
    return true;
  } catch {
    return false;
  }
}
