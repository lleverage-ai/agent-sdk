[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / BashToolOptions

# Interface: BashToolOptions

Defined in: [packages/agent-sdk/src/tools/execute.ts:37](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L37)

Options for creating a bash tool.

## Properties

### allowedCommands?

> `optional` **allowedCommands**: (`string` \| `RegExp`)[]

Defined in: [packages/agent-sdk/src/tools/execute.ts:59](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L59)

Only allow these commands to be executed.
If set, only commands starting with these prefixes are allowed.

***

### blockedCommands?

> `optional` **blockedCommands**: (`string` \| `RegExp`)[]

Defined in: [packages/agent-sdk/src/tools/execute.ts:53](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L53)

Commands or patterns that are blocked from execution.
Supports simple string matching and regex patterns.
Note: The sandbox itself may have additional blocking rules.

***

### maxOutputSize?

> `optional` **maxOutputSize**: `number`

Defined in: [packages/agent-sdk/src/tools/execute.ts:77](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L77)

Maximum output size in characters before truncation.

#### Default Value

```ts
120000
```

***

### onApprovalRequest()?

> `optional` **onApprovalRequest**: (`command`: `string`, `reason`: `string`) => `Promise`&lt;`boolean`&gt;

Defined in: [packages/agent-sdk/src/tools/execute.ts:71](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L71)

Callback to request approval for dangerous commands.
If not provided, commands requiring approval will be blocked.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `command` | `string` |
| `reason` | `string` |

#### Returns

`Promise`&lt;`boolean`&gt;

***

### requireApproval?

> `optional` **requireApproval**: (`string` \| `RegExp`)[]

Defined in: [packages/agent-sdk/src/tools/execute.ts:65](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L65)

Commands that require approval before execution.
The approval callback must return true to proceed.

***

### sandbox

> **sandbox**: [`SandboxBackendProtocol`](SandboxBackendProtocol.md)

Defined in: [packages/agent-sdk/src/tools/execute.ts:39](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L39)

The sandbox to use for command execution

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [packages/agent-sdk/src/tools/execute.ts:46](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/execute.ts#L46)

Default timeout in milliseconds for command execution.
Can be overridden per-call.

#### Default Value

```ts
120000 (2 minutes)
```
