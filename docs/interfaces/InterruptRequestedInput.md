[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / InterruptRequestedInput

# Interface: InterruptRequestedInput

Defined in: [packages/agent-sdk/src/types.ts:2032](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2032)

Input for InterruptRequested hooks.

Emitted when an interrupt is created (approval request, custom interrupt, etc.).

## Extends

- `BaseHookInput`

## Properties

### cwd

> **cwd**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1831](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1831)

Current working directory

#### Inherited from

`BaseHookInput.cwd`

***

### hook\_event\_name

> **hook\_event\_name**: `"InterruptRequested"`

Defined in: [packages/agent-sdk/src/types.ts:2033](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2033)

The event type that triggered this hook

#### Overrides

`BaseHookInput.hook_event_name`

***

### interrupt\_id

> **interrupt\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2035](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2035)

Unique identifier for the interrupt

***

### interrupt\_type

> **interrupt\_type**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2037](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2037)

Type of interrupt (e.g., "approval", "custom")

***

### request

> **request**: `unknown`

Defined in: [packages/agent-sdk/src/types.ts:2043](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2043)

The interrupt request data

***

### session\_id

> **session\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1829](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1829)

Session identifier

#### Inherited from

`BaseHookInput.session_id`

***

### tool\_call\_id?

> `optional` **tool\_call\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2039](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2039)

Tool call ID if related to a tool call

***

### tool\_name?

> `optional` **tool\_name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2041](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2041)

Tool name if related to a tool call
