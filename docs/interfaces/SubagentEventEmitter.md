[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SubagentEventEmitter

# Interface: SubagentEventEmitter

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:309](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L309)

Event emitter interface for subagent events.

## Methods

### onError()

> **onError**(`handler`: (`event`: [`SubagentErrorEvent`](SubagentErrorEvent.md)) => `void`): `void`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:320](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L320)

Register a listener for error events

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `handler` | (`event`: [`SubagentErrorEvent`](SubagentErrorEvent.md)) => `void` |

#### Returns

`void`

***

### onFinish()

> **onFinish**(`handler`: (`event`: [`SubagentFinishEvent`](SubagentFinishEvent.md)) => `void`): `void`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:317](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L317)

Register a listener for finish events

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `handler` | (`event`: [`SubagentFinishEvent`](SubagentFinishEvent.md)) => `void` |

#### Returns

`void`

***

### onStart()

> **onStart**(`handler`: (`event`: [`SubagentStartEvent`](SubagentStartEvent.md)) => `void`): `void`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:311](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L311)

Register a listener for start events

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `handler` | (`event`: [`SubagentStartEvent`](SubagentStartEvent.md)) => `void` |

#### Returns

`void`

***

### onStep()

> **onStep**(`handler`: (`event`: [`SubagentStepEvent`](SubagentStepEvent.md)) => `void`): `void`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:314](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L314)

Register a listener for step events

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `handler` | (`event`: [`SubagentStepEvent`](SubagentStepEvent.md)) => `void` |

#### Returns

`void`

***

### removeAllListeners()

> **removeAllListeners**(): `void`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:323](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L323)

Remove all listeners

#### Returns

`void`
