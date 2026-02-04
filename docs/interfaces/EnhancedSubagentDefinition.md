[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / EnhancedSubagentDefinition

# Interface: EnhancedSubagentDefinition

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:28](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L28)

Enhanced subagent definition with additional capabilities.

Extends the basic SubagentDefinition with:
- Structured output schemas
- Tool specification (subset or custom)
- Interrupt conditions for human-in-the-loop
- Model override
- Maximum steps

## Properties

### description

> **description**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:33](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L33)

Description of what this subagent specializes in

***

### maxSteps?

> `optional` **maxSteps**: `number`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:53](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L53)

Maximum steps/turns for this subagent

***

### model?

> `optional` **model**: [`LanguageModel`](../type-aliases/LanguageModel.md)

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:50](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L50)

Model to use for this subagent.
If not specified, inherits from parent.

***

### systemPrompt

> **systemPrompt**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:36](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L36)

System prompt for this subagent

***

### tools?

> `optional` **tools**: `string`[] \| [`ToolSet`](../type-aliases/ToolSet.md)

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:44](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L44)

Tools available to this subagent.
- If ToolSet: use these specific tools
- If string[]: subset of parent tools by name
- If undefined: inherit all parent tools

***

### type

> **type**: `string`

Defined in: [packages/agent-sdk/src/subagents/advanced.ts:30](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/subagents/advanced.ts#L30)

Unique type identifier for this subagent
