import { createFilesystemStore } from "./filesystem.js";
import { createGitStore, hasGitDir } from "./git.js";
import type { MemoryStore } from "./types.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Configuration for autodetected store creation. */
export interface AutodetectOptions {
  /** Root directory for memory storage. */
  root: string;
  /** Git author name for commit attribution. */
  author?: string;
  /** Git author email for commit attribution. */
  email?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a {@link MemoryStore} by detecting the environment.
 *
 * Returns a {@link createGitStore | GitStore} if a `.git` directory exists
 * at the root, otherwise falls back to a {@link createFilesystemStore | FilesystemStore}.
 *
 * @param options - Configuration including root directory and optional git author
 * @returns A configured MemoryStore appropriate for the environment
 */
export async function createAutodetectedStore(options: AutodetectOptions): Promise<MemoryStore> {
  const { root, author, email } = options;

  const isGitRepo = await hasGitDir(root);

  if (isGitRepo) {
    return createGitStore({ root, autoPush: true, author, email });
  }

  return createFilesystemStore({ root });
}
