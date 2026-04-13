/**
 * Derive a kebab-case project slug from a git remote URL.
 *
 * Handles SSH (`git@host:org/repo.git`) and HTTPS (`https://host/org/repo.git`) formats.
 */
export function deriveProjectSlug(gitRemoteUrl: string): string {
  const cleaned = gitRemoteUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");

  // SSH format: git@github.com:org/repo
  const sshMatch = cleaned.match(/^[^@]+@[^:]+:(.+)$/);
  if (sshMatch?.[1]) {
    return slugify(sshMatch[1]);
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
