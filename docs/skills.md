# Skills System

The Agent SDK provides a comprehensive skills system aligned with the [Agent Skills specification](https://agentskills.io/specification). Skills enable progressive disclosure of capabilities, allowing agents to load specialized tools and instructions on-demand.

## Overview

Skills come in two forms:

1. **Programmatic Skills** - TypeScript objects with inline tools and instructions
2. **File-Based Skills** - SKILL.md files following the Agent Skills specification

Both forms share the same core metadata structure defined by the Agent Skills spec.

## Table of Contents

- [Programmatic Skills](#programmatic-skills)
- [File-Based Skills](#file-based-skills)
- [Progressive Disclosure](#progressive-disclosure)
- [Skill Registry](#skill-registry)
- [Agent Skills Specification Compliance](#agent-skills-specification-compliance)
- [Examples](#examples)

## Programmatic Skills

Programmatic skills are TypeScript objects that bundle tools and instructions together. They're ideal for skills that are tightly coupled with your application code.

### Basic Skill Definition

```typescript
import { defineSkill } from "@lleverage-ai/agent-sdk";
import { tool } from "ai";
import { z } from "zod";

const gitSkill = defineSkill({
  name: "git",
  description: "Git version control operations. Use when working with repositories.",
  instructions: "You have access to Git tools. Always check status before committing.",
  tools: {
    git_status: tool({
      description: "Check git repository status",
      inputSchema: z.object({}),
      execute: async () => {
        // Implementation
        return "On branch main...";
      },
    }),
  },
});
```

### Using with Plugins

Skills are often bundled with plugins for reusability:

```typescript
import { definePlugin, defineSkill } from "@lleverage-ai/agent-sdk";

const databaseSkill = defineSkill({
  name: "database",
  description: "Query and manage database",
  instructions: `
Available tables: users, products, orders.
Always use getSchema to see column types before querying.
Use parameterized queries to prevent SQL injection.
  `,
});

const databasePlugin = definePlugin({
  name: "database",
  tools: {
    query: tool({ /* ... */ }),
    getSchema: tool({ /* ... */ }),
  },
  skills: [databaseSkill],
});
```

## File-Based Skills

File-based skills follow the [Agent Skills specification](https://agentskills.io/specification). They consist of a `SKILL.md` file with YAML frontmatter and Markdown instructions.

### Directory Structure

```
skills/
├── git/
│   ├── SKILL.md          # Required: Frontmatter + instructions
│   ├── scripts/          # Optional: Executable scripts
│   │   ├── status.sh
│   │   └── commit.py
│   ├── references/       # Optional: Additional documentation
│   │   └── REFERENCE.md
│   └── assets/          # Optional: Templates, schemas, data
│       └── template.json
└── pdf-processing/
    └── SKILL.md
```

### SKILL.md Format

```markdown
---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF documents.
license: MIT
compatibility: Requires Python 3.8+ and PyPDF2
metadata:
  author: acme-corp
  version: "1.0.0"
  category: document-processing
---

# PDF Processing

This skill provides tools for working with PDF files.

## Capabilities

1. **Extract text** - Extract text content from PDFs
2. **Fill forms** - Populate PDF form fields
3. **Merge PDFs** - Combine multiple PDFs into one
4. **Split PDFs** - Separate pages into individual files

## Usage

Scripts in `scripts/` directory:
- `extract.py` - Extract text from a PDF
- `merge.sh` - Merge multiple PDFs

See `references/REFERENCE.md` for detailed API documentation.
```

### Loading Skills from Disk

```typescript
import { loadSkillsFromDirectories, createAgent } from "@lleverage-ai/agent-sdk";

// Load skills from multiple directories
const result = await loadSkillsFromDirectories([
  "/path/to/project-skills",
  "/home/user/.skills",
  "./local-skills",
]);

console.log(`Loaded ${result.skills.length} skills`);
console.log(`Errors: ${result.errors.length}`);

// Handle errors gracefully
for (const error of result.errors) {
  console.error(`Failed to load ${error.path}:`);
  console.error(`  ${error.error}`);
}

// Agent auto-creates registry and skill tool
const agent = createAgent({
  model,
  skills: result.skills,
});
```

### Loading a Single Skill

```typescript
import { loadSkillFromDirectory } from "@lleverage-ai/agent-sdk";

const skill = await loadSkillFromDirectory("/path/to/skills/git");

console.log(`Loaded: ${skill.name}`);
console.log(`Instructions: ${skill.instructions}`);
console.log(`License: ${skill.license}`);

// Access discovered resources
const scripts = getSkillScripts(skill);      // ["status.sh", "commit.py"]
const references = getSkillReferences(skill); // ["REFERENCE.md"]
const assets = getSkillAssets(skill);         // ["template.json"]
```

### Accessing Skill Resources

```typescript
import { getSkillResourcePath } from "@lleverage-ai/agent-sdk";
import { readFile } from "node:fs/promises";

// Get path to a script
const scriptPath = getSkillResourcePath(skill, "scripts", "extract.py");

// Read a reference document
const refPath = getSkillResourcePath(skill, "references", "REFERENCE.md");
const reference = await readFile(refPath, "utf-8");

// Load a template
const templatePath = getSkillResourcePath(skill, "assets", "template.json");
const template = JSON.parse(await readFile(templatePath, "utf-8"));
```

## Progressive Disclosure

The skills system implements three levels of progressive disclosure, aligned with the Agent Skills specification:

### Level 1: Metadata (~100 tokens)

Only `name` and `description` are loaded initially for skill discovery.

```typescript
const registry = new SkillRegistry({ skills: allSkills });

// Agent sees only name + description
const available = registry.listAvailable();
// [
//   { name: "git", description: "Git version control operations..." },
//   { name: "docker", description: "Container management..." },
// ]
```

### Level 2: Instructions (<5000 tokens)

Full instructions and tools are loaded when the skill is activated.

```typescript
// Agent decides to load the git skill
const result = registry.load("git");

// Now has access to:
// - result.tools (inline tools)
// - result.instructions (Markdown body from SKILL.md)
```

### Level 3: Resources (On-Demand)

Scripts, references, and assets are accessed only when needed.

```typescript
// Agent can read scripts when needed
const scriptPath = getSkillResourcePath(skill, "scripts", "deploy.sh");
// Agent uses read/bash tools to access: "/path/to/skills/git/scripts/deploy.sh"

// Agent can read additional references
const refPath = getSkillResourcePath(skill, "references", "API.md");
// Agent uses read tool to load detailed documentation
```

## Skill Registry

The `SkillRegistry` manages available and loaded skills, enabling progressive disclosure.

### Creating a Registry

```typescript
import { SkillRegistry } from "@lleverage-ai/agent-sdk";

const registry = new SkillRegistry({
  skills: [gitSkill, dockerSkill, kubernetesSkill],
  onSkillLoaded: (name, result) => {
    console.log(`Loaded skill: ${name}`);
    console.log(`Tools: ${Object.keys(result.tools).join(", ")}`);
  },
});
```

### Registry Operations

```typescript
// Register additional skills
registry.register(newSkill);

// Check if skill exists
if (registry.has("git")) {
  console.log("Git skill is available");
}

// Check if skill is loaded
if (registry.isLoaded("git")) {
  console.log("Git skill is active");
}

// List available (unloaded) skills
const available = registry.listAvailable();

// List loaded skills
const loaded = registry.listLoaded();

// List all skills
const all = registry.listAll();

// Load a skill
const result = registry.load("git");
if (result.success) {
  // Inject tools and instructions into agent
}

// Unregister a skill
registry.unregister("old-skill");

// Reset all skills to unloaded state
registry.reset();
```

### Creating a Skill Tool

The skill tool allows agents to load skills on-demand during conversations.

```typescript
import { createSkillTool } from "@lleverage-ai/agent-sdk";

const skillTool = createSkillTool({ registry });

const agent = createAgent({
  model,
  tools: {
    ...coreTools,
    load_skill: skillTool,
  },
});

// Agent can now call load_skill to gain new capabilities
```

## Agent Skills Specification Compliance

The SDK fully implements the [Agent Skills specification](https://agentskills.io/specification) v1.0.

### Frontmatter Fields

All required and optional fields from the spec are supported:

| Field | Required | Constraints | Description |
|-------|----------|-------------|-------------|
| `name` | Yes | 1-64 chars, lowercase + hyphens only | Unique skill identifier |
| `description` | Yes | 1-1024 chars | What the skill does and when to use it |
| `license` | No | - | License name or reference |
| `compatibility` | No | Max 500 chars | Environment requirements |
| `metadata` | No | Key-value pairs | Arbitrary additional metadata |

### Validation Rules

The loader validates all spec requirements:

**Name validation:**
- ✅ 1-64 characters
- ✅ Lowercase letters, numbers, and hyphens only
- ✅ Must not start or end with hyphen
- ✅ Must not contain consecutive hyphens (`--`)
- ✅ Must match directory name

**Description validation:**
- ✅ 1-1024 characters
- ✅ Must describe capabilities and use cases

**Compatibility validation:**
- ✅ Maximum 500 characters

**Metadata validation:**
- ✅ String key-value pairs only

### Error Handling

```typescript
const result = await loadSkillsFromDirectories(["/path/to/skills"]);

// Check for validation errors
for (const error of result.errors) {
  console.error(`${error.path}: ${error.error}`);

  // Common errors:
  // - "SKILL.md not found"
  // - "Invalid YAML frontmatter"
  // - "Skill name must only contain lowercase letters..."
  // - "Description must be 1-1024 characters"
  // - "Name does not match directory name"
}
```

## Examples

### Example 1: GitHub Operations Skill

```typescript
// Programmatic skill
import { defineSkill } from "@lleverage-ai/agent-sdk";
import { tool } from "ai";
import { z } from "zod";

const githubSkill = defineSkill({
  name: "github",
  description: "GitHub operations for issues, PRs, and repositories",
  license: "MIT",
  compatibility: "Requires GitHub CLI (gh) installed",
  metadata: {
    author: "your-org",
    version: "1.0",
  },
  instructions: `
You have access to GitHub operations.

Available commands:
- list_issues: List issues for a repository
- create_pr: Create a pull request
- get_repo_info: Get repository information

Always verify repository access before performing operations.
  `,
  tools: {
    list_issues: tool({
      description: "List GitHub issues",
      inputSchema: z.object({
        repo: z.string().describe("Repository (owner/repo)"),
        state: z.enum(["open", "closed", "all"]).default("open"),
      }),
      execute: async ({ repo, state }) => {
        // Implementation using GitHub API
        return { issues: [] };
      },
    }),
  },
});
```

### Example 2: PDF Processing File-Based Skill

Create `skills/pdf-processing/SKILL.md`:

```markdown
---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, and merge documents. Use when working with PDF files.
license: Apache-2.0
compatibility: Requires Python 3.8+, PyPDF2, and pdfplumber
metadata:
  author: acme-corp
  version: "2.1.0"
  category: document-processing
---

# PDF Processing Skill

Comprehensive PDF manipulation capabilities.

## Features

### 1. Text Extraction
Extract text content from PDF files while preserving formatting.

**Script:** `scripts/extract_text.py`

### 2. Table Extraction
Extract tables from PDFs into CSV or JSON format.

**Script:** `scripts/extract_tables.py`

### 3. Form Filling
Populate PDF form fields programmatically.

**Script:** `scripts/fill_form.py`

### 4. PDF Merging
Combine multiple PDF files into a single document.

**Script:** `scripts/merge_pdfs.py`

## Usage

All scripts accept a `-h` flag for detailed help.

Example:
```bash
python scripts/extract_text.py input.pdf output.txt
```

See `references/REFERENCE.md` for complete API documentation.
```

Load and use:

```typescript
const skill = await loadSkillFromDirectory("./skills/pdf-processing");
const registry = new SkillRegistry({ skills: [skill] });

// Agent can now load the skill when needed
const result = registry.load("pdf-processing");
```

### Example 3: Loading Skills at Runtime

```typescript
import { loadSkillsFromDirectories, createAgent } from "@lleverage-ai/agent-sdk";

// Load skills from multiple directories
const { skills, errors } = await loadSkillsFromDirectories([
  "/usr/local/skills",
  "/home/user/.skills",
  "./project-skills",
]);

// Log any errors
errors.forEach(e => console.error(`Skill error: ${e.path} - ${e.error}`));

// Agent auto-creates registry and skill tool
const agent = createAgent({
  model,
  skills, // That's it!
  systemPrompt: `
You are a helpful assistant with access to specialized skills.
Use the load_skill tool to gain new capabilities on-demand.
  `,
});
```

## Best Practices

### 1. Skill Naming

- Use descriptive, lowercase names with hyphens
- Match skill name to directory name for file-based skills
- Keep names concise (under 30 characters)

**Good:** `pdf-processing`, `git-ops`, `data-analysis`
**Bad:** `PDF_Processing`, `git`, `skill1`

### 2. Descriptions

- Include what the skill does AND when to use it
- Add relevant keywords for agent discovery
- Keep under 1024 characters

```typescript
// Good description
description: "Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF documents or when user mentions PDFs, forms, or document extraction."

// Poor description
description: "PDF stuff"
```

### 3. Instructions

- Provide clear, actionable guidance
- List available capabilities
- Include usage examples
- Mention important constraints or requirements

### 4. Progressive Disclosure

- Keep metadata minimal (name + description only)
- Put detailed docs in `references/` not main instructions
- Use scripts for complex operations
- Load heavy resources on-demand

### 5. Skill Organization

```
skills/
├── core/           # Fundamental skills (git, bash, docker)
├── domain/         # Domain-specific (pdf, data, cloud)
└── internal/       # Organization-specific skills
```

### 6. Testing Skills

```typescript
import { describe, it, expect } from "vitest";
import { loadSkillFromDirectory } from "@lleverage-ai/agent-sdk";

describe("PDF Processing Skill", () => {
  it("should load successfully", async () => {
    const skill = await loadSkillFromDirectory("./skills/pdf-processing");

    expect(skill.name).toBe("pdf-processing");
    expect(skill.description).toBeTruthy();
    expect(skill.instructions).toBeTruthy();
  });

  it("should discover all scripts", async () => {
    const skill = await loadSkillFromDirectory("./skills/pdf-processing");
    const scripts = getSkillScripts(skill);

    expect(scripts).toContain("extract_text.py");
    expect(scripts).toContain("merge_pdfs.py");
  });
});
```

## API Reference

See the [API documentation](../docs/api-reference.md) for complete details on:

- `defineSkill()` - Create programmatic skills
- `SkillRegistry` - Manage skill lifecycle
- `createSkillTool()` - Create skill loading tool
- `loadSkillsFromDirectories()` - Load file-based skills
- `loadSkillFromDirectory()` - Load a single skill
- `getSkillScripts()` - Access skill scripts
- `getSkillReferences()` - Access reference docs
- `getSkillAssets()` - Access skill assets
- `getSkillResourcePath()` - Get full paths to resources
