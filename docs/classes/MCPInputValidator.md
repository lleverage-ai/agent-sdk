[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / MCPInputValidator

# Class: MCPInputValidator

Defined in: [packages/agent-sdk/src/mcp/validation.ts:62](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/validation.ts#L62)

Validator for MCP tool inputs using AJV.

## Constructors

### Constructor

> **new MCPInputValidator**(): `MCPInputValidator`

Defined in: [packages/agent-sdk/src/mcp/validation.ts:66](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/validation.ts#L66)

#### Returns

`MCPInputValidator`

## Methods

### clear()

> **clear**(): `void`

Defined in: [packages/agent-sdk/src/mcp/validation.ts:140](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/validation.ts#L140)

Clear all registered schemas.

#### Returns

`void`

***

### hasSchema()

> **hasSchema**(`toolName`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/mcp/validation.ts:124](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/validation.ts#L124)

Check if a tool has a registered schema.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `toolName` | `string` | Full MCP tool name |

#### Returns

`boolean`

True if schema is registered

***

### registerSchema()

> **registerSchema**(`toolName`: `string`, `schema`: `JSONSchema7`): `void`

Defined in: [packages/agent-sdk/src/mcp/validation.ts:81](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/validation.ts#L81)

Register a tool's input schema for validation.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `toolName` | `string` | Full MCP tool name |
| `schema` | `JSONSchema7` | JSON Schema for the tool's inputs |

#### Returns

`void`

***

### unregisterSchema()

> **unregisterSchema**(`toolName`: `string`): `void`

Defined in: [packages/agent-sdk/src/mcp/validation.ts:133](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/validation.ts#L133)

Unregister a tool's schema.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `toolName` | `string` | Full MCP tool name |

#### Returns

`void`

***

### validate()

> **validate**(`toolName`: `string`, `input`: `unknown`): `void`

Defined in: [packages/agent-sdk/src/mcp/validation.ts:101](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/mcp/validation.ts#L101)

Validate tool input against its registered schema.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `toolName` | `string` | Full MCP tool name |
| `input` | `unknown` | Tool input to validate |

#### Returns

`void`

#### Throws

If validation fails
