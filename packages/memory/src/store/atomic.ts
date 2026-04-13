import { randomBytes } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Write content to a file atomically using temp-file + rename.
 *
 * Creates parent directories if they do not exist, fsyncs the file and
 * its parent directory so the write survives an unexpected power loss.
 */
export async function atomicWrite(filePath: string, content: Uint8Array): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const suffix = randomBytes(6).toString("hex");
  const tmpPath = join(dir, `.memory-tmp-${suffix}`);

  let fd: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fd = await open(tmpPath, "w");
    await fd.writeFile(content);
    await fd.sync();
    await fd.close();
    fd = undefined;

    await rename(tmpPath, filePath);

    const dirFd = await open(dir, "r");
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  } catch (err) {
    if (fd) {
      await fd.close().catch(() => {});
    }
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}
