[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / UIMessage

# Interface: UIMessage&lt;METADATA, DATA_PARTS, TOOLS&gt;

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:1292

AI SDK UI Messages. They are used in the client and to communicate between the frontend and the API routes.

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `METADATA` | `unknown` |
| `DATA_PARTS` *extends* `UIDataTypes` | `UIDataTypes` |
| `TOOLS` *extends* `UITools` | `UITools` |

## Properties

### id

> **id**: `string`

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:1296

A unique identifier for the message.

***

### metadata?

> `optional` **metadata**: `METADATA`

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:1304

The metadata of the message.

***

### parts

> **parts**: `UIMessagePart`&lt;`DATA_PARTS`, `TOOLS`&gt;[]

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:1315

The parts of the message. Use this for rendering the message in the UI.

System messages should be avoided (set the system prompt on the server instead).
They can have text parts.

User messages can have text parts and file parts.

Assistant messages can have text, reasoning, tool invocation, and file parts.

***

### role

> **role**: `"system"` \| `"user"` \| `"assistant"`

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:1300

The role of the message.
