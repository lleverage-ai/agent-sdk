# Security & Production

> **Warning**: Default agent settings are permissive to enable rapid development. For production deployments, you should explicitly apply security policies to prevent unauthorized operations.

## Quick Production Setup

The easiest way to create a production-ready agent is using `createProductionAgent()`, which combines security, observability, and recommended hooks in a single function:

```typescript
import { createProductionAgent } from "@lleverage-ai/agent-sdk";
import { anthropic } from "@ai-sdk/anthropic";

// One-line production agent setup
const { agent, observability } = createProductionAgent({
  model: anthropic("claude-sonnet-4-20250514"),
});

// Access observability primitives
observability.logger?.info("Agent started");
observability.metrics?.requests.inc();
```

This function automatically configures:

- **Security**: Production security preset (backend with command blocking, permissions, tool restrictions)
- **Observability**: Logging, metrics, and tracing with hooks
- **Secrets filtering**: Prevents credential leakage in logs and responses
- **Optional guardrails**: Content filtering for input/output validation

### Customization

```typescript
const { agent, observability } = createProductionAgent({
  model: anthropic("claude-sonnet-4-20250514"),

  // Customize security
  securityPreset: "readonly", // Maximum restrictions
  securityOverrides: {
    permissionMode: "approval-required",
  },

  // Customize observability
  observabilityOptions: {
    name: "my-agent",
    loggerOptions: { level: "warn" },
    enableTracing: false,
  },

  // Enable guardrails
  enableGuardrails: true,
  blockedInputPatterns: [/ignore.*instructions/i],
  blockedOutputPatterns: [/\d{3}-\d{2}-\d{4}/], // SSN pattern

  // Add custom options
  additionalOptions: {
    systemPrompt: "You are a helpful assistant.",
    checkpointer: createMemorySaver(),
  },
});
```

## Security Policy Presets

The SDK provides four security policy presets that bundle backend configuration, permission modes, and tool restrictions:

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";
import { applySecurityPolicy } from "@lleverage-ai/agent-sdk/security";

// Production preset: balanced security for production deployments
const agent = createAgent({
  model,
  ...applySecurityPolicy("production"),
});
```

**Available presets:**

| Preset | Description |
|--------|-------------|
| `"development"` | Permissive settings for rapid iteration (allows all operations) |
| `"ci"` | Restrictive settings for CI/CD (blocks network operations, plan mode only) |
| `"production"` | Balanced settings for production (blocks destructive operations, limited timeouts) |
| `"readonly"` | Maximum restrictions (no writes, no commands, read-only access) |

## Guardrails Hooks

Protect against harmful input and filter sensitive output:

```typescript
import { createGuardrailsHooks } from "@lleverage-ai/agent-sdk/hooks";

const agent = createAgent({
  model,
  hooks: createGuardrailsHooks({
    blockedInputPatterns: [
      /ignore\s+previous\s+instructions/i, // Prompt injection
      /system\s+prompt/i, // System prompt extraction
    ],
    blockedOutputPatterns: [
      /\d{3}-\d{2}-\d{4}/g, // SSN
      /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/g, // Credit card
    ],
    blockedInputMessage: "Request blocked by content policy",
    filteredOutputMessage: "[Content filtered]",
  }),
});
```

## Secrets Filtering

Prevent credential leakage in logs and responses:

```typescript
import {
  createSecretsFilterHooks,
  COMMON_SECRET_PATTERNS,
} from "@lleverage-ai/agent-sdk/hooks";

const agent = createAgent({
  model,
  hooks: createSecretsFilterHooks({
    patterns: Object.values(COMMON_SECRET_PATTERNS),
    customPatterns: [/my-api-key-[A-Za-z0-9]+/g],
    redactionText: "[REDACTED]",
    onSecretDetected: (type, pattern, context) => {
      console.warn(`Secret detected in ${type}:`, pattern);
    },
  }),
});
```

**Built-in secret patterns:**

- AWS access keys and secrets
- GitHub tokens (personal access, OAuth)
- JWT tokens
- Private keys (PEM format)
- Slack, Stripe, and other common API keys
- Password and secret variables

## Tool Restrictions

Disable dangerous tools in production:

```typescript
const agent = createAgent({
  model,
  // Explicitly disable core tools that allow code execution or file writes
  disabledCoreTools: ["bash", "write", "edit"],

  // Or use allowlist approach
  allowedTools: ["read", "glob", "grep", "search_tools"],
});
```

## Permission Mode: acceptEdits with Bash Safety

The `acceptEdits` permission mode auto-approves `write` and `edit` tool calls, but **shell commands can still perform file writes** (e.g., `echo > file`, `rm`, `mv`), creating a security gap.

To close this gap, use `applySecurityPolicy()` with `acceptEdits` mode — it automatically configures the backend to block shell-based file operations:

```typescript
import { applySecurityPolicy } from "@lleverage-ai/agent-sdk/security";

// acceptEdits mode with shell file operation blocking (default behavior)
const agent = createAgent({
  model,
  ...applySecurityPolicy("development", {
    permissionMode: "acceptEdits",
    // blockShellFileOps: true is the default
  }),
});
```

**What gets blocked in acceptEdits mode:**

- Output redirection: `echo 'text' > file.txt`, `cat input >> output`
- File deletion/movement: `rm file.txt`, `mv old new`
- File creation: `touch file`, `cp source dest`, `mkdir dir`
- Permission changes: `chmod`, `chown`
- Package managers: `npm install`, `yarn add`, `pip install`

**What remains allowed:**

- Read operations: `ls`, `cat`, `grep`, `find`, `head`, `tail`
- The `write` and `edit` tools (approved by acceptEdits mode)

**Manual configuration:**

```typescript
import { getBackendOptionsForAcceptEdits } from "@lleverage-ai/agent-sdk/security";
import { FilesystemBackend } from "@lleverage-ai/agent-sdk";

const agent = createAgent({
  model,
  backend: new FilesystemBackend(getBackendOptionsForAcceptEdits({
    rootDir: "/project",
    enableBash: true,
  })),
  permissionMode: "acceptEdits",
});
```

**Disable blocking (not recommended for production):**

```typescript
const agent = createAgent({
  model,
  ...applySecurityPolicy("development", {
    permissionMode: "acceptEdits",
    blockShellFileOps: false, // Allow bash file operations
  }),
});
```

## Complete Production Example

Combining security policies, guardrails, and secrets filtering:

```typescript
import { createAgent } from "@lleverage-ai/agent-sdk";
import { applySecurityPolicy } from "@lleverage-ai/agent-sdk/security";
import {
  createGuardrailsHooks,
  createSecretsFilterHooks,
  COMMON_SECRET_PATTERNS,
} from "@lleverage-ai/agent-sdk/hooks";

const agent = createAgent({
  model,

  // Apply production security preset
  ...applySecurityPolicy("production"),

  // Add guardrails and secrets filtering
  hooks: {
    ...createGuardrailsHooks({
      blockedInputPatterns: [/ignore\s+previous\s+instructions/i],
      blockedOutputPatterns: [/\d{3}-\d{2}-\d{4}/g],
    }),
    ...createSecretsFilterHooks({
      patterns: Object.values(COMMON_SECRET_PATTERNS),
    }),
  },

  // Additional tool restrictions
  disabledCoreTools: ["bash"],
});
```
