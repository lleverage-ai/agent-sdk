/**
 * Tests for file-based skill loader.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getSkillAssets,
  getSkillReferences,
  getSkillResourcePath,
  getSkillScripts,
  loadSkillFromDirectory,
  loadSkillsFromDirectories,
} from "../src/skills/loader.js";

// Test fixtures directory
const TEST_DIR = join(tmpdir(), "agent-sdk-skill-loader-tests");

describe("Skill Loader", () => {
  beforeEach(async () => {
    // Clean up test directory
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  describe("loadSkillFromDirectory", () => {
    it("should load a minimal valid skill", async () => {
      const skillDir = join(TEST_DIR, "minimal-skill");
      await mkdir(skillDir);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: minimal-skill
description: A minimal test skill
---

This is the skill instructions.`,
      );

      const skill = await loadSkillFromDirectory(skillDir);

      expect(skill.name).toBe("minimal-skill");
      expect(skill.description).toBe("A minimal test skill");
      expect(skill.instructions).toBe("This is the skill instructions.");
      expect(skill.skillPath).toBe(skillDir);
    });

    it("should load skill with all optional fields", async () => {
      const skillDir = join(TEST_DIR, "full-skill");
      await mkdir(skillDir);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: full-skill
description: A skill with all fields
license: MIT
compatibility: Requires git and docker
metadata:
  author: test-author
  version: "1.0.0"
  category: development
---

# Full Skill Instructions

This skill has all optional fields.`,
      );

      const skill = await loadSkillFromDirectory(skillDir);

      expect(skill.name).toBe("full-skill");
      expect(skill.description).toBe("A skill with all fields");
      expect(skill.license).toBe("MIT");
      expect(skill.compatibility).toBe("Requires git and docker");
      expect(skill.metadata).toEqual({
        author: "test-author",
        version: "1.0.0",
        category: "development",
      });
      expect(skill.instructions).toContain("Full Skill Instructions");
    });

    it("should discover scripts directory", async () => {
      const skillDir = join(TEST_DIR, "skill-with-scripts");
      await mkdir(skillDir);
      await mkdir(join(skillDir, "scripts"));
      await writeFile(join(skillDir, "scripts", "deploy.sh"), "#!/bin/bash\necho 'deploying'");
      await writeFile(join(skillDir, "scripts", "test.py"), "print('testing')");
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: skill-with-scripts
description: Has scripts
---

Use the scripts.`,
      );

      const skill = await loadSkillFromDirectory(skillDir);

      expect(skill.metadata?.scripts).toBe("deploy.sh,test.py");
      expect(getSkillScripts(skill)).toEqual(["deploy.sh", "test.py"]);
    });

    it("should discover references directory", async () => {
      const skillDir = join(TEST_DIR, "skill-with-refs");
      await mkdir(skillDir);
      await mkdir(join(skillDir, "references"));
      await writeFile(join(skillDir, "references", "REFERENCE.md"), "# Reference");
      await writeFile(join(skillDir, "references", "api-spec.md"), "# API Spec");
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: skill-with-refs
description: Has references
---

See references for details.`,
      );

      const skill = await loadSkillFromDirectory(skillDir);

      expect(skill.metadata?.references).toBe("REFERENCE.md,api-spec.md");
      expect(getSkillReferences(skill)).toEqual(["REFERENCE.md", "api-spec.md"]);
    });

    it("should discover assets directory", async () => {
      const skillDir = join(TEST_DIR, "skill-with-assets");
      await mkdir(skillDir);
      await mkdir(join(skillDir, "assets"));
      await writeFile(join(skillDir, "assets", "template.json"), '{"key": "value"}');
      await writeFile(join(skillDir, "assets", "schema.yaml"), "type: object");
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: skill-with-assets
description: Has assets
---

Use the templates.`,
      );

      const skill = await loadSkillFromDirectory(skillDir);

      expect(skill.metadata?.assets).toBe("schema.yaml,template.json");
      expect(getSkillAssets(skill)).toEqual(["schema.yaml", "template.json"]);
    });

    it("should throw if SKILL.md is missing", async () => {
      const skillDir = join(TEST_DIR, "no-skill-md");
      await mkdir(skillDir);

      await expect(loadSkillFromDirectory(skillDir)).rejects.toThrow("SKILL.md not found");
    });

    it("should throw if frontmatter is invalid", async () => {
      const skillDir = join(TEST_DIR, "invalid-frontmatter");
      await mkdir(skillDir);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `No frontmatter here!

Just plain markdown.`,
      );

      await expect(loadSkillFromDirectory(skillDir)).rejects.toThrow("missing YAML frontmatter");
    });

    it("should throw if name is missing", async () => {
      const skillDir = join(TEST_DIR, "no-name");
      await mkdir(skillDir);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
description: Missing name field
---

Content`,
      );

      await expect(loadSkillFromDirectory(skillDir)).rejects.toThrow(
        "missing required field: name",
      );
    });

    it("should throw if description is missing", async () => {
      const skillDir = join(TEST_DIR, "no-description");
      await mkdir(skillDir);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: no-description
---

Content`,
      );

      await expect(loadSkillFromDirectory(skillDir)).rejects.toThrow(
        "missing required field: description",
      );
    });
  });

  describe("Validation", () => {
    it("should reject name with uppercase letters", async () => {
      const skillDir = join(TEST_DIR, "InvalidName");
      await mkdir(skillDir);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: InvalidName
description: Has uppercase
---

Content`,
      );

      await expect(loadSkillFromDirectory(skillDir)).rejects.toThrow(
        "must only contain lowercase letters",
      );
    });

    it("should reject name starting with hyphen", async () => {
      const skillDir = join(TEST_DIR, "-bad-name");
      await mkdir(skillDir);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: -bad-name
description: Starts with hyphen
---

Content`,
      );

      await expect(loadSkillFromDirectory(skillDir)).rejects.toThrow(
        "must not start or end with hyphen",
      );
    });

    it("should reject name with consecutive hyphens", async () => {
      const skillDir = join(TEST_DIR, "bad--name");
      await mkdir(skillDir);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: bad--name
description: Has consecutive hyphens
---

Content`,
      );

      await expect(loadSkillFromDirectory(skillDir)).rejects.toThrow(
        "must not contain consecutive hyphens",
      );
    });

    it("should reject name that doesn't match directory", async () => {
      const skillDir = join(TEST_DIR, "correct-dir");
      await mkdir(skillDir);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: wrong-name
description: Name mismatch
---

Content`,
      );

      await expect(loadSkillFromDirectory(skillDir)).rejects.toThrow(
        "does not match directory name",
      );
    });

    it("should reject description over 1024 chars", async () => {
      const skillDir = join(TEST_DIR, "long-desc");
      await mkdir(skillDir);
      const longDesc = "x".repeat(1025);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: long-desc
description: ${longDesc}
---

Content`,
      );

      await expect(loadSkillFromDirectory(skillDir)).rejects.toThrow("must be 1-1024 characters");
    });

    it("should reject compatibility over 500 chars", async () => {
      const skillDir = join(TEST_DIR, "long-compat");
      await mkdir(skillDir);
      const longCompat = "x".repeat(501);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: long-compat
description: Has long compatibility
compatibility: ${longCompat}
---

Content`,
      );

      await expect(loadSkillFromDirectory(skillDir)).rejects.toThrow("must be max 500 characters");
    });

    it("should allow disabling validation", async () => {
      const skillDir = join(TEST_DIR, "InvalidName");
      await mkdir(skillDir);
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: InvalidName
description: Has uppercase
---

Content`,
      );

      // Should not throw with validation disabled
      const skill = await loadSkillFromDirectory(skillDir, { validate: false });
      expect(skill.name).toBe("InvalidName");
    });
  });

  describe("loadSkillsFromDirectories", () => {
    it("should load multiple skills from a directory", async () => {
      // Create skills directory with multiple skills
      const skillsDir = join(TEST_DIR, "skills");
      await mkdir(skillsDir);

      // Skill 1
      const skill1Dir = join(skillsDir, "skill-one");
      await mkdir(skill1Dir);
      await writeFile(
        join(skill1Dir, "SKILL.md"),
        `---
name: skill-one
description: First skill
---

Instructions for skill one.`,
      );

      // Skill 2
      const skill2Dir = join(skillsDir, "skill-two");
      await mkdir(skill2Dir);
      await writeFile(
        join(skill2Dir, "SKILL.md"),
        `---
name: skill-two
description: Second skill
---

Instructions for skill two.`,
      );

      const result = await loadSkillsFromDirectories([skillsDir]);

      expect(result.skills).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(result.skills.map((s) => s.name).sort()).toEqual(["skill-one", "skill-two"]);
    });

    it("should load from multiple directories", async () => {
      // Directory 1
      const dir1 = join(TEST_DIR, "dir1");
      await mkdir(dir1);
      const skill1Dir = join(dir1, "skill-a");
      await mkdir(skill1Dir);
      await writeFile(
        join(skill1Dir, "SKILL.md"),
        `---
name: skill-a
description: Skill A
---

A`,
      );

      // Directory 2
      const dir2 = join(TEST_DIR, "dir2");
      await mkdir(dir2);
      const skill2Dir = join(dir2, "skill-b");
      await mkdir(skill2Dir);
      await writeFile(
        join(skill2Dir, "SKILL.md"),
        `---
name: skill-b
description: Skill B
---

B`,
      );

      const result = await loadSkillsFromDirectories([dir1, dir2]);

      expect(result.skills).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(result.skills.map((s) => s.name).sort()).toEqual(["skill-a", "skill-b"]);
    });

    it("should collect errors for invalid skills", async () => {
      const skillsDir = join(TEST_DIR, "mixed");
      await mkdir(skillsDir);

      // Valid skill
      const validDir = join(skillsDir, "valid");
      await mkdir(validDir);
      await writeFile(
        join(validDir, "SKILL.md"),
        `---
name: valid
description: Valid skill
---

Good`,
      );

      // Invalid skill (missing SKILL.md)
      const invalidDir = join(skillsDir, "invalid");
      await mkdir(invalidDir);

      // Invalid skill (bad name)
      const badNameDir = join(skillsDir, "BadName");
      await mkdir(badNameDir);
      await writeFile(
        join(badNameDir, "SKILL.md"),
        `---
name: BadName
description: Invalid name
---

Bad`,
      );

      const result = await loadSkillsFromDirectories([skillsDir]);

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("valid");
      expect(result.errors).toHaveLength(2);
      expect(result.errors.some((e) => e.error.includes("SKILL.md not found"))).toBe(true);
      expect(result.errors.some((e) => e.error.includes("lowercase letters"))).toBe(true);
    });

    it("should skip hidden directories by default", async () => {
      const skillsDir = join(TEST_DIR, "with-hidden");
      await mkdir(skillsDir);

      // Regular skill
      const regularDir = join(skillsDir, "regular");
      await mkdir(regularDir);
      await writeFile(
        join(regularDir, "SKILL.md"),
        `---
name: regular
description: Regular skill
---

Regular`,
      );

      // Hidden skill
      const hiddenDir = join(skillsDir, ".hidden");
      await mkdir(hiddenDir);
      await writeFile(
        join(hiddenDir, "SKILL.md"),
        `---
name: .hidden
description: Hidden skill
---

Hidden`,
      );

      const result = await loadSkillsFromDirectories([skillsDir]);

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("regular");
    });

    it("should include hidden directories when requested", async () => {
      const skillsDir = join(TEST_DIR, "with-hidden-2");
      await mkdir(skillsDir);

      // Hidden skill
      const hiddenDir = join(skillsDir, ".hidden");
      await mkdir(hiddenDir);
      await writeFile(
        join(hiddenDir, "SKILL.md"),
        `---
name: .hidden
description: Hidden skill
---

Hidden`,
      );

      const result = await loadSkillsFromDirectories([skillsDir], { includeHidden: true });

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe(".hidden");
    });
  });

  describe("Utility functions", () => {
    it("should get skill resource path", async () => {
      const skillDir = join(TEST_DIR, "util-test");
      await mkdir(skillDir);
      await mkdir(join(skillDir, "scripts"));
      await writeFile(join(skillDir, "scripts", "test.sh"), "#!/bin/bash");
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: util-test
description: Test utilities
---

Test`,
      );

      const skill = await loadSkillFromDirectory(skillDir);

      const scriptPath = getSkillResourcePath(skill, "scripts", "test.sh");
      expect(scriptPath).toBe(join(skillDir, "scripts", "test.sh"));
    });

    it("should throw if skill has no skillPath", () => {
      const skill = {
        name: "no-path",
        description: "No path",
      };

      expect(() => getSkillResourcePath(skill, "scripts", "test.sh")).toThrow(
        "does not have a skillPath",
      );
    });
  });
});
