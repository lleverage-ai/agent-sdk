[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / FilesystemBackendOptions

# Interface: FilesystemBackendOptions

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:60](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L60)

Configuration options for FilesystemBackend.

## Example

```typescript
const options: FilesystemBackendOptions = {
  rootDir: "/home/user/project",
  maxFileSizeMb: 5,
  followSymlinks: false,
};
```

## Properties

### allowedPaths?

> `optional` **allowedPaths**: `string`[]

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:86](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L86)

Additional paths that are allowed outside rootDir.
Useful for accessing system paths like /tmp.

***

### followSymlinks?

> `optional` **followSymlinks**: `boolean`

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:80](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L80)

Whether to follow symbolic links.
When false (default), symlinks are rejected for security.

#### Default Value

```ts
false
```

***

### maxFileSizeMb?

> `optional` **maxFileSizeMb**: `number`

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:73](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L73)

Maximum file size in megabytes for read operations.
Files larger than this will be rejected with an error.

#### Default Value

```ts
10
```

***

### rootDir?

> `optional` **rootDir**: `string`

Defined in: [packages/agent-sdk/src/backends/filesystem.ts:66](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/filesystem.ts#L66)

Base directory for all operations.
All paths are resolved relative to this directory.

#### Default Value

```ts
process.cwd()
```
