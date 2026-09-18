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

## Host-owned workflow authorisation

Use `workflowExecutionGate` when trusted host policy must run **before** tool
hooks, permission callbacks or tool I/O. `PreToolUse` alone is not that boundary:
other hooks may themselves perform I/O. Ordinary agents without the gate keep
their existing hook and permission behaviour.

```typescript
const agent = createAgent({
  model,
  workflowExecutionGate: {
    version: 1,
    timeoutMs: 10_000,
    authorize: ({ toolName }) =>
      toolName === "read"
        ? { decision: "allow" }
        : { decision: "deny", reason: "This run is read-only" },
    // Optional run signal; each call also supplies its own cancellation signal.
    signal: runSignal,
    onDecision: (receipt) => logger.info("Tool authority checked", receipt),
  },
});
```

The SDK validates the option once at construction. Only an explicit allow lets
the pipeline proceed; denial, lookup failure, malformed decisions, timeout and
cancellation block protected work. A late allow cannot reopen a closed lookup.
The host receives a composed abort signal and should use it for its lookup.
The default lookup deadline is 10 seconds. Receipt callbacks carry no tool input;
the SDK contains synchronous exceptions and asynchronous rejections without
awaiting the sink. A gate-only signal blocks further tool work; pass the same
signal in the generation options to cancel model generation too.

The gate sees `pre-hook` requests for registered tools, `transformed-input`
requests when a hook replaces input, and `proxy-target` requests for the actual
`call_tool` target. A dispatcher grant does not grant its targets, including a
target replaced by a hook. Runtime-added and deferred tools use the same
pipeline in all five generation modes. The AI SDK's earlier `needsApproval`
callback is gated separately, including the SDK's `canUseTool` bridge. An
approval-phase grant is not reused at execution: authority is checked again.
Cancellation is rechecked after awaited approval and permission callbacks.
Tools with no host `execute` boundary, or with AI SDK input lifecycle callbacks
(`onInputStart`, `onInputDelta`, `onInputAvailable`), are rejected before model
execution when the gate is enabled. Partial-input callbacks run before complete
input can be authorised; use gated `PreToolUse` hooks for protected I/O instead.
In `streamDataResponse`, such build-time failures become an error part in the
returned response rather than a rejected promise; the model is still not called.

`ToolPermissionDeniedError` represents an explicit denial;
`WorkflowExecutionGateError` represents an unavailable, malformed or timed-out
authority decision and is not generation-retryable. Execution-stage errors pass
through `transformToolError` before the AI SDK records a tool failure. A gate
failure in `needsApproval` follows the AI SDK's approval-callback failure path
and fails generation rather than being converted into an execution result.

`createSubagent()` inherits the parent's gate unless the host explicitly supplies
another gate in the child options. This includes the built-in general-purpose
`task` child and does not depend on hook inheritance. Custom subagent factories
that call `createAgent()` independently must configure their child's gate:
authorising the parent's `task` call does not authorise the child's tool calls.

This is an execution boundary, not a sandbox for arbitrary host code. Plugin
setup and direct calls to raw tool functions (including tools exposed for host
introspection) are outside it. `resume()` and `resumeDataResponse()` explicitly
reject gated agents before checkpoint loading or resolution hooks: those legacy
paths invoke raw tools outside the generation pipeline. Hosts should durably
resolve the interrupt themselves and supply resolved tool results to
`generate()` / `stream()`, as the Lleverage platform does. Ungated resume behaviour
is unchanged; this option does not migrate checkpoint storage or recovery policy.

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
