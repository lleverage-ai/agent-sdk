/**
 * Derive a kebab-case project slug from a git remote URL.
 *
 * Handles SCP-style SSH (`git@host:org/repo.git`), URL-form SSH
 * (`ssh://git@host/org/repo.git`), and HTTPS (`https://host/org/repo.git`) formats.
 *
 * @param gitRemoteUrl - The git remote URL to derive a slug from
 * @returns A kebab-case slug suitable for use as a directory name
 *
 * @category Utilities
 */
export function deriveProjectSlug(gitRemoteUrl: string): string {
  const cleaned = gitRemoteUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");

  // SCP-style SSH format: git@github.com:org/repo
  const sshMatch = cleaned.match(/^[^@]+@[^:]+:(.+)$/);
  if (sshMatch?.[1]) {
    return slugify(sshMatch[1]);
  }

  // URL-form SSH format: ssh://git@github.com/org/repo
  const sshUrlMatch = cleaned.match(/^ssh:\/\/[^/]+\/(.+)$/);
  if (sshUrlMatch?.[1]) {
    return slugify(sshUrlMatch[1]);
  }

  // HTTPS format: https://github.com/org/repo
  const httpsMatch = cleaned.match(/^https?:\/\/[^/]+\/(.+)$/);
  if (httpsMatch?.[1]) {
    return slugify(httpsMatch[1]);
  }

  // Fallback: treat the whole thing as the path
  return slugify(cleaned);
}

function slugify(pathSegment: string): string {
  return pathSegment
    .split("/")
    .filter((s) => s.length > 0)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
