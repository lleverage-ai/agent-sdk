[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LocalSandboxOptions

# Interface: LocalSandboxOptions

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:107](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L107)

Configuration options for LocalSandbox.

## Example

```typescript
const options: LocalSandboxOptions = {
  cwd: "/home/user/project",
  timeout: 60000,
  maxOutputSize: 1024 * 1024,
  blockedCommands: ["rm -rf /", "shutdown"],
};
```

## Properties

### allowDangerous?

> `optional` **allowDangerous**: `boolean`

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:154](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L154)

Whether to allow potentially dangerous commands.
When false (default), certain dangerous patterns are blocked.

#### Default Value

```ts
false
```

***

### allowedCommands?

> `optional` **allowedCommands**: (`string` \| `RegExp`)[]

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:147](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L147)

Only allow these commands to be executed.
If set, only commands matching these patterns are allowed.

***

### allowedPaths?

> `optional` **allowedPaths**: `string`[]

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:171](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L171)

Additional paths allowed for file operations.

***

### blockedCommands?

> `optional` **blockedCommands**: (`string` \| `RegExp`)[]

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:141](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L141)

Commands or patterns that are blocked from execution.
Supports simple string matching and regex patterns.

***

### cwd?

> `optional` **cwd**: `string`

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:112](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L112)

Working directory for command execution.

#### Default Value

```ts
process.cwd()
```

***

### env?

> `optional` **env**: `Record`&lt;`string`, `string`&gt;

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:135](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L135)

Environment variables to set for all commands.

***

### followSymlinks?

> `optional` **followSymlinks**: `boolean`

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:166](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L166)

Whether to follow symbolic links.

#### Default Value

```ts
false
```

***

### maxFileSizeMb?

> `optional` **maxFileSizeMb**: `number`

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:160](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L160)

Maximum file size in MB for file operations.

#### Default Value

```ts
10
```

***

### maxOutputSize?

> `optional` **maxOutputSize**: `number`

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:124](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L124)

Maximum output size in bytes before truncation.

#### Default Value

```ts
1048576 (1MB)
```

***

### shell?

> `optional` **shell**: `string`

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:130](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L130)

Shell to use for command execution.

#### Default Value

```ts
"/bin/sh" on Unix, "cmd.exe" on Windows
```

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [packages/agent-sdk/src/backends/sandbox.ts:118](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/sandbox.ts#L118)

Default timeout in milliseconds for command execution.

#### Default Value

```ts
120000 (2 minutes)
```
