[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / Tool

# Type Alias: Tool&lt;INPUT, OUTPUT&gt;

> **Tool**&lt;`INPUT`, `OUTPUT`&gt; = \{ `description?`: `string`; `inputExamples?`: \{ `input`: `NoInfer`&lt;`INPUT`&gt;; \}[]; `inputSchema`: `FlexibleSchema`&lt;`INPUT`&gt;; `needsApproval?`: `boolean` \| `ToolNeedsApprovalFunction`&lt;\[`INPUT`\] *extends* \[`never`\] ? `unknown` : `INPUT`&gt;; `onInputAvailable?`: (`options`: \{ `input`: \[`INPUT`\] *extends* \[`never`\] ? `unknown` : `INPUT`; \} & [`ToolExecutionOptions`](../interfaces/ToolExecutionOptions.md)) => `void` \| `PromiseLike`&lt;`void`&gt;; `onInputDelta?`: (`options`: \{ `inputTextDelta`: `string`; \} & [`ToolExecutionOptions`](../interfaces/ToolExecutionOptions.md)) => `void` \| `PromiseLike`&lt;`void`&gt;; `onInputStart?`: (`options`: [`ToolExecutionOptions`](../interfaces/ToolExecutionOptions.md)) => `void` \| `PromiseLike`&lt;`void`&gt;; `providerOptions?`: `ProviderOptions`; `strict?`: `boolean`; `title?`: `string`; \} & `ToolOutputProperties`&lt;`INPUT`, `OUTPUT`&gt; & \{ `toModelOutput?`: (`options`: \{ `input`: \[`INPUT`\] *extends* \[`never`\] ? `unknown` : `INPUT`; `output`: `0` *extends* `1` & `OUTPUT` ? `any` : \[`OUTPUT`\] *extends* \[`never`\] ? `any` : `NoInfer`&lt;`OUTPUT`&gt;; `toolCallId`: `string`; \}) => `ToolResultOutput` \| `PromiseLike`&lt;`ToolResultOutput`&gt;; \} & \{ `type?`: `"function"`; \} \| \{ `type`: `"dynamic"`; \} \| \{ `args`: `Record`&lt;`string`, `unknown`&gt;; `id`: `` `${string}.${string}` ``; `supportsDeferredResults?`: `boolean`; `type`: `"provider"`; \}

Defined in: node\_modules/.bun/@ai-sdk+provider-utils@4.0.11+3c5d820c62823f0b/node\_modules/@ai-sdk/provider-utils/dist/index.d.ts:1013

A tool contains the description and the schema of the input that the tool expects.
This enables the language model to generate the input.

The tool can also contain an optional execute function for the actual execution function of the tool.

## Type Declaration

### description?

> `optional` **description**: `string`

An optional description of what the tool does.
Will be used by the language model to decide whether to use the tool.
Not used for provider-defined tools.

### inputExamples?

> `optional` **inputExamples**: \{ `input`: `NoInfer`&lt;`INPUT`&gt;; \}[]

An optional list of input examples that show the language
model what the input should look like.

### inputSchema

> **inputSchema**: `FlexibleSchema`&lt;`INPUT`&gt;

The schema of the input that the tool expects.
The language model will use this to generate the input.
It is also used to validate the output of the language model.

You can use descriptions on the schema properties to make the input understandable for the language model.

### needsApproval?

> `optional` **needsApproval**: `boolean` \| `ToolNeedsApprovalFunction`&lt;\[`INPUT`\] *extends* \[`never`\] ? `unknown` : `INPUT`&gt;

Whether the tool needs approval before it can be executed.

### onInputAvailable()?

> `optional` **onInputAvailable**: (`options`: \{ `input`: \[`INPUT`\] *extends* \[`never`\] ? `unknown` : `INPUT`; \} & [`ToolExecutionOptions`](../interfaces/ToolExecutionOptions.md)) => `void` \| `PromiseLike`&lt;`void`&gt;

Optional function that is called when a tool call can be started,
even if the execute function is not provided.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `options` | \{ `input`: \[`INPUT`\] *extends* \[`never`\] ? `unknown` : `INPUT`; \} & [`ToolExecutionOptions`](../interfaces/ToolExecutionOptions.md) |

#### Returns

`void` \| `PromiseLike`&lt;`void`&gt;

### onInputDelta()?

> `optional` **onInputDelta**: (`options`: \{ `inputTextDelta`: `string`; \} & [`ToolExecutionOptions`](../interfaces/ToolExecutionOptions.md)) => `void` \| `PromiseLike`&lt;`void`&gt;

Optional function that is called when an argument streaming delta is available.
Only called when the tool is used in a streaming context.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `options` | \{ `inputTextDelta`: `string`; \} & [`ToolExecutionOptions`](../interfaces/ToolExecutionOptions.md) |

#### Returns

`void` \| `PromiseLike`&lt;`void`&gt;

### onInputStart()?

> `optional` **onInputStart**: (`options`: [`ToolExecutionOptions`](../interfaces/ToolExecutionOptions.md)) => `void` \| `PromiseLike`&lt;`void`&gt;

Optional function that is called when the argument streaming starts.
Only called when the tool is used in a streaming context.

#### Parameters

| Parameter | Type |
| :------ | :------ |
| `options` | [`ToolExecutionOptions`](../interfaces/ToolExecutionOptions.md) |

#### Returns

`void` \| `PromiseLike`&lt;`void`&gt;

### providerOptions?

> `optional` **providerOptions**: `ProviderOptions`

Additional provider-specific metadata. They are passed through
to the provider from the AI SDK and enable provider-specific
functionality that can be fully encapsulated in the provider.

### strict?

> `optional` **strict**: `boolean`

Strict mode setting for the tool.

Providers that support strict mode will use this setting to determine
how the input should be generated. Strict mode will always produce
valid inputs, but it might limit what input schemas are supported.

### title?

> `optional` **title**: `string`

An optional title of the tool.

## Type Declaration

### toModelOutput()?

> `optional` **toModelOutput**: (`options`: \{ `input`: \[`INPUT`\] *extends* \[`never`\] ? `unknown` : `INPUT`; `output`: `0` *extends* `1` & `OUTPUT` ? `any` : \[`OUTPUT`\] *extends* \[`never`\] ? `any` : `NoInfer`&lt;`OUTPUT`&gt;; `toolCallId`: `string`; \}) => `ToolResultOutput` \| `PromiseLike`&lt;`ToolResultOutput`&gt;

Optional conversion function that maps the tool result to an output that can be used by the language model.

If not provided, the tool result will be sent as a JSON object.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | \{ `input`: \[`INPUT`\] *extends* \[`never`\] ? `unknown` : `INPUT`; `output`: `0` *extends* `1` & `OUTPUT` ? `any` : \[`OUTPUT`\] *extends* \[`never`\] ? `any` : `NoInfer`&lt;`OUTPUT`&gt;; `toolCallId`: `string`; \} | - |
| `options.input` | \[`INPUT`\] *extends* \[`never`\] ? `unknown` : `INPUT` | The input of the tool call. |
| `options.output` | `0` *extends* `1` & `OUTPUT` ? `any` : \[`OUTPUT`\] *extends* \[`never`\] ? `any` : `NoInfer`&lt;`OUTPUT`&gt; | The output of the tool call. |
| `options.toolCallId` | `string` | The ID of the tool call. You can use it e.g. when sending tool-call related information with stream data. |

#### Returns

`ToolResultOutput` \| `PromiseLike`&lt;`ToolResultOutput`&gt;

## Type Parameters

| Type Parameter | Default type |
| :------ | :------ |
| `INPUT` *extends* `JSONValue` \| `unknown` \| `never` | `any` |
| `OUTPUT` *extends* `JSONValue` \| `unknown` \| `never` | `any` |
