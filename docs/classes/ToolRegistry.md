[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / ToolRegistry

# Class: ToolRegistry

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:180](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L180)

Registry for managing tools with deferred loading.

The ToolRegistry stores tools with lightweight metadata and loads full
definitions on-demand. This enables agents to have access to hundreds of
tools without consuming context window until needed.

## Example

```typescript
const registry = new ToolRegistry();

// Register tools (does not load them)
registry.register({
  name: "stripe_create_payment",
  description: "Create a payment intent in Stripe",
  plugin: "stripe",
  tool: stripeCreatePaymentTool,
});

// Agent searches for tools
const matches = registry.search({ query: "payment" });
// Returns: [{ name: "stripe_create_payment", description: "..." }]

// Agent loads tools when needed
const result = registry.load(["stripe_create_payment"]);
// Tools are now available for use
```

## Constructors

### Constructor

> **new ToolRegistry**(`options`: [`ToolRegistryOptions`](../interfaces/ToolRegistryOptions.md)): `ToolRegistry`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:195](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L195)

Creates a new tool registry.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`ToolRegistryOptions`](../interfaces/ToolRegistryOptions.md) | Configuration options |

#### Returns

`ToolRegistry`

## Accessors

### loadedCount

#### Get Signature

> **get** **loadedCount**(): `number`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:623](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L623)

Get the number of loaded tools.

##### Returns

`number`

***

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:616](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L616)

Get the number of registered tools.

##### Returns

`number`

## Methods

### buildToolIndex()

> **buildToolIndex**(`options`: \{ `includePlugins?`: `boolean`; \}): `string`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:642](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L642)

Build the tool index string for the use_tools description.

This creates a compact representation of available tools that fits
in the meta-tool description.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | \{ `includePlugins?`: `boolean`; \} | Formatting options |
| `options.includePlugins?` | `boolean` | - |

#### Returns

`string`

Formatted tool index string

***

### clear()

> **clear**(): `void`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:608](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L608)

Clear all registered tools.

#### Returns

`void`

***

### getLoadedTools()

> **getLoadedTools**(): [`ToolSet`](../type-aliases/ToolSet.md)

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:527](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L527)

Get all currently loaded tools as a ToolSet.

#### Returns

[`ToolSet`](../type-aliases/ToolSet.md)

ToolSet containing all loaded tools

***

### getMetadata()

> **getMetadata**(`name`: `string`): [`ToolMetadata`](../interfaces/ToolMetadata.md) \| `undefined`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:345](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L345)

Get metadata for a registered tool.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The tool name |

#### Returns

[`ToolMetadata`](../interfaces/ToolMetadata.md) \| `undefined`

Tool metadata or undefined if not found

***

### has()

> **has**(`name`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:326](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L326)

Check if a tool is registered.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The tool name to check |

#### Returns

`boolean`

***

### isLoaded()

> **isLoaded**(`name`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:335](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L335)

Check if a tool is currently loaded.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The tool name to check |

#### Returns

`boolean`

***

### listAll()

> **listAll**(): [`ToolMetadata`](../interfaces/ToolMetadata.md) & \{ `loaded`: `boolean`; \}[]

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:570](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L570)

List all registered tools with their load status.

#### Returns

[`ToolMetadata`](../interfaces/ToolMetadata.md) & \{ `loaded`: `boolean`; \}[]

Array of tool metadata with loaded flag

***

### listAvailable()

> **listAvailable**(): [`ToolMetadata`](../interfaces/ToolMetadata.md)[]

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:544](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L544)

List all available (not yet loaded) tools.

#### Returns

[`ToolMetadata`](../interfaces/ToolMetadata.md)[]

Array of tool metadata

***

### listLoaded()

> **listLoaded**(): `string`[]

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:553](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L553)

List all loaded tools.

#### Returns

`string`[]

Array of tool names

***

### listPlugins()

> **listPlugins**(): `string`[]

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:582](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L582)

Get all plugins that have registered tools.

#### Returns

`string`[]

Array of unique plugin names

***

### load()

> **load**(`names`: `string`[]): [`ToolLoadResult`](../interfaces/ToolLoadResult.md)

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:452](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L452)

Load tools, making them available for use.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `names` | `string`[] | Tool names to load |

#### Returns

[`ToolLoadResult`](../interfaces/ToolLoadResult.md)

Result containing loaded tools and status

#### Example

```typescript
const result = registry.load(["stripe_create_payment", "stripe_refund"]);
if (result.success) {
  // result.tools contains the loaded ToolSet
  // Inject into agent's active tools
}
```

***

### loadMatching()

> **loadMatching**(`options`: [`ToolSearchOptions`](../interfaces/ToolSearchOptions.md)): [`ToolLoadResult`](../interfaces/ToolLoadResult.md)

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:517](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L517)

Load tools matching a search query.

Convenience method combining search and load.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`ToolSearchOptions`](../interfaces/ToolSearchOptions.md) | Search options (same as search()) |

#### Returns

[`ToolLoadResult`](../interfaces/ToolLoadResult.md)

Result containing loaded tools

#### Example

```typescript
const result = registry.loadMatching({ query: "stripe", limit: 5 });
```

***

### register()

> **register**(`metadata`: [`ToolMetadata`](../interfaces/ToolMetadata.md), `toolDef`: [`Tool`](../type-aliases/Tool.md)): `void`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:226](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L226)

Register a tool with the registry.

The tool is stored but not loaded - only metadata is exposed until
the tool is explicitly loaded.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `metadata` | [`ToolMetadata`](../interfaces/ToolMetadata.md) | Tool metadata |
| `toolDef` | [`Tool`](../type-aliases/Tool.md) | The full tool definition |

#### Returns

`void`

#### Throws

Error if a tool with the same name is already registered

#### Example

```typescript
registry.register(
  {
    name: "send_email",
    description: "Send an email via SMTP",
    plugin: "email",
    category: "communication",
    tags: ["email", "notification"],
  },
  sendEmailTool
);
```

***

### registerMany()

> **registerMany**(`tools`: \[[`ToolMetadata`](../interfaces/ToolMetadata.md), [`Tool`](../type-aliases/Tool.md)\][]): `void`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:260](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L260)

Register multiple tools at once.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `tools` | \[[`ToolMetadata`](../interfaces/ToolMetadata.md), [`Tool`](../type-aliases/Tool.md)\][] | Array of [metadata, tool] tuples |

#### Returns

`void`

#### Example

```typescript
registry.registerMany([
  [{ name: "tool1", description: "..." }, tool1],
  [{ name: "tool2", description: "..." }, tool2],
]);
```

***

### registerPlugin()

> **registerPlugin**(`pluginName`: `string`, `tools`: [`ToolSet`](../type-aliases/ToolSet.md), `options`: \{ `category?`: `string`; `tags?`: `string`[]; \}): `void`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:283](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L283)

Register all tools from a plugin.

Convenience method that extracts tool metadata and registers each tool
with the plugin name attached.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `pluginName` | `string` | Name of the plugin |
| `tools` | [`ToolSet`](../type-aliases/ToolSet.md) | ToolSet from the plugin |
| `options` | \{ `category?`: `string`; `tags?`: `string`[]; \} | Optional metadata overrides |
| `options.category?` | `string` | - |
| `options.tags?` | `string`[] | - |

#### Returns

`void`

#### Example

```typescript
registry.registerPlugin("stripe", stripePlugin.tools, {
  category: "payments",
});
```

***

### reset()

> **reset**(): `void`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:599](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L599)

Reset all tools to unloaded state.

Does not unregister tools, only marks them as unloaded.

#### Returns

`void`

***

### search()

> **search**(`options`: [`ToolSearchOptions`](../interfaces/ToolSearchOptions.md)): [`ToolMetadata`](../interfaces/ToolMetadata.md)[]

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:374](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L374)

Search for tools matching criteria.

Searches tool metadata (name, description, tags) without loading
the full tool definitions.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`ToolSearchOptions`](../interfaces/ToolSearchOptions.md) | Search options |

#### Returns

[`ToolMetadata`](../interfaces/ToolMetadata.md)[]

Array of matching tool metadata

#### Example

```typescript
// Search by query
const paymentTools = registry.search({ query: "payment" });

// Filter by plugin
const stripeTools = registry.search({ plugin: "stripe" });

// Combined search
const results = registry.search({
  query: "create",
  plugin: "stripe",
  limit: 5,
});
```

***

### unregister()

> **unregister**(`name`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/tools/tool-registry.ts:313](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/tool-registry.ts#L313)

Unregister a tool from the registry.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The tool name to unregister |

#### Returns

`boolean`

True if the tool was found and removed
