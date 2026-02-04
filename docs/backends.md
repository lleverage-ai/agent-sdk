# Backends

Backends provide filesystem and execution capabilities for agents.

## FilesystemBackend

File operations and optional shell execution with security protections:

```typescript
import {
  FilesystemBackend,
  hasExecuteCapability,
} from "@lleverage-ai/agent-sdk";

const backend = new FilesystemBackend({
  rootDir: "/project",
  allowedPaths: ["/project/src", "/project/tests"],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  followSymlinks: false,

  // Enable shell command execution
  enableBash: true,
  timeout: 30000, // 30 seconds
  maxOutputSize: 100000,
  blockedCommands: [/rm -rf \//, /sudo/],
});

// Check if backend supports command execution
if (hasExecuteCapability(backend)) {
  const result = await backend.execute("npm test");
  console.log(result.output);
  console.log(result.exitCode);
}
```

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `rootDir` | Base directory for all operations | Required |
| `allowedPaths` | Paths the agent can access | All under rootDir |
| `maxFileSize` | Maximum file size in bytes | 10MB |
| `followSymlinks` | Whether to follow symbolic links | `false` |
| `encoding` | Default file encoding | `"utf-8"` |
| `enableBash` | Enable shell command execution | `false` |
| `timeout` | Command timeout in ms (when enableBash) | 120000 |
| `maxOutputSize` | Max stdout/stderr size (when enableBash) | 100000 |
| `blockedCommands` | Commands to reject (when enableBash) | `[]` |
| `allowedCommands` | Allowlist of commands (when enableBash) | All (if not specified) |
| `allowDangerous` | Allow dangerous patterns (when enableBash) | `false` |
| `shell` | Shell to use for execution | `/bin/bash` or `cmd` on Windows |
| `env` | Additional environment variables | `{}` |

### File Operations

```typescript
// Read file
const content = await backend.read("/project/src/index.ts");

// Write file
await backend.write("/project/src/new-file.ts", "content");

// Edit file (find and replace)
await backend.edit("/project/src/index.ts", {
  oldText: "old content",
  newText: "new content",
});

// Glob pattern matching
const files = await backend.glob("/project/src/**/*.ts");

// Search with grep
const matches = await backend.grep("/project/src", "pattern");

// Check if path exists
const exists = await backend.exists("/project/src/index.ts");

// Get file stats
const stats = await backend.stat("/project/src/index.ts");
```

### Command Execution

When `enableBash: true`, the backend can execute shell commands:

```typescript
const backend = new FilesystemBackend({
  rootDir: "/project",
  enableBash: true,
  timeout: 30000,
  blockedCommands: [/rm -rf/, /sudo/],
});

// Execute command
const result = await backend.execute("npm test");
console.log(result.output);    // stdout + stderr
console.log(result.exitCode);  // 0 for success
console.log(result.truncated); // true if output was truncated
```

### Shell File Operation Blocking

For `acceptEdits` permission mode, block shell-based file operations:

```typescript
import { getBackendOptionsForAcceptEdits } from "@lleverage-ai/agent-sdk/security";

const backend = new FilesystemBackend(getBackendOptionsForAcceptEdits({
  rootDir: "/project",
  enableBash: true,
}));

// Blocked operations:
// - Output redirection: echo 'text' > file.txt
// - File deletion: rm file.txt
// - File creation: touch file, cp source dest
// - Permission changes: chmod, chown
// - Package managers: npm install, pip install

// Allowed operations:
// - Read commands: ls, cat, grep, find, head, tail
```

## StateBackend

In-memory filesystem for sandboxed operations (useful for testing):

```typescript
import { StateBackend, createAgentState } from "@lleverage-ai/agent-sdk";

const state = createAgentState();
const backend = new StateBackend(state);

// Pre-populate files
state.files.set("/project/index.ts", "console.log('hello');");

// Operations work the same as FilesystemBackend
const content = await backend.read("/project/index.ts");
await backend.write("/project/new.ts", "new content");
```

### Use Cases

- **Testing**: Test agent behavior without touching the real filesystem
- **Sandboxing**: Run untrusted operations in isolation
- **Simulation**: Simulate filesystem states for specific scenarios

Note: StateBackend does not support command execution. Use FilesystemBackend with `enableBash: true` for that capability.

## CompositeBackend

Route operations to multiple backends based on path patterns:

```typescript
import { CompositeBackend } from "@lleverage-ai/agent-sdk";

const composite = new CompositeBackend({
  routes: [
    { pattern: "/project/src/**", backend: srcBackend },
    { pattern: "/project/tests/**", backend: testsBackend },
    { pattern: "**", backend: defaultBackend },
  ],
});

// Routes to srcBackend
await composite.read("/project/src/index.ts");

// Routes to testsBackend
await composite.read("/project/tests/index.test.ts");

// Routes to defaultBackend
await composite.read("/project/package.json");
```

### Use Cases

- **Multi-root workspaces**: Different backends for different parts of a monorepo
- **Access control**: Restrict write access to certain directories
- **Mixed storage**: Combine local filesystem with remote storage

## Creating Custom Backends

Implement the `BackendProtocol` interface:

```typescript
import { BackendProtocol, ExecutableBackend } from "@lleverage-ai/agent-sdk";

class CustomBackend implements BackendProtocol {
  async read(path: string): Promise<string> {
    // Implementation
  }

  async write(path: string, content: string): Promise<WriteResult> {
    // Implementation
  }

  async edit(path: string, oldText: string, newText: string): Promise<EditResult> {
    // Implementation
  }

  async globInfo(pattern: string, cwd?: string): Promise<FileInfo[]> {
    // Implementation
  }

  async grepRaw(pattern: string, cwd?: string): Promise<GrepMatch[]> {
    // Implementation
  }
}

// For command execution capability, also implement ExecutableBackend
class CustomExecutableBackend extends CustomBackend implements ExecutableBackend {
  id = "custom-backend";

  async execute(command: string): Promise<ExecuteResponse> {
    // Implementation
  }

  async uploadFiles(files: FileUpload[]): Promise<string[]> {
    // Implementation
  }

  async downloadFiles(paths: string[]): Promise<FileDownload[]> {
    // Implementation
  }
}
```

## Using Backends with Agents

```typescript
import { createAgent, FilesystemBackend } from "@lleverage-ai/agent-sdk";

// Filesystem backend with bash enabled
const agent = createAgent({
  model,
  backend: new FilesystemBackend({
    rootDir: "/project",
    enableBash: true,
  }),
});

// The agent's core tools (read, write, edit, glob, grep, bash) will use the configured backend.
// The bash tool is only available when the backend has execute capability.
```

## Backend Type Guards

```typescript
import { isBackend, hasExecuteCapability } from "@lleverage-ai/agent-sdk";

// Check if object is a valid backend
if (isBackend(maybeBackend)) {
  // Can use file operations
}

// Check if backend supports command execution
if (hasExecuteCapability(backend)) {
  // Can use backend.execute()
  await backend.execute("npm test");
}
```
