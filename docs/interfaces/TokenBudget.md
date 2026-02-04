[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / TokenBudget

# Interface: TokenBudget

Defined in: [packages/agent-sdk/src/context-manager.ts:301](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L301)

Token budget tracking for context management.

## Properties

### currentTokens

> **currentTokens**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:306](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L306)

Current token count in context

***

### isActual?

> `optional` **isActual**: `boolean`

Defined in: [packages/agent-sdk/src/context-manager.ts:318](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L318)

Whether this budget is based on actual usage from the model.
True if updated with real usage data, false if estimated.

***

### maxTokens

> **maxTokens**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:303](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L303)

Maximum tokens allowed in context

***

### remaining

> **remaining**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:312](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L312)

Remaining tokens available

***

### usage

> **usage**: `number`

Defined in: [packages/agent-sdk/src/context-manager.ts:309](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/context-manager.ts#L309)

Usage percentage (0-1)
