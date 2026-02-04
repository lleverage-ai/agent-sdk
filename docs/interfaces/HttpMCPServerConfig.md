[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / HttpMCPServerConfig

# Interface: HttpMCPServerConfig

Defined in: [packages/agent-sdk/src/types.ts:2750](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2750)

Configuration for HTTP-based MCP servers.

## Example

```typescript
const config: HttpMCPServerConfig = {
  type: "http",
  url: "https://api.example.com/mcp",
  headers: { Authorization: "Bearer ${TOKEN}" },
};
```

## Extends

- `MCPServerConfigBase`

## Properties

### allowedTools?

> `optional` **allowedTools**: `string`[]

Defined in: [packages/agent-sdk/src/types.ts:2691](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2691)

Security: Allowlist of permitted tool names from this server.
If specified, only tools in this list will be loaded and available for use.
Tool names should be the original names (without the mcp__ prefix).

#### Example

```typescript
// Only allow specific GitHub tools
allowedTools: ["get_issue", "list_issues"]
```

#### Inherited from

`MCPServerConfigBase.allowedTools`

***

### env?

> `optional` **env**: `Record`&lt;`string`, `string`&gt;

Defined in: [packages/agent-sdk/src/types.ts:2678](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2678)

Environment variables for the MCP server.
Supports `${VAR}` syntax for expansion at runtime.

#### Inherited from

`MCPServerConfigBase.env`

***

### headers?

> `optional` **headers**: `Record`&lt;`string`, `string`&gt;

Defined in: [packages/agent-sdk/src/types.ts:2755](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2755)

HTTP headers (supports $\{VAR\} expansion)

***

### requireSchema?

> `optional` **requireSchema**: `boolean`

Defined in: [packages/agent-sdk/src/types.ts:2709](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2709)

Security: Reject tools that don't have a proper input schema.
When enabled, tools without schemas or with empty schemas will not be loaded.
Useful for enforcing that all tools have explicit input validation.

#### Default

```ts
false
```

#### Inherited from

`MCPServerConfigBase.requireSchema`

***

### type

> **type**: `"http"`

Defined in: [packages/agent-sdk/src/types.ts:2751](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2751)

***

### url

> **url**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2753](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2753)

Server URL

***

### validateInputs?

> `optional` **validateInputs**: `boolean`

Defined in: [packages/agent-sdk/src/types.ts:2700](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2700)

Security: Validate tool inputs against their declared JSON Schema.
When enabled, tool inputs will be validated before execution.
Invalid inputs will throw an error instead of being passed to the server.

#### Default

```ts
false
```

#### Inherited from

`MCPServerConfigBase.validateInputs`
