[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / Agent

# Interface: Agent

Defined in: [packages/agent-sdk/src/types.ts:904](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L904)

An agent instance capable of generating responses and executing tools.

## Example

```typescript
const agent = createAgent({ model, systemPrompt: "..." });

// Generate a response
const result = await agent.generate({ prompt: "Hello" });

// Stream for use with useChat
const response = await agent.streamResponse({ prompt: "Hello" });
```

## Properties

### backend

> `readonly` **backend**: [`BackendProtocol`](BackendProtocol.md)

Defined in: [packages/agent-sdk/src/types.ts:917](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L917)

The storage backend used by this agent.

Provides access to the underlying file operations backend,
useful for passing to tools or performing file operations.

***

### id

> `readonly` **id**: `string`

Defined in: [packages/agent-sdk/src/types.ts:906](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L906)

Unique identifier for this agent instance

***

### options

> `readonly` **options**: [`AgentOptions`](AgentOptions.md)

Defined in: [packages/agent-sdk/src/types.ts:909](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L909)

The options used to create this agent

***

### ready

> `readonly` **ready**: `Promise`&lt;`void`&gt;

Defined in: [packages/agent-sdk/src/types.ts:943](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L943)

Promise that resolves when the agent is fully initialized.

This includes:
- MCP server connections for plugins with mcpServer config
- Plugin setup functions

Await this before using the agent if you need MCP tools to be available.

#### Example

```typescript
const agent = createAgent({ model, plugins: [mcpPlugin] });
await agent.ready; // Wait for MCP connections
return agent.streamResponse({ messages });
```

***

### state

> `readonly` **state**: [`AgentState`](AgentState.md)

Defined in: [packages/agent-sdk/src/types.ts:925](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L925)

The agent state managed by this agent.

Contains todos and virtual filesystem data when using StateBackend.
The state is shared with the backend if a factory function was used.

## Methods

### generate()

> **generate**(`options`: [`GenerateOptions`](GenerateOptions.md)): `Promise`&lt;[`GenerateResult`](../type-aliases/GenerateResult.md)&gt;

Defined in: [packages/agent-sdk/src/types.ts:951](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L951)

Generate a complete response.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`GenerateOptions`](GenerateOptions.md) | Generation options including the prompt |

#### Returns

`Promise`&lt;[`GenerateResult`](../type-aliases/GenerateResult.md)&gt;

The complete generation result

***

### getActiveTools()

> **getActiveTools**(): [`ToolSet`](../type-aliases/ToolSet.md)

Defined in: [packages/agent-sdk/src/types.ts:1033](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1033)

Get all currently active tools.

Returns the combined set of core tools and dynamically loaded tools.
In lazy loading mode, this includes tools loaded via use_tools.

#### Returns

[`ToolSet`](../type-aliases/ToolSet.md)

ToolSet containing all active tools

***

### getInterrupt()

> **getInterrupt**(`threadId`: `string`): `Promise`&lt;[`Interrupt`](Interrupt.md)&lt;`unknown`, `unknown`&gt; \| `undefined`&gt;

Defined in: [packages/agent-sdk/src/types.ts:1093](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1093)

Get the pending interrupt for a thread.

Returns the interrupt from the checkpoint if there is a pending interrupt
(e.g., tool approval request, custom question). Useful for displaying
prompts to users.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `threadId` | `string` | The thread ID to check for pending interrupts |

#### Returns

`Promise`&lt;[`Interrupt`](Interrupt.md)&lt;`unknown`, `unknown`&gt; \| `undefined`&gt;

The interrupt if one is pending, undefined otherwise

#### Example

```typescript
const interrupt = await agent.getInterrupt(threadId);
if (interrupt) {
  if (isApprovalInterrupt(interrupt)) {
    console.log(`Waiting for approval of ${interrupt.toolName}`);
    console.log(`Arguments:`, interrupt.request.args);
  }
}
```

***

### getSkills()

> **getSkills**(): [`SkillDefinition`](SkillDefinition.md)[]

Defined in: [packages/agent-sdk/src/types.ts:1023](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1023)

Get all skills registered with this agent.

#### Returns

[`SkillDefinition`](SkillDefinition.md)[]

Array of skill definitions

***

### loadTools()

> **loadTools**(`toolNames`: `string`[]): \{ `loaded`: `string`[]; `notFound`: `string`[]; \}

Defined in: [packages/agent-sdk/src/types.ts:1044](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1044)

Load tools from the registry by name.

Only available when using lazy plugin loading mode.
Tools loaded through this method become available for use.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `toolNames` | `string`[] | Names of tools to load |

#### Returns

\{ `loaded`: `string`[]; `notFound`: `string`[]; \}

Object with loaded tool names and any errors

##### loaded

> **loaded**: `string`[]

##### notFound

> **notFound**: `string`[]

***

### resume()

> **resume**(`threadId`: `string`, `interruptId`: `string`, `response`: `unknown`, `options?`: `Partial`&lt;[`GenerateOptions`](GenerateOptions.md)&gt;): `Promise`&lt;[`GenerateResult`](../type-aliases/GenerateResult.md)&gt;

Defined in: [packages/agent-sdk/src/types.ts:1127](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1127)

Resume execution after responding to an interrupt.

Use this method to continue the agent's execution after providing a response
to an interrupt. For approval interrupts, the response should be an
`ApprovalResponse` with `{ approved: boolean }`. For custom interrupts,
provide the appropriate response type.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `threadId` | `string` | The thread ID to resume |
| `interruptId` | `string` | The ID of the interrupt being responded to |
| `response` | `unknown` | The response to the interrupt |
| `options?` | `Partial`&lt;[`GenerateOptions`](GenerateOptions.md)&gt; | Optional generation options to override defaults |

#### Returns

`Promise`&lt;[`GenerateResult`](../type-aliases/GenerateResult.md)&gt;

The generation result after resuming

#### Example

```typescript
const result = await agent.generate({ prompt, threadId });

if (result.status === "interrupted") {
  const { interrupt } = result;

  if (isApprovalInterrupt(interrupt)) {
    const approved = await askUser(`Run ${interrupt.request.toolName}?`);
    return agent.resume(threadId, interrupt.id, { approved });
  }

  // Custom interrupt
  const response = await handleCustomInterrupt(interrupt.request);
  return agent.resume(threadId, interrupt.id, response);
}
```

***

### setPermissionMode()

> **setPermissionMode**(`mode`: [`PermissionMode`](../type-aliases/PermissionMode.md)): `void`

Defined in: [packages/agent-sdk/src/types.ts:1070](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1070)

Dynamically change the permission mode.

Allows switching permission behavior at runtime, useful for
transitioning between planning and execution phases or adjusting
security posture based on user actions.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `mode` | [`PermissionMode`](../type-aliases/PermissionMode.md) | The new permission mode |

#### Returns

`void`

#### Example

```typescript
// Start in plan mode
const agent = createAgent({
  model,
  permissionMode: "plan",
});

// After planning, switch to execution
agent.setPermissionMode("acceptEdits");
```

***

### stream()

> **stream**(`options`: [`GenerateOptions`](GenerateOptions.md)): `AsyncGenerator`&lt;[`StreamPart`](../type-aliases/StreamPart.md)&gt;

Defined in: [packages/agent-sdk/src/types.ts:960](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L960)

Generate a streaming response as an AsyncGenerator.
For internal use or custom stream handling.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`GenerateOptions`](GenerateOptions.md) | Generation options including the prompt |

#### Returns

`AsyncGenerator`&lt;[`StreamPart`](../type-aliases/StreamPart.md)&gt;

#### Yields

Stream parts as they're generated

***

### streamDataResponse()

> **streamDataResponse**(`options`: [`GenerateOptions`](GenerateOptions.md)): `Promise`&lt;`Response`&gt;

Defined in: [packages/agent-sdk/src/types.ts:1017](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L1017)

Generate a streaming Response with data stream support.

This method enables tools to stream custom data to the client using
`ctx.writer.write()`. The data is delivered alongside the text stream
and can be accessed via `useChat`'s `data` property.

Use this method when you need:
- Progressive UI updates during tool execution
- Streaming structured data to the client
- Real-time feedback from long-running tools

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`GenerateOptions`](GenerateOptions.md) | Generation options including the prompt |

#### Returns

`Promise`&lt;`Response`&gt;

A web Response that streams text and custom data

#### Example

```typescript
// In a Next.js API route
export async function POST(req: Request) {
  const { messages } = await req.json();
  return agent.streamDataResponse({ messages });
}

// On the client with useChat
const { messages, data } = useChat({ api: "/api/agent" });
// `data` contains custom data streamed from tools
```

***

### streamRaw()

> **streamRaw**(`options`: [`GenerateOptions`](GenerateOptions.md)): `Promise`&lt;`StreamTextResult`&lt;[`ToolSet`](../type-aliases/ToolSet.md), `Output`&lt;`any`, `any`, `any`&gt;&gt;&gt;

Defined in: [packages/agent-sdk/src/types.ts:987](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L987)

Get the underlying streamText result for advanced use cases.
Allows calling toUIMessageStream(), toTextStreamResponse(), etc.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`GenerateOptions`](GenerateOptions.md) | Generation options |

#### Returns

`Promise`&lt;`StreamTextResult`&lt;[`ToolSet`](../type-aliases/ToolSet.md), `Output`&lt;`any`, `any`, `any`&gt;&gt;&gt;

Promise of the raw streamText result from AI SDK

***

### streamResponse()

> **streamResponse**(`options`: [`GenerateOptions`](GenerateOptions.md)): `Promise`&lt;`Response`&gt;

Defined in: [packages/agent-sdk/src/types.ts:978](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/types.ts#L978)

Generate a streaming Response for use with useChat/AI SDK UI.
Returns a web-standard Response with proper stream protocol.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`GenerateOptions`](GenerateOptions.md) | Generation options including the prompt |

#### Returns

`Promise`&lt;`Response`&gt;

A web Response that can be returned from API routes

#### Example

```typescript
// In a Next.js API route
export async function POST(req: Request) {
  const { messages } = await req.json();
  return agent.streamResponse({ messages });
}
```
