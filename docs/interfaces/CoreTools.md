[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CoreTools

# Interface: CoreTools

Defined in: [packages/agent-sdk/src/tools/factory.ts:226](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L226)

Result from createCoreTools containing all created tools and registries.

## Properties

### bash?

> `optional` **bash**: [`Tool`](../type-aliases/Tool.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:252](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L252)

Shell execution (if sandbox provided)

***

### edit?

> `optional` **edit**: [`Tool`](../type-aliases/Tool.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:236](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L236)

Edit files via replacement (if enabled)

***

### glob?

> `optional` **glob**: [`Tool`](../type-aliases/Tool.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:239](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L239)

Find files by glob pattern

***

### grep?

> `optional` **grep**: [`Tool`](../type-aliases/Tool.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:242](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L242)

Search file contents

***

### read?

> `optional` **read**: [`Tool`](../type-aliases/Tool.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:230](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L230)

Read file contents

***

### search\_tools?

> `optional` **search\_tools**: [`Tool`](../type-aliases/Tool.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:267](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L267)

Tool search/discovery (if mcpManager provided)

***

### skill?

> `optional` **skill**: [`Tool`](../type-aliases/Tool.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:257](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L257)

Load skill tool (if registry provided)

***

### skillRegistry?

> `optional` **skillRegistry**: [`SkillRegistry`](../classes/SkillRegistry.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:272](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L272)

The skill registry (if provided)

***

### task?

> `optional` **task**: [`Tool`](../type-aliases/Tool.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:262](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L262)

Task delegation tool (if subagents provided)

***

### todo\_write?

> `optional` **todo\_write**: [`Tool`](../type-aliases/Tool.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:247](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L247)

Write/update todo list (if enabled)

***

### write?

> `optional` **write**: [`Tool`](../type-aliases/Tool.md)

Defined in: [packages/agent-sdk/src/tools/factory.ts:233](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/factory.ts#L233)

Write/create files (if enabled)
