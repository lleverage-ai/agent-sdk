[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / InterruptResolvedInput

# Interface: InterruptResolvedInput

Defined in: [packages/agent-sdk/src/types.ts:2052](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2052)

Input for InterruptResolved hooks.

Emitted when an interrupt is resolved (approved, denied, or custom response).

## Extends

- `BaseHookInput`

## Properties

### approved?

> `optional` **approved**: `boolean`

Defined in: [packages/agent-sdk/src/types.ts:2065](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2065)

For approval interrupts: whether the request was approved

***

### cwd

> **cwd**: `string`

Defined in: [packages/agent-sdk/src/types.ts:1831](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1831)

Current working directory

#### Inherited from

`BaseHookInput.cwd`

***

### hook\_event\_name

> **hook\_event\_name**: `"InterruptResolved"`

Defined in: [packages/agent-sdk/src/types.ts:2053](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2053)

The event type that triggered this hook

#### Overrides

`BaseHookInput.hook_event_name`

***

### interrupt\_id

> **interrupt\_id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2055](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2055)

Unique identifier for the interrupt

***

### interrupt\_type

> **interrupt\_type**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2057](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2057)

Type of interrupt (e.g., "approval", "custom")

***

### response

> **response**: `unknown`

Defined in: [packages/agent-sdk/src/types.ts:2063](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2063)

The response that resolved the interrupt

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

Defined in: [packages/agent-sdk/src/types.ts:2059](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2059)

Tool call ID if related to a tool call

***

### tool\_name?

> `optional` **tool\_name**: `string`

Defined in: [packages/agent-sdk/src/types.ts:2061](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L2061)

Tool name if related to a tool call
