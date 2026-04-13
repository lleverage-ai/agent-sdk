/**
 * Converts a glob pattern to a RegExp.
 *
 * Supports `*` (any non-slash chars), `**` (any chars including slash), and `?` (single non-slash char).
 *
 * @param pattern - The glob pattern
 * @returns A RegExp that matches the full string against the pattern
 */
export function globToRegex(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i += 2;
      if (pattern[i] === "/") i++;
    } else if (ch === "*") {
      re += "[^/]*";
      i++;
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}
