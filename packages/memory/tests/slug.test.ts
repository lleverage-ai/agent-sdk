import { describe, expect, it } from "vitest";
import { deriveProjectSlug } from "../src/slug.js";

describe("deriveProjectSlug", () => {
  it("handles SCP-style SSH remote", () => {
    expect(deriveProjectSlug("git@github.com:org/repo.git")).toBe("org-repo");
  });

  it("handles SCP-style SSH without .git suffix", () => {
    expect(deriveProjectSlug("git@github.com:org/repo")).toBe("org-repo");
  });

  it("handles URL-form SSH remote", () => {
    expect(deriveProjectSlug("ssh://git@github.com/org/repo.git")).toBe("org-repo");
  });

  it("handles URL-form SSH without .git suffix", () => {
    expect(deriveProjectSlug("ssh://git@github.com/org/repo")).toBe("org-repo");
  });

  it("handles HTTPS remote", () => {
    expect(deriveProjectSlug("https://github.com/org/repo.git")).toBe("org-repo");
  });

  it("handles HTTPS without .git suffix", () => {
    expect(deriveProjectSlug("https://github.com/org/repo")).toBe("org-repo");
  });

  it("handles trailing slashes", () => {
    expect(deriveProjectSlug("https://github.com/org/repo/")).toBe("org-repo");
  });

  it("handles whitespace around URL", () => {
    expect(deriveProjectSlug("  git@github.com:org/repo.git  ")).toBe("org-repo");
  });

  it("handles nested paths", () => {
    expect(deriveProjectSlug("https://github.com/org/sub/repo.git")).toBe("org-sub-repo");
  });

  it("lowercases the result", () => {
    expect(deriveProjectSlug("git@github.com:MyOrg/MyRepo.git")).toBe("myorg-myrepo");
  });

  it("strips special characters", () => {
    expect(deriveProjectSlug("git@github.com:org/my_repo.test.git")).toBe("org-my-repo-test");
  });

  it("falls back to slugified input for unknown formats", () => {
    const result = deriveProjectSlug("some-random-string");
    expect(result).toBe("some-random-string");
  });
});
